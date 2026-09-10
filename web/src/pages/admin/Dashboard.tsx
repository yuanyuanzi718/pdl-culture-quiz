import { useEffect, useState } from 'react'
import { adminApi, type AdminStats } from '../../api/adminClient'

// 数据概览：核心运营指标卡片
export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [err, setErr] = useState('')

  const load = () => {
    adminApi
      .getStats()
      .then(setStats)
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'))
  }

  useEffect(load, [])

  if (err) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-sm text-primary">
        {err}
        <button onClick={load} className="ml-2 text-primary underline">
          重试
        </button>
      </div>
    )
  }

  if (!stats) {
    return <div className="p-8 text-center text-sm text-gray-400">加载中…</div>
  }

  const cards = [
    { label: '用户总数', value: stats.userCount, icon: '👥' },
    { label: '题目总数', value: stats.questionCount, icon: '📚' },
    { label: '订单总数', value: stats.orderCount, icon: '🧾' },
    { label: '已支付订单', value: stats.paidOrderCount, icon: '✅' },
    { label: '支付总额（元）', value: `¥${stats.paidAmount.toFixed(2)}`, icon: '💰' },
    { label: 'VIP 码总数', value: stats.vipCodeCount, icon: '🎟️' },
    { label: '已激活 VIP', value: stats.activatedVipCount, icon: '👑' },
  ]

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-gray-900">数据概览</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="break-words rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-2 text-2xl">{c.icon}</div>
            <p className="text-xl font-bold text-gray-900 sm:text-2xl">{c.value}</p>
            <p className="mt-1 text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
