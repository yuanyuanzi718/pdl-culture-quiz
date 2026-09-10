// 全局共享类型定义

// 题型：单选 / 多选 / 判断
export type QuestionType = 'single' | 'multi' | 'judge'

// 题目（answer/explanation 后端拉题时不返回）
export interface Question {
  id: number
  type: QuestionType
  stem: string
  options: string[]
  answer?: string | string[]
  explanation?: string
  source: string
  tags: string[]
}

// 交卷后单题结果
export interface Detail {
  questionId: number
  correct: boolean
  correctAnswer: string
  userAnswer: string
  explanation: string | null
}

// 用户（字段驼峰命名，与后端约定一致）
export interface User {
  id: number
  deviceId: string | null
  vipActivatedAt: number | null
  vipCode: string | null
  freeUsedCount: number
  chatFreeUsedCount: number
  isLocked: boolean
  isChatLocked: boolean
  freeLimit?: number
  chatFreeLimit?: number
  createdAt: number
}

// AI 对话返回
export interface ChatReply {
  reply: string
  references: Array<{ text: string; source: string }>
  chatRemaining?: number // 剩余对话次数，-1 表示 VIP 无限
}

// 交卷返回
export interface ExamResult {
  score: number
  correctCount: number
  total: number
  details: Detail[]
}

// 历史考试记录（GET /exam/records）
export interface ExamRecord {
  id: number
  userId: number
  score: number
  questionIds: number[]
  answers: Record<string, string>
  createdAt: number
}
