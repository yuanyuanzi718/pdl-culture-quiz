// 管理后台 API 客户端：使用 x-admin-token 认证，与普通用户 JWT 分离

const TOKEN_KEY = 'pdl-admin-token'

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// 统一请求：带 x-admin-token，解包 { ok, data }，401 时抛出特殊错误
export class AdminAuthError extends Error {}

export async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-admin-token': token,
    ...((options.headers as Record<string, string>) || {}),
  }

  const res = await fetch(`${import.meta.env.BASE_URL}api${path}`, { ...options, headers })
  if (res.status === 401) {
    clearAdminToken()
    throw new AdminAuthError('管理员令牌无效或已过期')
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error || `请求失败（${res.status}）`)
  }
  return body?.data as T
}

// ---- 类型定义（与后端 admin 路由输出一致）----
export interface AdminStats {
  userCount: number
  questionCount: number
  orderCount: number
  paidOrderCount: number
  paidAmount: number
  vipCodeCount: number
  activatedVipCount: number
}

export interface AdminQuestion {
  id: number
  type: 'single' | 'multi' | 'judge'
  stem: string
  options: string[]
  answer: string | string[]
  explanation: string | null
  source: string | null
  tags: string[]
}

export interface Paged<T> {
  list: T[]
  total: number
  page: number
  size: number
}

export interface AdminUser {
  id: number
  phone: string | null
  vipActivatedAt: number | null
  vipCode: string | null
  freeUsedCount: number
  isLocked: boolean
  createdAt: number
  examCount: number
}

export interface AdminOrder {
  id: number
  userId: number
  userPhone: string | null
  amount: number
  tradeNo: string | null
  status: 'pending' | 'paid' | 'failed'
  createdAt: number
}

export interface AdminVipCode {
  code: string
  status: 'available' | 'sent' | 'used'
  userId: number | null
  userPhone: string | null
  orderId: number | null
  wechatId: string | null
  amount: number | null
  sentAt: number | null
  activatedAt: number | null
  createdAt: number
}

// 题目入库负载（answer：多选为数组，其余为字母字符串）
export interface QuestionPayload {
  type: 'single' | 'multi' | 'judge'
  stem: string
  options: string[]
  answer: string | string[]
  explanation?: string | null
  source?: string | null
  tags?: string[]
}

// ---- API 聚合 ----
export const adminApi = {
  issueCode: (payload: { wechatId?: string; amount?: number }) => adminRequest<{ code: string }>('/admin/vip-codes/issue', { method: 'POST', body: JSON.stringify(payload) }),
  getStats: () => adminRequest<AdminStats>('/admin/stats'),

  listQuestions: (params: { page: number; size: number; keyword?: string }) => {
    const q = new URLSearchParams({ page: String(params.page), size: String(params.size) })
    if (params.keyword) q.set('keyword', params.keyword)
    return adminRequest<Paged<AdminQuestion>>(`/admin/questions?${q.toString()}`)
  },
  createQuestion: (payload: QuestionPayload) =>
    adminRequest<{ id: number }>('/admin/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateQuestion: (id: number, payload: QuestionPayload) =>
    adminRequest<{ ok: boolean }>(`/admin/questions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteQuestion: (id: number) =>
    adminRequest<{ ok: boolean }>(`/admin/questions/${id}`, { method: 'DELETE' }),

  listUsers: (params: { page: number; size: number }) =>
    adminRequest<Paged<AdminUser>>(
      `/admin/users?page=${params.page}&size=${params.size}`,
    ),

  listOrders: (params: { page: number; size: number }) =>
    adminRequest<Paged<AdminOrder>>(
      `/admin/orders?page=${params.page}&size=${params.size}`,
    ),

  listVipCodes: (params: { page: number; size: number; status?: string }) => {
    const q = new URLSearchParams({ page: String(params.page), size: String(params.size) })
    if (params.status) q.set('status', params.status)
    return adminRequest<Paged<AdminVipCode>>(`/admin/vip-codes?${q.toString()}`)
  },
}
