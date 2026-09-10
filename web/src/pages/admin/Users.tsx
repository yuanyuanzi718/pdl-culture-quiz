import { useCallback, useEffect, useState } from 'react'
import { adminApi, type AdminUser } from '../../api/adminClient'
import { fmtTime } from './AdminApp'
import { Pager } from './ui'

const PAGE_SIZE = 20

export default function AdminUsers() {
  const [list, setList] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    adminApi
      .listUsers({ page, size: PAGE_SIZE })
      .then((d) => {
        setList(d.list)
        setTotal(d.total)
      })
      .catch(() => alert('加载用户失败'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(load, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-gray-900">
        用户管理 <span className="text-sm font-normal text-gray-400">共 {total} 人</span>
      </h1>

      <div className="admin-table-wrap overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="admin-table w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户标识</th>
              <th className="px-4 py-3">VIP 状态</th>
              <th className="px-4 py-3">免费已用</th>
              <th className="px-4 py-3">考试次数</th>
              <th className="px-4 py-3">注册时间</th>
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
                  暂无用户
                </td>
              </tr>
            )}
            {list.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td data-label="ID" className="px-4 py-3 text-gray-400">{u.id}</td>
                <td data-label="用户标识" className="px-4 py-3 font-medium text-gray-800">{u.phone || `用户 #${u.id}`}</td>
                <td data-label="VIP 状态" className="px-4 py-3">
                  {u.vipActivatedAt ? (
                    <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                      👑 VIP
                    </span>
                  ) : u.isLocked ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-600">
                      🔒 已锁定
                    </span>
                  ) : (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      免费
                    </span>
                  )}
                </td>
                <td data-label="免费已用" className="px-4 py-3 text-gray-600">{u.freeUsedCount}</td>
                <td data-label="考试次数" className="px-4 py-3 text-gray-600">{u.examCount}</td>
                <td data-label="注册时间" className="px-4 py-3 text-xs text-gray-500">{fmtTime(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}
