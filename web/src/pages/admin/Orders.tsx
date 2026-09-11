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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editWechat, setEditWechat] = useState('')
  const [editStatus, setEditStatus] = useState('')

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

  const startEdit = (o: AdminOrder) => {
    setEditingId(o.id)
    setEditAmount(o.amount != null ? String(o.amount) : '')
    setEditWechat(o.wechatId || '')
    setEditStatus(o.status)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (id: number) => {
    const amount = editAmount.trim() ? Number(editAmount.trim()) : null
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      alert('金额无效')
      return
    }
    try {
      await adminApi.updateOrder(id, {
        amount,
        wechatId: editWechat.trim() || undefined,
        status: editStatus || undefined,
      })
      setEditingId(null)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败')
    }
  }

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
              <th className="px-4 py-3">微信号</th>
              <th className="px-4 py-3">商户单号</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  暂无订单
                </td>
              </tr>
            )}
            {list.map((o) => {
              const isEditing = editingId === o.id
              const s = STATUS_LABEL[o.status] || { text: o.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td data-label="ID" className="px-4 py-3 text-gray-400">{o.id}</td>
                  <td data-label="用户" className="px-4 py-3 text-gray-800">
                    {o.userPhone || `用户#${o.userId}`}
                  </td>
                  <td data-label="金额" className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-24 rounded border px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="font-semibold text-gray-900">
                        {o.amount != null ? `¥${o.amount.toFixed(2)}` : '—'}
                      </span>
                    )}
                  </td>
                  <td data-label="微信号" className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editWechat}
                        onChange={(e) => setEditWechat(e.target.value)}
                        placeholder="微信号"
                        className="w-32 rounded border px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-gray-700">{o.wechatId || '—'}</span>
                    )}
                  </td>
                  <td data-label="商户单号" className="px-4 py-3 text-xs text-gray-500">{o.tradeNo || '—'}</td>
                  <td data-label="状态" className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                      >
                        <option value="pending">待支付</option>
                        <option value="paid">已支付</option>
                        <option value="failed">已失败</option>
                      </select>
                    ) : (
                      <span className={`rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.text}</span>
                    )}
                  </td>
                  <td data-label="创建时间" className="px-4 py-3 text-xs text-gray-500">{fmtTime(o.createdAt)}</td>
                  <td data-label="操作" className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(o.id)}
                          className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded bg-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-300"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(o)}
                        className="rounded bg-blue-50 px-3 py-1 text-xs text-blue-600 hover:bg-blue-100"
                      >
                        编辑
                      </button>
                    )}
                  </td>
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
