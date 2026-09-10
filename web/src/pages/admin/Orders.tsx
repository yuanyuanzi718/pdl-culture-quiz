import { useCallback, useEffect, useState } from 'react'
import { adminApi, type AdminOrder } from '../../api/adminClient'
import { fmtTime } from './AdminApp'
import { Pager } from './ui'

const PAGE_SIZE = 20

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  paid: { text: '已支付', cls: 'bg-green-100 text-green-700' },
  pending: { text: '待支付', cls: 'bg-yellow-100 text-yellow-700' },
  failed: { text: '已失败', cls: 'bg-red-100 text-red-600' },
}

export default function AdminOrders() {
  const [list, setList] = useState<AdminOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    adminApi
      .listOrders({ page, size: PAGE_SIZE })
      .then((d) => {
        setList(d.list)
        setTotal(d.total)
      })
      .catch(() => alert('加载订单失败'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(load, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-gray-900">
        订单管理 <span className="text-sm font-normal text-gray-400">共 {total} 单</span>
      </h1>

      <div className="admin-table-wrap overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="admin-table w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">金额</th>
              <th className="px-4 py-3">商户单号</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">创建时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  暂无订单
                </td>
              </tr>
            )}
            {list.map((o) => {
              const s = STATUS_LABEL[o.status] || { text: o.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td data-label="ID" className="px-4 py-3 text-gray-400">{o.id}</td>
                  <td data-label="用户" className="px-4 py-3 text-gray-800">
                    {o.userPhone || `用户#${o.userId}`}
                  </td>
                  <td data-label="金额" className="px-4 py-3 font-semibold text-gray-900">¥{o.amount.toFixed(2)}</td>
                  <td data-label="商户单号" className="px-4 py-3 text-xs text-gray-500">{o.tradeNo || '—'}</td>
                  <td data-label="状态" className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.text}</span>
                  </td>
                  <td data-label="创建时间" className="px-4 py-3 text-xs text-gray-500">{fmtTime(o.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}
