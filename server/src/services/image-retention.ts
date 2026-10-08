import getDb from '../db/index.js';

export const IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// 留下识别文字和答复，仅清理图片。每批有限行数，避免一次长事务。
export function cleanExpiredImages(now = Date.now()): number {
  const db = getDb();
  let removed = 0;
  const update = db.prepare(`UPDATE chat_logs SET image_data=NULL WHERE id IN (
    SELECT id FROM chat_logs WHERE image_data IS NOT NULL AND created_at <= ? LIMIT 200
  )`);
  for (let batch=0; batch<10; batch++) {
    const result = update.run(now-IMAGE_RETENTION_MS);
    removed += result.changes;
    if (result.changes < 200) break;
  }
  // 增量回收空闲页，避免图片清空了但数据库文件持续占用原空间。
  db.pragma('incremental_vacuum(512)');
  if (removed) db.pragma('wal_checkpoint(PASSIVE)');
  return removed;
}
