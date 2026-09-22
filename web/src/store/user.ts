import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'
import type { User } from '../types'

interface UserState {
  token: string | null
  user: User | null
  // 待问 AI 的题目内容（从 Exam 切到 Chat 时携带，发送或清空后置空）
  pendingQuestion: string | null
  // 游客登录（基于设备）：应用启动时无 token 时自动调用
  autoLogin: () => Promise<void>
  // 重新拉取当前用户信息（刷新锁定态）
  refreshProfile: () => Promise<void>
  // 直接覆盖用户对象（激活 VIP / 支付回写后用）
  setUser: (user: User) => void
  // 设置待问 AI 的题目内容
  setPendingQuestion: (q: string | null) => void
  // 解绑 VIP：释放激活码，回到游客态
  unbindVip: () => Promise<void>
}

let loginRequest: Promise<void> | null = null

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      pendingQuestion: null,
      autoLogin: async () => {
        if (loginRequest) return loginRequest
        loginRequest = (async () => {
          if (get().token && get().user) {
            try { await get().refreshProfile(); return }
            catch (e) {
              if (![401, 404].includes((e as Error & { status?: number }).status ?? 0)) throw e
              set({ token: null, user: null })
            }
          }
          const data = await api.guestLogin()
          set({ token: data.token, user: data.user })
        })()
        try { await loginRequest } finally { loginRequest = null }
      },
      refreshProfile: async () => {
        const { user } = get()
        if (!user) return
        const u = await api.getProfile(user.id)
        set({ user: u })
      },
      setUser: (user) => set({ user }),
      setPendingQuestion: (q) => set({ pendingQuestion: q }),
      unbindVip: async () => {
        const data = await api.unbindVip()
        set({ user: data.user })
      },
    }),
    {
      name: 'pdl-user',
      // v2：额度口径改为后端下发（次数 + 每次题数），旧缓存里的 user 缺这些字段，丢弃后重新拉取
      version: 2,
      migrate: (state) => ({ ...(state as object), user: null }) as UserState,
    },
  ),
)
