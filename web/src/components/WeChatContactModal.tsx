// 微信客服联系弹窗：引导用户加好友人工转账，管理员手动发 VIP 码
// 复用组件：LockOverlay 与 Profile 均可调用

import { useState } from 'react'

interface Props {
  wechatId?: string
  onClose: () => void
}

export default function WeChatContactModal({
  wechatId = 'adam-727',
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wechatId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用时静默失败，用户可手动选中复制 */
    }
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
            <p className="text-sm font-mono font-semibold text-gray-900">{wechatId}</p>
          </div>
          <button
            onClick={copy}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white active:scale-95 ${
              copied ? 'bg-green-500' : 'bg-primary'
            }`}
          >
            {copied ? '✓ 已复制' : '复制'}
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
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-gray-100 py-2.5 text-sm font-medium text-gray-600 active:scale-95"
        >
          我已加好友，去输入激活码
        </button>
      </div>
    </div>
  )
}
