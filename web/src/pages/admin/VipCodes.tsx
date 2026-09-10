import { useCallback, useEffect, useState } from 'react'
import { adminApi, type AdminVipCode } from '../../api/adminClient'
import { fmtTime } from './AdminApp'
import { Pager } from './ui'

const PAGE_SIZE = 20

// 小工具：复制文本到剪贴板，返回是否成功
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  available: { text: '可用', cls: 'bg-gray-100 text-gray-600' },
  sent: { text: '已发放', cls: 'bg-blue-100 text-blue-700' },
  used: { text: '已使用', cls: 'bg-green-100 text-green-700' },
}

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'available', label: '可用' },
  { value: 'sent', label: '已发放' },
  { value: 'used', label: '已使用' },
]

export default function AdminVipCodes() {
  const [wechatId, setWechatId] = useState('')
  const [amount, setAmount] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issueTip, setIssueTip] = useState('')
  const [lastCode, setLastCode] = useState('')
  const [copiedCode, setCopiedCode] = useState('')
  const [issueError, setIssueError] = useState('')
  const [list, setList] = useState<AdminVipCode[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    adminApi
      .listVipCodes({ page, size: PAGE_SIZE, status })
      .then((d) => {
        setList(d.list)
        setTotal(d.total)
      })
      .catch(() => alert('加载 VIP 码失败'))
      .finally(() => setLoading(false))
  }, [page, status])

  useEffect(load, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-gray-900">
        VIP 激活码 <span className="text-sm font-normal text-gray-400">共 {total} 个</span>
      </h1>

      <form className="admin-issue-form mb-5 space-y-3 rounded-xl bg-white p-4" onSubmit={async (e) => {
        e.preventDefault(); setIssuing(true); setIssueTip(''); setIssueError(''); setLastCode('')
        try {
          const trimmedWechat = wechatId.trim()
          const trimmedAmount = amount.trim()
          const payload: { wechatId?: string; amount?: number } = {}
          if (trimmedWechat) payload.wechatId = trimmedWechat
          if (trimmedAmount) {
            const n = Number(trimmedAmount)
            if (!Number.isFinite(n) || n <= 0) throw new Error('金额必须是大于 0 的数字')
            payload.amount = n
          }
          const result = await adminApi.issueCode(payload)
          setLastCode(result.code)
          setIssueTip('已生成激活码，请发给对应用户。')
          setWechatId('')
          setAmount('')
          load()
        } catch (error) {
          setIssueError(error instanceof Error ? error.message : '发码失败')
        } finally { setIssuing(false) }
      }}>
        <p className="font-semibold">生成激活码</p>
        <p className="text-xs text-gray-500">付费用户填写微信号与金额；赠送时留空即可直接生成</p>
        <label className="block text-sm">微信号（可选）<input value={wechatId} onChange={(e) => setWechatId(e.target.value)} placeholder="付费时填写，赠送留空" className="mt-2 block w-full min-w-0 rounded border p-3" /></label>
        <label className="block text-sm">交易金额（可选，元）<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="付费时填写，赠送留空" className="mt-2 block w-full min-w-0 rounded border p-3" /></label>
        <button disabled={issuing} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-40">{issuing ? '生成中…' : '生成激活码'}</button>
        {lastCode && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <div>
              <p className="text-xs text-gray-500">{issueTip}</p>
              <p className="font-mono text-lg font-bold tracking-wider text-green-700">{lastCode}</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (await copyText(lastCode)) {
                  setCopiedCode(lastCode)
                  setTimeout(() => setCopiedCode(''), 2000)
                }
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white active:scale-95 ${
                copiedCode === lastCode ? 'bg-green-500' : 'bg-primary'
              }`}
            >
              {copiedCode === lastCode ? '✓ 已复制' : '复制激活码'}
            </button>
          </div>
        )}
        {issueError && <p role="status" className="break-all text-sm text-red-600">{issueError}</p>}
      </form>
      {/* 状态筛选 */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setPage(1)
              setStatus(f.value)
            }}
            className={`w-full rounded-lg px-4 py-1.5 text-center text-sm sm:w-auto ${
              status === f.value ? 'bg-primary text-white' : 'border border-gray-300 bg-white text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="admin-table-wrap overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="admin-table w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3">激活码</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">领取用户</th>
              <th className="px-4 py-3">微信号</th>
              <th className="px-4 py-3">金额</th>
              <th className="px-4 py-3">发放时间</th>
              <th className="px-4 py-3">激活时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  暂无 VIP 码
                </td>
              </tr>
            )}
            {list.map((c) => {
              const s = STATUS_LABEL[c.status] || { text: c.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <tr key={c.code} className="hover:bg-gray-50">
                  <td data-label="激活码" className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold tracking-wider text-gray-900">
                        {c.code}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await copyText(c.code)) {
                            setCopiedCode(c.code)
                            setTimeout(() => setCopiedCode(''), 2000)
                          }
                        }}
                        className={`rounded px-2 py-0.5 text-xs text-white active:scale-95 ${
                          copiedCode === c.code ? 'bg-green-500' : 'bg-gray-400 hover:bg-gray-500'
                        }`}
                      >
                        {copiedCode === c.code ? '✓' : '复制'}
                      </button>
                    </div>
                  </td>
                  <td data-label="状态" className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.text}</span>
                  </td>
                  <td data-label="领取用户" className="px-4 py-3 text-gray-700">
                    {c.userPhone || (c.userId ? `用户#${c.userId}` : '—')}
                  </td>
                  <td data-label="微信号" className="px-4 py-3 text-gray-700">{c.wechatId || '—'}</td>
                  <td data-label="金额" className="px-4 py-3 text-gray-700">{c.amount != null ? `¥${c.amount}` : '—'}</td>
                  <td data-label="发放时间" className="px-4 py-3 text-xs text-gray-500">{fmtTime(c.sentAt)}</td>
                  <td data-label="激活时间" className="px-4 py-3 text-xs text-gray-500">{fmtTime(c.activatedAt)}</td>
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
