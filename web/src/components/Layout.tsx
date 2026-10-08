import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { api } from '../api/client'
import { useUserStore } from '../store/user'
import TabBar from './TabBar'

// 全局布局：顶部 logo + 内容区 + 底部 Tab，移动端居中限宽
export default function Layout() {
  const { pathname } = useLocation()
  const userId = useUserStore(s => s.user?.id)
  useEffect(() => {
    if (!userId) return
    const record = () => { if (document.visibilityState === 'visible') void api.visit().catch(() => {}) }
    record()
    document.addEventListener('visibilitychange', record)
    return () => document.removeEventListener('visibilitychange', record)
  }, [pathname, userId])
  return (
    <div className="mx-auto flex h-full max-w-[480px] flex-col bg-base">
      <header className="app-header flex shrink-0 items-center justify-center bg-primary px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white">
        <span className="text-base font-semibold">东来研习</span>
      </header>
      <main className="no-scrollbar relative flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}
