// 兼容历史回答：只清理展示用的来源标签、开场套话和末尾附注。
export function conciseAnswer(text: string): string {
  const cleaned = text
    .replace(/^[ \t]*根据检索到的资料[：:]\s*/, '')
    .replace(/[（(]来源[：:][^）)\n]*[）)]/g, '')
    .replace(/\[(?:资料\s*)?\d+\]/g, '')
  const lines = cleaned.split('\n')
  const note = lines.findIndex((line, index) => index > 0 && /^(?:#{1,6}\s*)?(?:\*\*)?(?:需要说明的是|需要说明[：:]|注释[：:]|注[：:]|补充说明[：:]|以上资料未|检索到的片段中没有|如需准确了解|如需权威界定)/.test(line.trim()))
  return (note >= 0 ? lines.slice(0, note).join('\n') : cleaned).trim() || text
}
