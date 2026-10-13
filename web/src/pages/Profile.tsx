import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useUserStore } from '../store/user'
import type { ExamDetailItem, ExamRecord } from '../types'
import WeChatContactModal from '../components/WeChatContactModal'

// 时间戳格式化：MM-DD HH:mm
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 用户答案转字母显示
function fmtUserAnswer(raw: string, _correct: string | string[], type: string, options: string[]): string {
  if (type === 'multi') {
    try {
      const arr: string[] = JSON.parse(raw)
      return arr.map((v) => toLetter(v, options)).join('')
    } catch {
      return raw || '未作答'
    }
  }
  return raw ? toLetter(raw, options) : '未作答'
}

function toLetter(value: string, options: string[]): string {
  if (!value) return ''
  if (/^[A-Za-z]$/.test(value)) return value.toUpperCase()
  const idx = options.indexOf(value)
  return idx >= 0 ? String.fromCharCode(65 + idx) : value.toUpperCase()
}

// 渲染每题详情
function QuestionDetail({ d }: { d: ExamDetailItem }) {
  const correctArr = Array.isArray(d.correctAnswer) ? d.correctAnswer : [d.correctAnswer]
  const userLetter = fmtUserAnswer(d.userAnswer, d.correctAnswer, d.type, d.options)
  const correctLetter = correctArr.join('')

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-start gap-2 text-sm">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          d.type === 'single' ? 'bg-blue-100 text-blue-700' :
          d.type === 'multi' ? 'bg-purple-100 text-purple-700' :
          'bg-amber-100 text-amber-700'
        }`}>
          {d.type === 'single' ? '单选' : d.type === 'multi' ? '多选' : '判断'}
        </span>
        <span className="flex-1 leading-relaxed text-gray-800">{d.stem}</span>
        <span className={`shrink-0 text-xs font-semibold ${d.correct ? 'text-green-600' : 'text-red-500'}`}>
          {d.correct ? '✓ 对' : '✗ 错'}
        </span>
      </div>
      <div className="mt-2 space-y-1.5 text-xs">
        {d.options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i)
          const isCorrect = correctArr.includes(letter)
          return (
            <div key={i} className={`flex items-start gap-2 rounded px-2 py-1 ${
              isCorrect ? 'bg-green-50' : ''
            }`}>
              <span className={`shrink-0 font-semibold ${isCorrect ? 'text-green-600' : 'text-gray-400'}`}>{letter}.</span>
              <span className={isCorrect ? 'text-green-700' : 'text-gray-600'}>{opt}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className="text-green-600">正确答案：{correctLetter}</span>
        <span className={d.correct ? 'text-gray-500' : 'text-red-500'}>你的答案：{userLetter}</span>
      </div>
      {d.explanation && (
        <div className="mt-2 rounded bg-blue-50 p-2 text-[11px] text-gray-600">
          <span className="font-semibold text-blue-600">解析：</span>{d.explanation}
        </div>
      )}
    </div>
  )
}

export default function Profile() {
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const unbindVip = useUserStore((s) => s.unbindVip)

  const [vipCode, setVipCode] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [tip, setTip] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<'vip' | 'unbind' | null>(null)
  const [records, setRecords] = useState<ExamRecord[]>([])
  const [showWeChat, setShowWeChat] = useState(false)
  const [openRecordId, setOpenRecordId] = useState<number | null>(null)

  // 拉取后端模考历史
  useEffect(() => {
    if (!user) return
    api
      .examRecords(user.id)
      .then(setRecords)
      .catch(() => {
        setHistoryError('考试记录加载失败，请刷新重试')
      })
  }, [user?.id])

  const maxScore = records.length ? Math.max(...records.map((r) => r.score)) : 0
  const totalExams = records.length

  if (!user) {
    return <div className="p-6 text-center text-sm text-gray-500">请先登录</div>
  }

  const activated = !!user.vipActivatedAt
  const remainFree = Math.max(0, user.freeExamLimit - user.freeUsedCount)

  // 激活 VIP 码
  const activate = async () => {
    if (!vipCode.trim()) return
    setLoading('vip')
    setTip('')
    setError('')
    try {
      const res = await api.activateVip({ userId: user.id, code: vipCode.trim() })
      if (res.activated && res.user) {
        setUser(res.user)
        setTip('🎉 VIP 激活成功')
        setVipCode('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '激活失败')
    } finally {
      setLoading(null)
    }
  }

  // 解绑 VIP：释放激活码，可在其他设备重新激活
  const unbind = async () => {
    if (!confirm('确定解绑此设备？解绑后激活码可在其他设备使用，本设备将回到免费用户。')) return
    setLoading('unbind')
    setTip('')
    setError('')
    try {
      await unbindVip()
      setTip('已解绑，激活码已释放')
    } catch (e) {
      setError(e instanceof Error ? e.message : '解绑失败')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="px-4 py-5">
      {/* 头像 + 用户标识 */}
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl text-white">
          {activated ? '👑' : '👤'}
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900">
            {activated ? 'VIP 会员' : '免费用户'}
          </p>
          <p className="text-xs text-gray-400">
            {user.displayName || '研习者'} · {activated ? `激活码 ${user.vipCode}` : '未激活 VIP'}
          </p>
        </div>
      </div>

      {/* 状态卡片 */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-xs text-gray-400">VIP 状态</p>
          <p className={`mt-1 text-sm font-semibold ${activated ? 'text-primary' : 'text-gray-500'}`}>
            {activated ? '已激活' : '未激活'}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-xs text-gray-400">剩余免费次数</p>
          <p className="mt-1 text-sm font-semibold text-gray-700">
            {activated ? '无限' : `${remainFree} / ${user.freeExamLimit}`}
          </p>
        </div>
      </div>

      {/* 考试记录：最近 10 次，按试卷展开 */}
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">考试记录</p>
          <span className="text-xs text-gray-400">最近 {totalExams} 次 · 最高 {maxScore} 分</span>
        </div>
        {historyError && <p role="alert" className="mb-2 text-sm text-red-600">{historyError}</p>}
        {records.length === 0 && !historyError && (
          <p className="py-4 text-center text-sm text-gray-400">还没有答题记录</p>
        )}
        <div className="space-y-2">
          {records.map((r) => {
            const open = openRecordId === r.id
            return (
              <div key={r.id} className="overflow-hidden rounded-xl border border-gray-100">
                <button
                  onClick={() => setOpenRecordId(open ? null : r.id)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-bold ${
                      r.score >= 80 ? 'text-green-600' : r.score >= 60 ? 'text-primary' : 'text-red-500'
                    }`}>{r.score}</span>
                    <span className="text-xs text-gray-400">
                      {r.correctCount}/{r.total} 对 · 错 {r.wrongCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{fmtTime(r.createdAt)}</span>
                    <span className={`text-xs ${open ? 'text-gray-400' : 'text-gray-300'}`}>{open ? '▲' : '▼'}</span>
                  </div>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-3">
                    {r.details.map((d) => (
                      <QuestionDetail key={d.questionId} d={d} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* VIP 区域：已激活显示解绑，未激活显示激活码输入 + 支付 */}
      {activated ? (
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-gray-800">VIP 已激活</p>
          <p className="mb-3 text-xs text-gray-400">
            本设备已绑定激活码 <span className="font-mono text-primary">{user.vipCode}</span>
            ，解绑后可在其他设备激活使用。
          </p>
          <button
            onClick={unbind}
            disabled={loading !== null}
            className="w-full rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-600 disabled:opacity-60"
          >
            {loading === 'unbind' ? '解绑中…' : '解绑此设备'}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-gray-800">VIP 激活码</p>
            <div className="flex gap-2">
              <input
                value={vipCode}
                onChange={(e) => setVipCode(e.target.value)}
                placeholder="请输入激活码"
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={activate}
                disabled={loading !== null}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                激活
              </button>
            </div>
          </div>

          {/* 解锁区：未激活时展示，引导加微信客服人工转账 */}
          <div className="mt-3 rounded-2xl bg-gradient-to-br from-primary to-red-700 p-5 text-center text-white shadow-sm">
            <p className="text-sm">解锁全部功能</p>
            <p className="my-1 text-xs text-white/80">刷题 · AI 对话 · 完整解析</p>
            <button
              onClick={() => setShowWeChat(true)}
              className="w-full rounded-full bg-white py-2.5 text-sm font-bold text-primary"
            >
              立即解锁 ¥9.9
            </button>
          </div>
        </>
      )}

      {/* 幸福生命手册入口：新窗口打开飞书文档 */}
      <a
        href="https://pdl.feishu.cn/wiki/Kc5TwZUdIiYcmpknRfbcd2TOnKe"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 shadow-sm active:scale-[0.98]"
      >
        <span className="text-base">📖</span>
        查看幸福生命手册
      </a>

      {tip && <p className="mt-3 text-center text-xs text-primary">{tip}</p>}

      {/* 错误弹窗：激活/解绑失败时醒目提示 */}
      {error && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
          onClick={() => setError('')}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-4xl">⚠️</div>
            <p className="mt-2 text-base font-semibold text-gray-900">提示</p>
            <p className="mt-1 text-sm text-gray-600">{error}</p>
            <button
              onClick={() => setError('')}
              className="mt-5 w-full rounded-full bg-primary py-2.5 text-sm font-medium text-white active:scale-95"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {showWeChat && <WeChatContactModal onClose={() => setShowWeChat(false)} />}
    </div>
  )
}
