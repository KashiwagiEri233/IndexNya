import { spawnSync } from "node:child_process";
import type { ModelConfig } from "./types.ts";
import { HttpError } from "./errors.ts";
import { extractTerms } from "./agents.ts";

export const LITERATURE_MAX_SIZE = 10 * 1024 * 1024;
export const LITERATURE_MAX_TEXT = 200_000;
const CHUNK_SIZE = 4000;
const CHUNK_OVERLAP = 300;
const MAX_TERMS = 40;

function decodePdfLiteral(value: string): string {
  let output = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "\\") { output += char; continue; }
    const next = value[++i];
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(value[i + 1] || "")) octal += value[++i];
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else output += next || "";
  }
  return output;
}

function fallbackPdfText(raw: Buffer): string {
  const binary = raw.toString("latin1");
  const parts: string[] = [];
  for (const match of binary.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
    const value = decodePdfLiteral(match[1]);
    if (/[\p{L}\p{N}]{2}/u.test(value)) parts.push(value);
  }
  for (const match of binary.matchAll(/<([0-9a-fA-F]{4,})>/g)) {
    const hex = match[1];
    if (hex.length % 4 !== 0) continue;
    let value = "";
    for (let i = 0; i < hex.length; i += 4) value += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
    if (/[\p{L}\p{N}]{2}/u.test(value)) parts.push(value);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function extractPdfText(raw: Buffer): string {
  // Prefer pdftotext when the host provides it. It handles compressed streams,
  // CJK fonts and page layout much better than a regex fallback.
  try {
    const result = spawnSync("pdftotext", ["-layout", "-", "-"], { input: raw, maxBuffer: 25 * 1024 * 1024, encoding: "utf8" });
    if (result.status === 0 && result.stdout?.trim()) return result.stdout;
  } catch {
    // Cross-platform fallback below.
  }
  return fallbackPdfText(raw);
}

export function extractText(filename: string, raw: Buffer): { text: string; sourceType: "pdf" | "txt" | "md" } {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return { text: extractPdfText(raw), sourceType: "pdf" };
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    let text: string;
    try { text = raw.toString("utf8"); } catch { text = raw.toString("latin1"); }
    return { text, sourceType: name.endsWith(".md") || name.endsWith(".markdown") ? "md" : "txt" };
  }
  throw new HttpError(400, "仅支持 PDF / TXT / Markdown 文件");
}

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) chunks.push(text.slice(start, start + size));
  return chunks;
}

export async function extractLiteratureTerms(text: string, model?: ModelConfig): Promise<Array<{ text: string; explanation: string; relation: "background" | "related" }>> {
  const result: Array<{ text: string; explanation: string; relation: "background" | "related" }> = [];
  const seen = new Set<string>();
  for (const chunk of chunkText(text)) {
    for (const term of extractTerms(chunk, 8)) {
      if (seen.has(term.text)) continue;
      seen.add(term.text); result.push(term);
      if (result.length >= MAX_TERMS) return result;
    }
  }
  return result;
}
