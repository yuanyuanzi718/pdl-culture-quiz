import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adminApi,
  type AdminQuestion,
  type QuestionPayload,
} from '../../api/adminClient'
import { Pager } from './ui'

const PAGE_SIZE = 20
const TYPE_LABEL: Record<string, string> = {
  single: '单选',
  multi: '多选',
  judge: '判断',
}

// 字母 <-> 下标
const idxToLetter = (i: number) => String.fromCharCode(65 + i)
const letterToIdx = (l: string) => l.toUpperCase().charCodeAt(0) - 65

// 把后端 answer 还原为正确选项下标集合
function answerToIndexes(q: AdminQuestion | null, type: string): number[] {
  if (!q) return []
  if (type === 'multi') {
    const arr = Array.isArray(q.answer) ? q.answer : []
    return arr.map(letterToIdx).filter((i) => i >= 0)
  }
  const letter = Array.isArray(q.answer) ? q.answer[0] : q.answer
  return letter ? [letterToIdx(letter)] : []
}

interface FormState {
  type: 'single' | 'multi' | 'judge'
  stem: string
  options: string[]
  correct: number[]
  explanation: string
  source: string
  tags: string
}

const emptyForm = (): FormState => ({
  type: 'single',
  stem: '',
  options: ['', ''],
  correct: [],
  explanation: '',
  source: '',
  tags: '',
})

export default function AdminQuestions() {
  const [list, setList] = useState<AdminQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AdminQuestion | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    adminApi
      .listQuestions({ page, size: PAGE_SIZE, keyword: search })
      .then((d) => {
        setList(d.list)
        setTotal(d.total)
      })
      .catch(() => alert('加载题目失败'))
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(load, [load])

  const openCreate = () => {
    setEditing(null)
    setShowForm(true)
  }

  const openEdit = (q: AdminQuestion) => {
    setEditing(q)
    setShowForm(true)
  }

  const remove = async (q: AdminQuestion) => {
    if (!confirm(`确定删除该题目？\n${q.stem}`)) return
    try {
      await adminApi.deleteQuestion(q.id)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">
          题库管理 <span className="text-sm font-normal text-gray-400">共 {total} 题</span>
        </h1>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          + 新增题目
        </button>
      </div>

      {/* 搜索 */}
      <div className="mb-4 flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1)
              setSearch(keyword.trim())
            }
          }}
          placeholder="按题干关键词搜索"
          className="min-w-0 flex-1 md:max-w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={() => {
            setPage(1)
            setSearch(keyword.trim())
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
        >
          搜索
        </button>
      </div>

      {/* 列表 */}
      <div className="admin-table-wrap overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="admin-table w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">题型</th>
              <th className="px-4 py-3">题干</th>
              <th className="px-4 py-3">来源</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  暂无题目
                </td>
              </tr>
            )}
            {list.map((q) => (
              <tr key={q.id} className="hover:bg-gray-50">
                <td data-label="ID" className="px-4 py-3 text-gray-400">{q.id}</td>
                <td data-label="题型" className="px-4 py-3">
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {TYPE_LABEL[q.type]}
                  </span>
                </td>
                <td data-label="题干" className="max-w-md px-4 py-3">
                  <p className="break-words text-gray-800 md:line-clamp-2">{q.stem}</p>
                  <p className="mt-0.5 text-xs text-green-600">
                    答案：
                    {Array.isArray(q.answer) ? q.answer.join('、') : q.answer}
                  </p>
                </td>
                <td data-label="来源" className="px-4 py-3 text-xs text-gray-500">{q.source || '—'}</td>
                <td data-label="操作" className="px-4 py-3 text-right">
                  <button
                    onClick={() => openEdit(q)}
                    className="mr-3 text-sm text-primary hover:underline"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => remove(q)}
                    className="text-sm text-gray-500 hover:text-primary"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <Pager page={page} totalPages={totalPages} onChange={setPage} />

      {showForm && (
        <QuestionForm
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            load()
          }}
        />
      )}
    </div>
  )
}

