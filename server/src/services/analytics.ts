import getDb from '../db/index.js';

export function usageStats(now = Date.now()) {
  const db = getDb();
  const trackingSince = (db.prepare("SELECT value FROM app_meta WHERE key='analytics_started'").get() as {value:string}).value;
  const start = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const count = (sql: string, ...params: (number | string)[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  const daily = Array.from({ length: 30 }, (_, i) => {
    const from = start - (29 - i) * 86400000;
    const to = from + 86400000;
    const day = new Date(from + 8 * 3600000).toISOString().slice(0, 10);
    return {
      day,
      visitors: count('SELECT COUNT(*) AS n FROM daily_visits WHERE day=?', day),
      newUsers: count('SELECT COUNT(*) AS n FROM users WHERE created_at>=? AND created_at<?', from, to),
      examUsers: count('SELECT COUNT(DISTINCT user_id) AS n FROM exam_records WHERE created_at>=? AND created_at<?', from, to),
      exams: count('SELECT COUNT(*) AS n FROM exam_records WHERE created_at>=? AND created_at<?', from, to),
      chatUsers: count("SELECT COUNT(DISTINCT user_id) AS n FROM chat_logs WHERE role='user' AND kind='chat' AND created_at>=? AND created_at<?", from, to),
      chats: count("SELECT COUNT(*) AS n FROM chat_logs WHERE role='user' AND kind='chat' AND created_at>=? AND created_at<?", from, to),
      aiFailures: count('SELECT COUNT(*) AS n FROM ai_failures WHERE created_at>=? AND created_at<?', from, to),
      activations: count('SELECT COUNT(*) AS n FROM users WHERE vip_activated_at>=? AND vip_activated_at<?', from, to),
    };
  });
  return { daily, today: daily[29], trackingSince };
}
