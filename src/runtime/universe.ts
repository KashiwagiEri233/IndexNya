import crypto from "node:crypto";
import type { JsonObject, ModelConfig, UnderstandingRow } from "./types.ts";
import { chatCompleteText, hasUsableModel } from "./llm.ts";

const DIM = 512;
const SIMILAR_UPDATE_THRESHOLD = 0.92;
const GRAPH_LINK_THRESHOLD = 0.45;
const GRAPH_MAX_LINKS_PER_NODE = 3;

function tokens(text: string): string[] {
  const lower = (text || "").toLowerCase();
  const result: string[] = [];
  for (const match of lower.matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]/g)) {
    const token = match[0];
    if (/^[a-z0-9_]+$/.test(token)) {
      if (token.length < 32) result.push(token);
    } else result.push(token);
  }
  const cjk = [...lower].filter((char) => /[\u4e00-\u9fff]/.test(char));
  for (let i = 0; i < cjk.length - 1; i += 1) result.push(cjk[i] + cjk[i + 1]);
  return result;
}

export function localEmbed(text: string): number[] {
  const vector = Array.from({ length: DIM }, () => 0);
  for (const token of tokens(text)) {
    const digest = crypto.createHash("md5").update(token, "utf8").digest("hex");
    const index = Number.parseInt(digest.slice(0, 8), 16) % DIM;
    const sign = (Number.parseInt(digest.slice(8, 16), 16) & 1) ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function embeddingOf(row: UnderstandingRow): number[] {
  return row.embedding?.length ? row.embedding : localEmbed(row.concept);
}

export function relatedUnderstandings(rows: UnderstandingRow[], topic: string, k = 5, exclude?: number): Array<{ row: UnderstandingRow; similarity: number }> {
  const target = localEmbed(topic);
  return rows
    .filter((row) => row.status === "approved" && row.id !== exclude)
    .map((row) => ({ row, similarity: cosine(target, embeddingOf(row)) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

export function getAnchorContext(rows: UnderstandingRow[], topic: string, k = 5): string {
  const related = relatedUnderstandings(rows, topic, k);
  if (!related.length) return "";
  const lines = ["📌 你已掌握的思维锚点（学生用自己的话表达，讲解时请优先从这些出发建立联系）："];
  for (const { row } of related) lines.push(`- 「${row.concept}」：${row.summary.trim().replace(/\n/g, " ").slice(0, 140)}`);
  lines.push(`请结合新概念「${topic}」与上述锚点的联系来讲解。`);
  return lines.join("\n");
}

export function buildGraph(rows: UnderstandingRow[]): { nodes: JsonObject[]; links: JsonObject[] } {
  const approved = rows.filter((row) => row.status === "approved");
  if (!approved.length) return { nodes: [], links: [] };
  const vectors = approved.map(embeddingOf);
  const nodes = approved.map((row) => ({ id: String(row.id), concept: row.concept, summary: row.summary.slice(0, 200), score: row.ai_score, size: 4 + row.ai_score / 25 }));
  const links: JsonObject[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < approved.length; i += 1) {
    const scored = approved.map((_, j) => ({ similarity: j === i ? -1 : cosine(vectors[i], vectors[j]), index: j }))
      .sort((a, b) => b.similarity - a.similarity).slice(0, GRAPH_MAX_LINKS_PER_NODE);
    for (const { similarity, index } of scored) {
      if (similarity < GRAPH_LINK_THRESHOLD) continue;
      const a = String(approved[i].id); const b = String(approved[index].id);
      const key = `${a}:${b}`; const reverse = `${b}:${a}`;
      if (seen.has(key) || seen.has(reverse)) continue;
      seen.add(key);
      links.push({ source: a, target: b, weight: Number(similarity.toFixed(3)) });
    }
  }
  return { nodes, links };
}

function parseModelJson(raw: string): JsonObject | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const text = fenced?.[1] || raw;
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { const data = JSON.parse(text.slice(start, end + 1)); return data && typeof data === "object" ? data as JsonObject : undefined; } catch { return undefined; }
}

export async function evaluateSummary(concept: string, summary: string, model?: ModelConfig): Promise<{ approved: boolean; score: number; feedback: string; missing: string[] }> {
  if (hasUsableModel(model)) {
    try {
      const raw = await chatCompleteText(model, [
        { role: "system", content: "你是一位严谨而鼓励人的学习评审专家，只输出 JSON。" },
        { role: "user", content: `请评审学生对「${concept}」的理解：\n${summary}\n\n输出：{"approved":true,"score":82,"feedback":"具体反馈","missing":[]}` },
      ], { temperature: 0.2, maxTokens: 1024 });
      const data = parseModelJson(raw);
      if (data) {
        const score = Math.max(0, Math.min(100, Number(data.score) || 0));
        return { approved: Boolean(data.approved) || score >= 60, score: Number(score.toFixed(1)), feedback: String(data.feedback || ""), missing: Array.isArray(data.missing) ? data.missing.map(String) : [] };
      }
    } catch {
      // Fall through to a deterministic local review.
    }
  }
  const lengthScore = Math.min(100, 45 + Math.min(40, Math.floor(summary.trim().length / 20) * 10) + (/[。；;，,]/.test(summary) ? 10 : 0));
  const score = Number(lengthScore.toFixed(1));
  return {
    approved: score >= 60,
    score,
    feedback: score >= 60 ? "表达包含核心观点，已经可以作为一个知识锚点保存。" : "再补充一个原理、例子或适用场景，会让理解更完整。",
    missing: score >= 60 ? [] : ["核心原理或具体例子"],
  };
}

export function createUnderstandingValues(rows: UnderstandingRow[], concept: string, summary: string, verdict: { score: number; feedback: string }): { existingId?: number; embedding: number[]; anchors: Array<{ concept: string; summary: string }> } {
  const target = localEmbed(concept);
  const existing = rows.filter((row) => row.status === "approved").map((row) => ({ row, score: cosine(target, embeddingOf(row)) })).sort((a, b) => b.score - a.score)[0];
  const existingId = existing && existing.score > SIMILAR_UPDATE_THRESHOLD ? existing.row.id : undefined;
  const anchors = relatedUnderstandings(rows, concept, 3, existingId).map(({ row }) => ({ concept: row.concept, summary: row.summary.slice(0, 120) }));
  return { existingId, embedding: localEmbed(`${concept} ${summary}`), anchors };
}

export function rowToUnderstanding(raw: Record<string, unknown>): UnderstandingRow {
  return {
    id: Number(raw.id), student_id: Number(raw.student_id), concept: String(raw.concept || ""), summary: String(raw.summary || ""),
    ai_score: Number(raw.ai_score || 0), ai_feedback: String(raw.ai_feedback || ""), status: String(raw.status || "approved"),
    embedding: parseJson(raw.embedding, [] as number[]), anchors: parseJson(raw.anchors, [] as Array<Record<string, string>>), source: parseJson(raw.source, {} as JsonObject), created_at: String(raw.created_at || ""),
  };
}
