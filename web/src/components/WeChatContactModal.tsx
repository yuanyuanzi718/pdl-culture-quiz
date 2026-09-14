// 微信客服联系弹窗：引导用户加好友人工转账，管理员手动发 VIP 码
// 复用组件：LockOverlay 与 Profile 均可调用

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Props {
  wechatId?: string
  onClose: () => void
}

export default function WeChatContactModal({
  wechatId = 'adam-727',
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [copyUnavailable, setCopyUnavailable] = useState(false)
  const navigate = useNavigate()

  // HTTP 页面或旧版 Safari 可能没有 Clipboard API；保留可由用户手势触发的兼容复制。
  const legacyCopy = (text: string) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    try {
      return document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }

  const copy = async () => {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(wechatId)
      } else if (!legacyCopy(wechatId)) {
        throw new Error('copy unavailable')
      }
      setCopied(true)
      setCopyUnavailable(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 若现代 API 因权限失败，再尝试一次兼容路径。
      if (legacyCopy(wechatId)) {
        setCopied(true)
        setCopyUnavailable(false)
        setTimeout(() => setCopied(false), 2000)
      } else {
        setCopyUnavailable(true)
      }
    }
  }

  const goToActivation = () => {
    onClose()
    navigate('/me')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl">💬</div>
        <p className="mt-2 text-base font-semibold text-gray-900">添加微信客服解锁</p>
        <p className="mt-1 text-xs text-gray-500">
          加好友转账 ¥9.9，客服会在微信上发送 VIP 激活码
        </p>

        {/* 微信号展示 + 一键复制 */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5">
          <div className="text-left">
            <p className="text-[10px] text-gray-400">微信号</p>
            <p className="select-text text-sm font-mono font-semibold text-gray-900">{wechatId}</p>
          </div>
          <button
            onClick={copy}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white active:scale-95 ${
              copied ? 'bg-green-500' : copyUnavailable ? 'bg-amber-600' : 'bg-primary'
            }`}
          >
            {copied ? '✓ 已复制' : copyUnavailable ? '请长按微信号复制' : '复制'}
          </button>
        </div>

        {/* 操作指引 */}
        <div className="mt-4 space-y-1.5 text-left text-xs text-gray-600">
          <p>1. 复制上方微信号，在微信搜索添加好友</p>
          <p>2. 转账 ¥9.9 给客服</p>
          <p>3. 客服发送 VIP 激活码</p>
          <p>4. 返回本页输入激活码完成解锁</p>
        </div>

        <button
          onClick={goToActivation}
          className="mt-5 w-full rounded-full bg-gray-100 py-2.5 text-sm font-medium text-gray-600 active:scale-95"
        >
          我已加好友，去输入激活码
        </button>
      </div>
    </div>
  )
}
