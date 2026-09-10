import './admin.css'
import { useState } from 'react'
import { Routes, Route, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  getAdminToken,
  setAdminToken,
  clearAdminToken,
  adminApi,
} from '../../api/adminClient'
import Dashboard from './Dashboard'
import AdminQuestions from './Questions'
import AdminUsers from './Users'
import AdminOrders from './Orders'
import AdminVipCodes from './VipCodes'

// 时间戳格式化：YYYY-MM-DD HH:mm
export function fmtTime(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---- 登录页：输入管理令牌 ----
function AdminLogin() {
  const navigate = useNavigate()
  const [token, setToken] = useState(getAdminToken())
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!token.trim()) return
    setLoading(true)
    setErr('')
    setAdminToken(token.trim())
    try {
      // 用一次 stats 请求校验令牌有效性
      await adminApi.getStats()
      navigate('/admin/dashboard', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '令牌校验失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl">🛠️</div>
          <h1 className="text-lg font-semibold text-gray-900">胖东来文化评估 · 管理后台</h1>
          <p className="mt-1 text-xs text-gray-500">输入管理员令牌登录</p>
        </div>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="管理员令牌"
          className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        {err && <p className="mt-2 text-xs text-primary">{err}</p>}
        <button
          onClick={submit}
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? '校验中…' : '进入后台'}
        </button>
        <NavLink to="/exam" className="mt-4 block text-center text-xs text-gray-400">
          ← 返回前台
        </NavLink>
      </div>
    </div>
  )
}

// ---- 布局：左侧导航 + 顶部栏 + 内容区 ----
function AdminLayout() {
  const navigate = useNavigate()
  const nav = [
    { to: '/admin/dashboard', label: '数据概览', icon: '📊' },
    { to: '/admin/questions', label: '题库管理', icon: '📚' },
    { to: '/admin/users', label: '用户管理', icon: '👥' },
    { to: '/admin/orders', label: '订单管理', icon: '💰' },
    { to: '/admin/vip-codes', label: 'VIP 码', icon: '🎟️' },
  ]

  const logout = () => {
    clearAdminToken()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="admin-shell flex min-h-screen bg-gray-100">
      {/* 侧边栏 */}
      <aside className="admin-sidebar hidden w-52 shrink-0 flex-col bg-gray-900 text-gray-300 md:flex">
        <div className="px-5 py-5 text-sm font-semibold text-white">
          🛠️ 管理后台
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive ? 'bg-primary text-white' : 'hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 px-3 pb-4">
          <NavLink
            to="/exam"
            className="block rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            🏠 前台首页
          </NavLink>
          <button
            onClick={logout}
            className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            🚪 退出登录
          </button>
        </div>
      </aside>

      <header className="admin-mobile-header md:hidden">
        <span className="font-semibold">管理后台</span>
        <div className="flex gap-2">
          <NavLink to="/exam">前台</NavLink>
          <button onClick={logout}>退出</button>
        </div>
      </header>
      <nav aria-label="后台主导航" className="admin-mobile-nav md:hidden">
        {nav.map((n) => <NavLink key={n.to} to={n.to} className={({isActive}) => isActive ? 'active' : ''}>
          <span aria-hidden="true">{n.icon}</span><span>{n.label.replace('管理', '').replace('数据概览', '概览')}</span>
        </NavLink>)}
      </nav>
      {/* 内容区 */}
      <main className="admin-main min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  )
}

// ---- 路由：无令牌则进登录页（本组件挂载于 /admin/*，内部用相对路径）----
export default function AdminApp() {
  const authed = !!getAdminToken()
  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route element={authed ? <AdminLayout /> : <Navigate to="/admin/login" replace />}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="questions" element={<AdminQuestions />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="vip-codes" element={<AdminVipCodes />} />
      </Route>
      <Route path="*" element={<Navigate to={authed ? '/admin/dashboard' : '/admin/login'} replace />} />
    </Routes>
  )
}
