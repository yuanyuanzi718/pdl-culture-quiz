// 题库导入：从 ../data/questions.json 导入到 questions 表
import { existsSync, readFileSync } from 'node:fs';
import type { Database as DatabaseType } from 'better-sqlite3';

// JSON 中题目的结构
interface QuestionJsonItem {
  type?: string;
  stem?: string;
  options?: string[];
  answer?: string | string[];
  explanation?: string;
  source?: string;
  tags?: string[];
}

// 将单个答案标准化为存储格式
function normalizeAnswer(answer: string | string[] | undefined): string {
  if (answer === undefined) return '';
  if (Array.isArray(answer)) {
    return JSON.stringify(answer);
  }
  // 单选/判断直接存字母
  return String(answer).trim();
}

// 从 JSON 文件导入题目，返回导入条数；文件不存在返回 0
export function importQuestionsFromJson(db: DatabaseType, dataPath: string): number {
  if (!existsSync(dataPath)) {
    return 0;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch (e) {
    console.warn(`[seed] questions.json 解析失败: ${(e as Error).message}`);
    return 0;
  }

  const items: QuestionJsonItem[] = Array.isArray(raw) ? (raw as QuestionJsonItem[]) : [];

  if (items.length === 0) {
    console.warn('[seed] questions.json 为空数组');
    return 0;
  }

  const insert = db.prepare(
    `INSERT INTO questions (type, stem, options, answer, explanation, source, tags)
     VALUES (@type, @stem, @options, @answer, @explanation, @source, @tags)`
  );

  const insertMany = db.transaction((rows: QuestionJsonItem[]) => {
    let count = 0;
    for (const item of rows) {
      const type = (item.type || 'single').trim();
      const stem = (item.stem || '').trim();
      if (!stem) continue;
      const options = JSON.stringify(item.options || []);
      const answer = normalizeAnswer(item.answer);
      const explanation = item.explanation ?? null;
      const source = item.source ?? null;
      const tags = item.tags ? JSON.stringify(item.tags) : null;
      insert.run({ type, stem, options, answer, explanation, source, tags });
      count++;
    }
    return count;
  });

  return insertMany(items);
}
