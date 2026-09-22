import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useUserStore } from '../store/user'
import type { ExamRecord } from '../types'
import WeChatContactModal from '../components/WeChatContactModal'

// 时间戳格式化：MM-DD HH:mm
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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
            用户编号 {user.id} · {activated ? `激活码 ${user.vipCode}` : '未激活 VIP'}
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

      {/* 模考历史（来自后端） */}
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-800">模考历史</p>
        <div className="flex justify-around text-center">
          <div>
            <p className="text-2xl font-bold text-primary">{maxScore}</p>
            <p className="text-xs text-gray-400">最高分</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-700">{totalExams}</p>
            <p className="text-xs text-gray-400">累计次数</p>
          </div>
        </div>
        {historyError && <p role="alert" className="text-sm text-red-600">{historyError}</p>}
        {records.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs text-gray-400">最近成绩</p>
            <div className="space-y-1.5">
              {records.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">{fmtTime(r.createdAt)}</span>
                  <span
                    className={`font-semibold ${
                      r.score >= 60 ? 'text-primary' : 'text-gray-500'
                    }`}
                  >
                    {r.score} 分
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
            <p className="my-1 text-xs text-white/80">无限刷题 · AI 对话 · 完整解析</p>
            <p className="mb-3 text-xs text-white/70">
              💡 AI 对话和服务器都要花钱，收点费用才能持续运营，感谢理解 🙏
            </p>
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
