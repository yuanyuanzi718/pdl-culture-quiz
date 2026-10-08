// 上传和粘贴共用，缩小长边并压缩为 JPEG，避免手机原图过大。
export async function prepareChatImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 15 * 1024 * 1024) throw new Error('图片不能超过15MB');
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve,reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片无法读取，请换一张'))
      image.src = url
    })
    const scale = Math.min(1,2000 / Math.max(img.width,img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height)
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    for (const quality of [0.9,0.75,0.55]) {
      const data = canvas.toDataURL('image/jpeg',quality)
      if (data.length <= 1398000) return data
    }
    throw new Error('图片内容过多，请裁剪后重试')
  } finally { URL.revokeObjectURL(url) }
}

export async function copyAnswer(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return } catch { /* 兼容剪贴板权限未开放的浏览器 */ }
  const area = document.createElement('textarea')
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'
  document.body.appendChild(area); area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('复制失败，请长按选择文字复制')
}
