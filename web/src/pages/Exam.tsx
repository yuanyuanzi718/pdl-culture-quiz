import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useUserStore } from '../store/user'
import type { ExamResult, Question } from '../types'
import LockOverlay from '../components/LockOverlay'
import QuestionCard from '../components/QuestionCard'

type Phase = 'idle' | 'exam' | 'result'

// 答案展示工具：数组转 A、B 这种序号或原文
const fmtAnswer = (val: string | string[] | undefined, options?: string[]): string => {
  if (val == null) return '未作答'
  const arr = Array.isArray(val) ? val : [val]
  if (options) {
    return arr
      .map((v) => {
        const idx = options.indexOf(v)
        return idx >= 0 ? String.fromCharCode(65 + idx) : v
      })
      .join('、')
  }
  return arr.join('、')
}

export default function Exam() {
  const user = useUserStore((s) => s.user)
  const refreshProfile = useUserStore((s) => s.refreshProfile)
  const setPendingQuestion = useUserStore((s) => s.setPendingQuestion)
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('idle')
  const [questions, setQuestions] = useState<Question[]>([])
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [result, setResult] = useState<ExamResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [restoring, setRestoring] = useState(true)
  const draftKey = `pdl-exam-draft-${user?.id}`
  useEffect(() => {
    let active = true
    api.pendingExam().then((list) => {
      if (!active || !list.length) return
      setQuestions(list); setPhase('exam')
      try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey) || '{}')
        if (JSON.stringify(draft.ids) === JSON.stringify(list.map((q) => q.id))) {
          setAnswers(draft.answers || {}); setIdx(Math.min(draft.idx || 0, list.length - 1))
        }
      } catch { /* Invalid local draft never overrides the server paper. */ }
    }).catch((e) => { if (active) setErr(e.message) }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [draftKey])
  useEffect(() => {
    if (phase === 'exam') sessionStorage.setItem(draftKey, JSON.stringify({ ids: questions.map((q) => q.id), answers, idx }))
  }, [draftKey, phase, questions, answers, idx])
  const locked = !!user?.isLocked

  // 抽题开始考试
  const start = async () => {
    if (!user) return
    if (locked) return
    setLoading(true)
    setErr('')
    try {
      const list = await api.randomQuestions(10)
      setQuestions(list)
      setAnswers({})
      setIdx(0)
      setResult(null)
      setPhase('exam')
      void refreshProfile().catch(() => {})
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抽题失败')
    } finally {
      setLoading(false)
    }
  }

  // 交卷
  const submit = async () => {
    if (!user) return
    setLoading(true)
    setErr('')
    try {
      const res = await api.submitExam({
        userId: user.id,
        questionIds: questions.map((q) => q.id),
        answers,
      })
      sessionStorage.removeItem(draftKey)
      setResult(res)
      setPhase('result')
      // 刷新用户额度锁定态（考试记录由后端持久化，个人页从 /exam/records 拉取）
      refreshProfile().catch(() => {})
    } catch (e) {
      setErr(e instanceof Error ? e.message : '交卷失败')
    } finally {
      setLoading(false)
    }
  }

  if (restoring) return <p className="p-6 text-center text-gray-500">正在检查未完成试卷…</p>

  // ---- 结果页 ----
  if (phase === 'result' && result) {
    const correctCount = result.details.filter((d) => d.correct).length
    const wrong = result.details.filter((d) => !d.correct)
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">本次得分</p>
          <p className="my-1 text-5xl font-bold text-primary">{result.score}</p>
          <p className="text-xs text-gray-400">满分 100</p>
          <p className="mt-3 text-sm text-gray-700">
            答对 <span className="font-semibold text-primary">{correctCount}</span> / {result.details.length} 题
          </p>
        </div>

        <button
          onClick={() => setPhase('idle')}
          className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
        >
          再来一次
        </button>

        {wrong.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">错题回顾（{wrong.length}）</h3>
            <div className="space-y-3">
              {wrong.map((d) => {
                const q = questions.find((x) => x.id === d.questionId)
                return (
                  <div key={d.questionId} className="rounded-xl bg-white p-4 shadow-sm">
                    <p className="mb-2 text-sm font-medium text-gray-900">{q?.stem}</p>
                    <div className="space-y-1 text-xs leading-relaxed">
                      <p className="text-red-600">
                        你的答案：{fmtAnswer(answers[String(d.questionId)], q?.options)}
                      </p>
                      <p className="text-green-600">
                        正确答案：{fmtAnswer(d.correctAnswer, q?.options)}
                      </p>
                      <p className="text-gray-600">解析：{d.explanation}</p>
                      {q?.source && <p className="text-gray-400">来源：{q.source}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- 考试中 ----
  if (phase === 'exam' && questions.length > 0) {
    const q = questions[idx]
    // 多选题至少选 2 项才算作答完成，否则不能下一题/交卷
    const val = answers[q.id]
    const answered =
      q.type === 'multi' ? Array.isArray(val) && val.length >= 2 : val != null && val !== ''
    return (
      <div className="relative flex h-full flex-col">
        {/* 进度条 */}
        <div className="shrink-0 bg-white px-4 pb-2 pt-3">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>进度</span>
            <span>
              {idx + 1} / {questions.length}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((idx + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <QuestionCard
            question={q}
            index={idx}
            total={questions.length}
            value={answers[q.id] ?? (q.type === 'multi' ? [] : '')}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
          />
        </div>

        {/* 底部操作 */}
        <div className="flex shrink-0 gap-3 border-t border-gray-200 bg-white px-4 py-3">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm text-gray-700 disabled:opacity-40"
          >
            上一题
          </button>
          {idx === questions.length - 1 ? (
            <button
              onClick={submit}
              disabled={loading || !answered}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? '提交中…' : '交卷'}
            </button>
          ) : (
            <button
              onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
              disabled={!answered}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white ${
                answered ? 'bg-primary' : 'bg-primary/40'
              }`}
            >
              下一题
            </button>
          )}
        </div>

        {/* 问 AI：把当前题目完整内容带到对话页 */}
        <button
          onClick={() => {
            const opts = q.options
              .map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)
              .join('\n')
            const text = `题目：${q.stem}\n${opts}\n题型：${q.type === 'single' ? '单选' : q.type === 'multi' ? '多选' : '判断'}\n请帮我分析这道题，给出正确答案并解释原因。`
            setPendingQuestion(text)
            navigate('/chat')
          }}
          className="mx-4 mt-4 mb-3 w-[calc(100%-2rem)] rounded-xl border border-primary/40 bg-primary/5 py-2 text-xs font-medium text-primary"
        >
          💬 这道题不会？问 AI
        </button>
        {err && <p className="px-4 py-2 text-center text-xs text-primary">{err}</p>}
      </div>
    )
  }

  // ---- 起始页 ----
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-2 text-6xl">📚</div>
      <h1 className="mb-2 text-xl font-semibold text-gray-900">模拟考试</h1>
      <p className="mb-1 text-sm text-gray-500">每次随机抽取 10 道题</p>
      <p className="mb-4 text-sm text-gray-500">覆盖胖东来文化核心理念</p>
      <p className="mb-8 text-xs text-gray-400">学习练习题库，非官方招聘考试。包含2025年公示题及资料练习题。</p>
      <button
        onClick={start}
        disabled={loading}
        className="w-full max-w-xs rounded-full bg-primary px-8 py-3 text-base font-semibold text-white shadow-lg disabled:opacity-60"
      >
        {loading ? '抽题中…' : '开始考试'}
      </button>
      {err && <p className="mt-4 text-xs text-primary">{err}</p>}
      {locked && <LockOverlay />}
    </div>
  )
}
