import { Outlet } from 'react-router-dom'
import TabBar from './TabBar'

// 全局布局：顶部 logo + 内容区 + 底部 Tab，移动端居中限宽
export default function Layout() {
  return (
    <div className="mx-auto flex h-full max-w-[480px] flex-col bg-base">
      <header className="flex shrink-0 items-center justify-center bg-primary py-3 text-white">
        <span className="text-base font-semibold">胖东来文化评估</span>
      </header>
      <main className="no-scrollbar relative flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}
