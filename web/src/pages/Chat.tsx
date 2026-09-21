import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api/client'
import { useUserStore } from '../store/user'
import WeChatContactModal from '../components/WeChatContactModal'

// 配置 marked：启用 GFM 表格、换行符转 <br>
marked.setOptions({ breaks: true, gfm: true })

// 轻量防 XSS：去掉 <script> 和 javascript: 协议
function safeMarkdown(md: string): string {
  const html = marked.parse(md) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

// Markdown 内容样式（不依赖 typography 插件，手写作用域样式）
const MD_STYLE = `
.md-content { color: inherit; line-height: 1.7; word-break: break-word; }
.md-content p { margin: 0.4em 0; }
.md-content p:first-child { margin-top: 0; }
.md-content p:last-child { margin-bottom: 0; }
.md-content strong { font-weight: 600; color: #111; }
.md-content em { font-style: italic; }
.md-content ul, .md-content ol { margin: 0.4em 0; padding-left: 1.4em; }
.md-content ul { list-style: disc; }
.md-content ol { list-style: decimal; }
.md-content li { margin: 0.2em 0; }
.md-content a { color: #2563eb; text-decoration: underline; }
.md-content code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.85em; font-family: ui-monospace, monospace; }
.md-content blockquote { margin: 0.4em 0; padding-left: 0.8em; border-left: 3px solid #d1d5db; color: #6b7280; }
.md-content h1, .md-content h2, .md-content h3 { font-weight: 600; margin: 0.6em 0 0.3em; }
.md-content h1 { font-size: 1.2em; }
.md-content h2 { font-size: 1.1em; }
.md-content h3 { font-size: 1em; }
.md-content hr { border: none; border-top: 1px solid #e5e7eb; margin: 0.6em 0; }
`

interface Msg {
  role: 'user' | 'ai'
  content: string
  references?: Array<{ text: string; source: string }>
}

// 推荐问题池：用于初次引导和 AI 回复后的"继续追问"推荐
const QUESTION_POOL = [
  '胖东来企业文化的核心是什么？',
  '胖东来"爱"与"自由"的含义？',
  '如何理解胖东来"健康高于一切"的理念？',
  '胖东来对员工有哪些特别关怀？',
  '胖东来的服务理念有哪些独特之处？',
  '胖东来如何看待利润与顾客的关系？',
  '胖东来"公平"体现在哪些方面？',
  '胖东来的团队文化是怎样的？',
  '胖东来为什么强调"快乐工作"？',
  '胖东来对商品品质有哪些要求？',
  '胖东来的管理哲学是什么？',
  '胖东来如何培养员工的幸福感？',
  '胖东来的经营底线是什么？',
  '胖东来"自由"的边界在哪里？',
  '胖东来如何处理顾客投诉？',
]

// 从池中随机取 n 个，避开 avoid 列表里的问题
function pickRandom(n: number, avoid: string[] = []): string[] {
  const pool = QUESTION_POOL.filter((q) => !avoid.includes(q))
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

export default function Chat() {
  const user = useUserStore((s) => s.user)
  const pendingQuestion = useUserStore((s) => s.pendingQuestion)
  const setPendingQuestion = useUserStore((s) => s.setPendingQuestion)
  const refreshProfile = useUserStore((s) => s.refreshProfile)
  const [showUnlock, setShowUnlock] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [dailyExhausted, setDailyExhausted] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>(() => pickRandom(3))
  const listRef = useRef<HTMLDivElement>(null)
  // 防止 StrictMode 下 pendingQuestion 被消费两次
  const consumedPendingRef = useRef<string | null>(null)

  // 清空当前对话，开新会话
  const startNew = () => {
    setMessages([])
    setInput('')
    setErr('')
    setSuggestions(pickRandom(3))
    consumedPendingRef.current = null
  }

  const chatLocked = !!user?.isChatLocked
  const remaining =
    user?.vipActivatedAt != null
      ? -1
      : Math.max(0, (user?.chatFreeLimit ?? 10) - (user?.chatFreeUsedCount ?? 0))

  useEffect(() => {
    if (!user) return
    let active = true
    setHistoryReady(false)
    api.chatHistory().then((history) => { if (active) setMessages(history.map((m) => ({ role: m.role === 'assistant' ? 'ai' : 'user', content: m.content, references: m.references }))) }).catch(() => { if (active) setErr('对话历史加载失败，请刷新重试') }).finally(() => { if (active) setHistoryReady(true) })
    return () => { active = false }
  }, [user?.id])
  // 新消息自动滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  // 进入对话页时，若有从 Exam 带过来的待问题目，自动填入并立即发送
  useEffect(() => {
    if (historyReady && pendingQuestion && consumedPendingRef.current !== pendingQuestion) {
      consumedPendingRef.current = pendingQuestion
      setInput(pendingQuestion)
      setPendingQuestion(null)
      // 直接发送
      void send(pendingQuestion)
    }
  }, [pendingQuestion, historyReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (overrideText?: string) => {
    if (!user) return
    const text = (overrideText ?? input).trim()
    if (!text || sending || chatLocked || !historyReady) return
    setInput('')
    setErr('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setSending(true)
    try {
      const res = await api.chat({ userId: user.id, message: text })
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: res.reply, references: res.references },
      ])
      // 刷新推荐问题，避开刚问的问题
      setSuggestions(pickRandom(3, [text]))
      // 刷新用户态以同步剩余对话次数
      void refreshProfile().catch(() => {})
    } catch (e) {
      const daily = (e as Error & { code?: string }).code === 'DAILY_LIMIT'
      if (daily) {
        setDailyExhausted(true)
        setErr('今日对话次数已达上限，请明天再来')
        setMessages((prev) => prev.slice(0, -1))
      } else {
        setInput(text)
        setErr(e instanceof Error ? e.message : '发送失败')
        setMessages((prev) => prev.slice(0, -1))
      }
    } finally {
      setSending(false)
    }
  }

  const showGuide = messages.length === 0 && !sending && !pendingQuestion

  return (
    <div className="relative flex h-full flex-col">
      <style>{MD_STYLE}</style>
      {/* 顶部操作条 */}
      <div className="flex shrink-0 items-center justify-end border-b border-gray-100 bg-white px-3 py-1.5">
        <button
          onClick={startNew}
          disabled={messages.length === 0 || sending}
          className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 active:scale-95 disabled:opacity-40"
        >
          ✚ 新对话
        </button>
      </div>
      <div ref={listRef} className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {showGuide && (
          <div className="mt-6 text-center text-sm text-gray-400">
            <p className="mb-1 text-4xl">💬</p>
            有什么关于胖东来文化的问题，尽管问我～
            {remaining >= 0 ? (
              <p className="mt-1 text-xs">剩余免费对话 {remaining} 次</p>
            ) : (
              <p className="mt-1 text-xs">VIP 用户</p>
            )}
          </div>
        )}

        {showGuide && (
          <div className="mt-4 space-y-2">
            <button
              onClick={() => send('胖东来简介')}
              disabled={chatLocked || dailyExhausted}
              className="block w-full rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-left text-sm text-gray-700 shadow-sm active:scale-[0.98] disabled:opacity-50"
            >
              📖 胖东来简介
            </button>
            {suggestions.slice(0, 2).map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={chatLocked || dailyExhausted}
                className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-700 shadow-sm active:scale-[0.98] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[88%]">
                <div
                  className="md-content rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm leading-relaxed text-gray-800 shadow-sm"
                  dangerouslySetInnerHTML={{ __html: safeMarkdown(m.content) }}
                />
                {m.references && m.references.length > 0 && (
                  <details className="mt-1.5 text-xs text-gray-400">
                    <summary className="cursor-pointer select-none">
                      📎 引用 {m.references.length} 条资料
                    </summary>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {m.references.map((r, j) => (
                        <span
                          key={j}
                          className="rounded-md bg-primary/10 px-2 py-0.5 text-primary"
                          title={r.text}
                        >
                          📎 {r.source}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm text-gray-400 shadow-sm">
              AI 正在思考…
            </div>
          </div>
        )}

        {/* AI 回复后的继续追问推荐：3 个问题按钮 */}
        {!showGuide && !sending && !chatLocked && !dailyExhausted && messages.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-gray-400">还可以继续问：</p>
            <div className="space-y-2">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-700 shadow-sm active:scale-[0.98]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {err && <p className="px-4 pb-1 text-xs text-primary">{err}</p>}

      {!chatLocked && !dailyExhausted && (
        <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-3 py-2.5">
          <input
            maxLength={6000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            placeholder="输入你的问题…"
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => send()}
            disabled={!historyReady || sending || !input.trim()}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            发送
          </button>
        </div>
      )}

      {chatLocked && <div className="shrink-0 border-t border-gray-200 bg-white p-3 text-center">
        <p className="text-sm text-gray-600">免费对话额度已用完，历史回答仍可查看</p>
        <button onClick={() => setShowUnlock(true)} className="mt-2 rounded-full bg-primary px-5 py-2 text-sm text-white">解锁后继续提问</button>
      </div>}

      {!chatLocked && dailyExhausted && <div className="shrink-0 border-t border-gray-200 bg-white p-3 text-center">
        <p className="text-sm text-gray-600">今日对话次数已达上限，明天再来吧</p>
      </div>}
      {showUnlock && <WeChatContactModal onClose={() => setShowUnlock(false)} />}
    </div>
  )
}