// ---- 新增/编辑题目弹窗 ----
function QuestionForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: AdminQuestion | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (!editing) return emptyForm()
    return {
      type: editing.type,
      stem: editing.stem,
      options: [...editing.options],
      correct: answerToIndexes(editing, editing.type),
      explanation: editing.explanation || '',
      source: editing.source || '',
      tags: editing.tags.join(', '),
    }
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
      if (event.key !== 'Tab') return
      const fields = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])
      const first = fields[0], last = fields[fields.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [onClose, saving])

  const setType = (type: FormState['type']) => {
    // 切换题型时清空已选答案，避免单选保留多个
    setForm((f) => ({ ...f, type, options: type === 'judge' ? ['正确', '错误'] : f.options, correct: [] }))
  }

  const setOption = (i: number, val: string) => {
    setForm((f) => {
      const options = [...f.options]
      options[i] = val
      return { ...f, options }
    })
  }

  const addOption = () => setForm((f) => ({ ...f, options: [...f.options, ''] }))

  const removeOption = (i: number) => {
    setForm((f) => {
      if (f.options.length <= 2) return f
      const options = f.options.filter((_, idx) => idx !== i)
      // 移除后重映射正确答案下标
      const correct = f.correct
        .filter((idx) => idx !== i)
        .map((idx) => (idx > i ? idx - 1 : idx))
      return { ...f, options, correct }
    })
  }

  const toggleCorrect = (i: number) => {
    setForm((f) => {
      if (f.type === 'multi') {
        const has = f.correct.includes(i)
        return { ...f, correct: has ? f.correct.filter((x) => x !== i) : [...f.correct, i] }
      }
      return { ...f, correct: [i] }
    })
  }

  const save = async () => {
    setErr('')
    const options = form.options.map((o) => o.trim())
    if (options.some((o) => !o)) return setErr('请填写所有选项，或删除空选项')
    if (form.type === 'multi' && form.correct.length < 2) return setErr('多选题至少选择两个正确答案')
    if (!form.stem.trim()) return setErr('题干不能为空')
    if (options.length < 2) return setErr('选项至少需要 2 个')
    if (form.correct.length === 0) return setErr('请选择正确答案')
    if (form.type !== 'multi' && form.correct.length > 1) return setErr('单选题只能有一个正确答案')

    const payload: QuestionPayload = {
      type: form.type,
      stem: form.stem.trim(),
      options,
      answer:
        form.type === 'multi'
          ? [...form.correct].sort((a, b) => a - b).map(idxToLetter)
          : idxToLetter(form.correct[0]),
      explanation: form.explanation.trim() || null,
      source: form.source.trim() || null,
      tags: form.tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    }

    setSaving(true)
    try {
      if (editing) {
        await adminApi.updateQuestion(editing.id, payload)
      } else {
        await adminApi.createQuestion(payload)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="question-form-title" className="admin-dialog max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="question-form-title" className="mb-4 text-lg font-semibold text-gray-900">
          {editing ? `编辑题目 #${editing.id}` : '新增题目'}
        </h2>

        {/* 题型 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-gray-500">题型</label>
          <div className="flex gap-2">
            {(['single', 'multi', 'judge'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-lg px-4 py-2 text-sm ${
                  form.type === t
                    ? 'bg-primary text-white'
                    : 'border border-gray-300 text-gray-700'
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {/* 题干 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-gray-500">题干</label>
          <textarea
            aria-label="题干"
            value={form.stem}
            onChange={(e) => setForm((f) => ({ ...f, stem: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* 选项 + 正确答案 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-gray-500">
            选项（点击左侧圆点标记正确答案{form.type === 'multi' ? '，可多选' : ''}）
          </label>
          <div className="space-y-2">
            {form.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`将选项 ${idxToLetter(i)} 设为正确答案`}
                  aria-pressed={form.correct.includes(i)}
                  onClick={() => toggleCorrect(i)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs ${
                    form.correct.includes(i)
                      ? 'bg-green-600 text-white'
                      : 'border border-gray-300 text-transparent'
                  }`}
                >
                  ✓
                </button>
                <span className="w-5 shrink-0 text-xs text-gray-400">{idxToLetter(i)}</span>
                <input
                  value={opt}
                  readOnly={form.type === 'judge'}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`选项 ${idxToLetter(i)}`}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label={`删除选项 ${idxToLetter(i)}`}
                  disabled={form.options.length <= 2 || form.type === 'judge'}
                  className="shrink-0 min-w-[44px] min-h-[44px] px-2 text-gray-400 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={form.type === 'judge' || form.options.length >= 26}
            onClick={addOption}
            className="mt-2 text-sm text-primary hover:underline"
          >
            + 添加选项
          </button>
        </div>

        {/* 解析 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-gray-500">解析（可选）</label>
          <textarea
            aria-label="解析"
            value={form.explanation}
            onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* 来源 + 标签 */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs text-gray-500">来源</label>
            <input
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="如：幸福生命手册"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-gray-500">标签（逗号分隔）</label>
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="如：理念, 服务"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        {err && <p className="mb-3 text-sm text-primary">{err}</p>}

        <div className="admin-dialog-actions flex justify-end gap-2">
          <button
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-700"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
