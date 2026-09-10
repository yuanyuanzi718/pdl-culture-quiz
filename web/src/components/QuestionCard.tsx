import type { Question } from '../types'

interface Props {
  question: Question
  index: number
  total: number
  value: string | string[]
  onChange: (val: string | string[]) => void
}

// 单题组件：支持单选 / 多选 / 判断
export default function QuestionCard({ question, index, total, value, onChange }: Props) {
  const isMulti = question.type === 'multi'

  // 选项点击行为：多选切换，单选/判断互斥
  const toggle = (opt: string) => {
    if (isMulti) {
      const arr = Array.isArray(value) ? value : []
      const next = arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt]
      onChange(next)
    } else {
      onChange(opt)
    }
  }

  const selected = (opt: string) =>
    Array.isArray(value) ? value.includes(opt) : value === opt

  const selectedCount = Array.isArray(value) ? value.length : value ? 1 : 0

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
        <span>
          第 {index + 1} / {total} 题
        </span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5">
          {question.type === 'single' ? '单选' : question.type === 'multi' ? '多选' : '判断'}
        </span>
      </div>
      <h2 className="mb-4 text-base font-medium leading-relaxed text-gray-900">{question.stem}</h2>

      {isMulti && (
        <p className={`mb-3 text-xs ${selectedCount >= 2 ? 'text-green-600' : 'text-amber-500'}`}>
          {selectedCount >= 2
            ? `已选 ${selectedCount} 项`
            : `至少选择 2 项（已选 ${selectedCount} 项）`}
        </p>
      )}

      <div className="space-y-2.5">
        {question.options.map((opt, i) => {
          const on = selected(opt)
          return (
            <button
              key={i}
              onClick={() => toggle(opt)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                on
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center text-xs ${
                  isMulti ? 'rounded' : 'rounded-full'
                } ${on ? 'bg-primary text-white' : 'border border-gray-300 text-transparent'}`}
              >
                ✓
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
