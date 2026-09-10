// RAG 检索：从 questions 表做关键词 TopK 检索
import getDb from '../db/index.js';
import type { RagResult, RagSnippet } from '../types.js';

const TOP_K = 2;

// 题库行结构
interface QuestionRow {
  id: number;
  stem: string;
  explanation: string | null;
  source: string | null;
}

// 简易中文分词：按非中文字符切分 + 单字
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;
  // 去掉标点空白，按非字母数字字符切分
  const cleaned = text.replace(/[，。、！？；：""''（）【】《》\s,.;:!?"'()\[\]<>]/g, ' ');
  for (const part of cleaned.split(/\s+/)) {
    if (!part) continue;
    // 中文：按 2-gram；英文/数字：整词
    if (/[\u4e00-\u9fa5]/.test(part)) {
      for (let i = 0; i < part.length - 1; i++) {
        tokens.add(part.slice(i, i + 2));
      }
      if (part.length === 1) tokens.add(part);
    } else if (part.length >= 2) {
      tokens.add(part.toLowerCase());
    }
  }
  return tokens;
}

// Jaccard 相似度（基于 token 集合）
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// 基于关键词重叠度检索 TopK 题目片段
export function retrieve(message: string): RagResult {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, stem, explanation, source FROM questions'
  ).all() as QuestionRow[];

  if (rows.length === 0) {
    return { snippets: [], prompt: '' };
  }

  const queryTokens = tokenize(message);

  const scored = rows.map((row) => {
    const text = [row.stem, row.explanation ?? ''].join(' ');
    const rowTokens = tokenize(text);
    return {
      row,
      score: jaccard(queryTokens, rowTokens),
      text,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, TOP_K).filter((s) => s.score > 0);

  const snippets: RagSnippet[] = top.map((s) => ({
    text: s.text,
    source: s.row.source ?? '题库',
  }));

  // 拼装上下文提示
  let prompt = '';
  if (snippets.length > 0) {
    const parts = snippets.map((s, i) => `[${i + 1}] 来源：${s.source}\n${s.text}`);
    prompt = `以下是检索到的胖东来文化资料片段：\n\n${parts.join('\n\n')}\n\n请基于以上资料回答用户问题。`;
  }

  return { snippets, prompt };
}
