import { NavLink } from 'react-router-dom'

// 底部 Tab 导航：评估 / 对话 / 我的
const tabs = [
  { to: '/exam', label: '评估', icon: '📝' },
  { to: '/chat', label: '对话', icon: '💬' },
  { to: '/me', label: '我的', icon: '👤' },
]

export default function TabBar() {
  return (
    <nav className="flex shrink-0 border-t border-gray-200 bg-white">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs ${
              isActive ? 'text-primary' : 'text-gray-500'
            }`
          }
        >
          <span className="text-xl leading-none">{t.icon}</span>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
