// 管理后台通用小组件

// 分页器
export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (p: number) => void
}) {
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 disabled:opacity-40"
      >
        上一页
      </button>
      <span className="text-gray-600">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  )
}
