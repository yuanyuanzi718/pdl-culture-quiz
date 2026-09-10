import { useState } from 'react'
import WeChatContactModal from './WeChatContactModal'

// 锁定遮罩：免费额度用完时覆盖页面核心操作区，引导加微信客服解锁
export default function LockOverlay({ message = '免费额度已用完' }: { message?: string }) {
  const [showModal, setShowModal] = useState(false)
  return (
    <>
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/50 px-8 text-center backdrop-blur-sm">
        <div className="text-5xl">🔒</div>
        <p className="text-base font-medium text-white">{message}</p>
        <p className="text-sm text-white/80">解锁 VIP 后可无限刷题与对话</p>
        <p className="max-w-xs text-xs text-white/60">
          AI 对话每次调用 DeepSeek API，加上服务器运营成本，因此需收取少量费用以维持服务。
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-lg active:scale-95"
        >
          立即解锁
        </button>
      </div>
      {showModal && <WeChatContactModal onClose={() => setShowModal(false)} />}
    </>
  )
}
