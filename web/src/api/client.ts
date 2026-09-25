import { useUserStore } from '../store/user'
import type { ChatReply, Detail, ExamRecord, ExamResult, Question, User } from '../types'

const BASE = `${import.meta.env.BASE_URL}api`

// 设备唯一标识：localStorage 持久化，清浏览器数据会重置（需重新激活 VIP）
const DEVICE_ID_KEY = 'pdl-device-id'
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

// fetch 封装：自动带上 JWT + X-Device-Id，统一错误处理，自动解包后端 { ok, data } 中的 data 字段
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useUserStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    // 后端错误格式：{ ok: false, error: "...", code?: "..." }
    const body = await res.json().catch(() => ({}))
    const msg = body?.error || `请求失败（${res.status}）`
    const err = new Error(msg) as Error & { status: number; code?: string }
    err.status = res.status
    if (typeof body?.code === 'string') err.code = body.code
    throw err
  }

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) return undefined as unknown as T

  const json = await res.json()
  // 后端统一信封：{ ok: true, data: ... }，解包 data
  return json?.data as T
}

// API 聚合
export const api = {
  // 游客登录（基于设备）：POST /profile/guest → { user, token }
  // 同设备复用同一用户，保留免费额度/VIP 状态
  guestLogin: () =>
    request<{ user: User; token: string }>('/profile/guest', {
      method: 'POST',
      body: JSON.stringify({ deviceId: getDeviceId() }),
    }),

  // 拉取用户信息：GET /profile/:userId → User（含 isLocked）
  getProfile: (userId: number) => request<User>(`/profile/${userId}`),

  // 题库统计：GET /questions/stats → { total }
  questionStats: async (): Promise<{ total: number }> => {
    const data = await request<{ total: number }>('/questions/stats')
    return data ?? { total: 0 }
  },

  // 随机抽题：GET /questions/random → { questions: Question[] }（卷面题数由后端配置决定）
  randomQuestions: async (): Promise<Question[]> => {
    const data = await request<{ questions: Question[] }>('/questions/random')
    return data?.questions ?? []
  },

  // 交卷：POST /exam/submit → { score, correctCount, total, details }
  submitExam: (payload: {
    userId: number
    questionIds: number[]
    answers: Record<string, string | string[]>
  }) =>
    request<ExamResult>('/exam/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 历史考试记录：GET /exam/records/:userId → { records: ExamRecord[] }
  examRecords: async (userId: number): Promise<ExamRecord[]> => {
    const data = await request<{ records: ExamRecord[] }>(`/exam/records/${userId}`)
    return data?.records ?? []
  },

  chatHistory: async () => (await request<{ messages: Array<{ role: string; content: string; references: Array<{text:string;source:string}> }> }>('/chat/history')).messages,
  pendingExam: async () => (await request<{ questions: Question[] }>('/questions/pending')).questions,
  // AI 对话：POST /chat → { reply, references }
  chat: (payload: { userId: number; message: string }) =>
    request<ChatReply>('/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // VIP 激活码激活（绑定设备）：POST /vip/activate → { user, activated }
  activateVip: (payload: { userId: number; code: string }) =>
    request<{ user: User; activated: boolean }>('/vip/activate', {
      method: 'POST',
      body: JSON.stringify({ ...payload, deviceId: getDeviceId() }),
    }),

  // 解绑 VIP（释放激活码）：POST /vip/unbind → { user }
  unbindVip: () =>
    request<{ user: User }>('/vip/unbind', {
      method: 'POST',
      body: '{}',
    }),


}

export type { Detail, Question, User, ExamResult, ExamRecord, ChatReply }
