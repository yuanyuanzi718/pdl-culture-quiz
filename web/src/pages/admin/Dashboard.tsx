import { useEffect, useState } from 'react'
import { adminApi, type AdminStats } from '../../api/adminClient'
import { Pager } from './ui'

const PAGE_SIZE = 7

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(1)
  const load = () => {
    setErr('')
    adminApi.getStats().then(setStats).catch(e => setErr(e instanceof Error ? e.message : '加载失败'))
  }
  useEffect(load, [])
  if (err) return <div className="p-8 text-center text-sm">{err}<button onClick={load} className="ml-2 underline">重试</button></div>
  if (!stats) return <div className="p-8 text-center text-sm text-gray-400">加载中…</div>
  const totalPages = Math.max(1, Math.ceil(stats.daily.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const dailyRows = [...stats.daily].reverse().slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const cards = [
    { label: '今日访问人数', value: stats.today.visitors },
    { label: '今日新用户', value: stats.today.newUsers },
    { label: '今日答题人数 / 交卷次数', value: `${stats.today.examUsers} / ${stats.today.exams}` },
    { label: '今日提问人数 / 成功对话', value: `${stats.today.chatUsers} / ${stats.today.chats}` },
    { label: '今日 AI 失败次数', value: stats.today.aiFailures },
    { label: '今日激活会员', value: stats.today.activations },
    { label: '累计用户 / 已激活会员', value: `${stats.userCount} / ${stats.activatedVipCount}` },
    { label: '累计登记收款（元）', value: `¥${stats.paidAmount.toFixed(2)}` },
  ]
  return <div>
    <div className="mb-5 flex items-center justify-between"><h1 className="text-xl font-semibold">数据概览</h1><button onClick={load} className="text-sm text-primary">刷新</button></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(c => <div key={c.label} className="rounded-xl bg-white p-4 shadow-sm"><p className="text-2xl font-bold">{c.value}</p><p className="mt-2 text-xs text-gray-500">{c.label}</p></div>)}</div>
    <h2 className="mb-3 mt-6 font-semibold">近 30 天使用情况</h2>
    <p className="mb-3 text-xs leading-5 text-gray-500">按北京时间统计，同一设备每天算 1 人。访问和 AI 失败从 {stats.trackingSince} 起记录，之前显示“—”。答题只计交卷，对话只计成功提问。</p>
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full whitespace-nowrap text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr>{['日期','访问人数','新用户','答题人数','交卷次数','提问人数','成功对话','AI 失败','会员激活'].map(t => <th key={t} className="px-3 py-3">{t}</th>)}</tr></thead><tbody>{dailyRows.map(d => <tr key={d.day} className="border-t border-gray-100">{[d.day,d.day < stats.trackingSince ? '—' : d.visitors,d.newUsers,d.examUsers,d.exams,d.chatUsers,d.chats,d.day < stats.trackingSince ? '—' : d.aiFailures,d.activations].map((v,i) => <td key={i} className="px-3 py-3">{v}</td>)}</tr>)}</tbody></table></div>
    <Pager page={currentPage} totalPages={totalPages} onChange={setPage} />
    <p className="mt-3 text-xs text-gray-500">观察“访问 → 答题 / 提问 → 会员激活”的变化；AI 失败增多时优先检查服务。</p>
  </div>
}
