import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { projectRoot } from "./db.ts";
import { HttpError } from "./errors.ts";

export interface Skill {
  name: string;
  title: string;
  description: string;
  content: string;
  enabled: boolean;
}

interface SkillSettings {
  enabled?: Record<string, boolean>;
  removed?: string[];
}

export function getSkillsDataRoot(): string {
  const configuredDataDir = process.env.INDEXNYA_DATA_DIR?.trim();
  if (configuredDataDir) return path.join(path.resolve(configuredDataDir), "skills");
  return path.join(projectRoot(), "data", "skills");
}

export function getSkillsSettingsPath(): string {
  const configuredDataDir = process.env.INDEXNYA_DATA_DIR?.trim();
  if (configuredDataDir) return path.join(path.resolve(configuredDataDir), "skills.json");
  return path.join(projectRoot(), "data", "skills.json");
}

export function getSkillsSeedRoot(): string {
  const configuredSeed = process.env.INDEXNYA_SKILLS_SEED_DIR?.trim();
  if (configuredSeed) return path.resolve(configuredSeed);
  const root = projectRoot();
  const candidates = [
    path.join(root, "src", "runtime", "skills"),
    path.join(root, "skills"),
    path.join(root, "data", "skills"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

function safeName(value: string): string {
  const name = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!name) throw new HttpError(400, "技能名称不能为空");
  return name;
}

function readSettings(): SkillSettings {
  const settingsPath = getSkillsSettingsPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as SkillSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: SkillSettings): void {
  const settingsPath = getSkillsSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ enabled: settings.enabled || {}, removed: settings.removed || [] }, null, 2), "utf8");
}

function parseSkillMarkdown(markdown: string, fallbackName: string): { name: string; title: string; description: string; content: string } {
  const text = markdown.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let title = fallbackName;
  let description = "";
  let content = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end >= 0) {
      const frontmatter = text.slice(3, end).split(/\r?\n/);
      for (const line of frontmatter) {
        const match = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
        if (!match) continue;
        const value = match[2].replace(/^['"]|['"]$/g, "").trim();
        if (match[1] === "name" && value) name = value;
        if (match[1] === "title" && value) title = value;
        if (match[1] === "description") description = value;
      }
      content = text.slice(end + 4).replace(/^\r?\n/, "");
    }
  }
  return { name: safeName(name), title: title || name, description, content: content.trim() };
}

function listDirectories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function ensureInitialized(): void {
  const dataRoot = getSkillsDataRoot();
  const seedRoot = getSkillsSeedRoot();
  fs.mkdirSync(dataRoot, { recursive: true });
  // Built-in skills are copied into the writable data directory once. This
  // keeps runtime install/uninstall state out of the source tree and works in
  // read-only deployments.
  for (const name of listDirectories(seedRoot)) {
    const source = path.join(seedRoot, name, "SKILL.md");
    const destinationDir = path.join(dataRoot, name);
    const destination = path.join(destinationDir, "SKILL.md");
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function readSkill(name: string): Skill | undefined {
  ensureInitialized();
  const dataRoot = getSkillsDataRoot();
  const safe = safeName(name);
  const file = path.join(dataRoot, safe, "SKILL.md");
  if (!fs.existsSync(file)) return undefined;
  const parsed = parseSkillMarkdown(fs.readFileSync(file, "utf8"), safe);
  const settings = readSettings();
  const removed = new Set(settings.removed || []);
  if (removed.has(parsed.name)) return undefined;
  return { ...parsed, enabled: settings.enabled?.[parsed.name] !== false };
}

export function listSkills(): Skill[] {
  ensureInitialized();
  const dataRoot = getSkillsDataRoot();
  const settings = readSettings();
  const removed = new Set(settings.removed || []);
  const names = listDirectories(dataRoot);
  return names.flatMap((name) => {
    const skill = readSkill(name);
    return skill && !removed.has(skill.name) ? [skill] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(name: string): Skill | undefined {
  return readSkill(name);
}

export function setSkillEnabled(name: string, enabled: boolean): boolean {
  const skill = readSkill(name);
  if (!skill) return false;
  const settings = readSettings();
  settings.enabled = { ...(settings.enabled || {}), [skill.name]: Boolean(enabled) };
  settings.removed = (settings.removed || []).filter((item) => item !== skill.name);
  writeSettings(settings);
  return true;
}

export function deleteSkill(name: string): boolean {
  ensureInitialized();
  const dataRoot = getSkillsDataRoot();
  const safe = safeName(name);
  const skill = readSkill(safe);
  if (!skill) return false;
  fs.rmSync(path.join(dataRoot, safe), { recursive: true, force: true });
  const settings = readSettings();
  settings.removed = [...new Set([...(settings.removed || []), skill.name])];
  if (settings.enabled) delete settings.enabled[skill.name];
  writeSettings(settings);
  return true;
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: Buffer;
  uncompressedSize: number;
}

/** Minimal ZIP reader for skill packages (stored + deflate entries). */
function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) { eocd = i; break; }
  }
  if (eocd < 0) throw new HttpError(400, "技能包不是有效的 ZIP 文件");
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new HttpError(400, "ZIP 目录损坏");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (uncompressedSize > 10 * 1024 * 1024) throw new HttpError(400, "单个技能文件解压后不能超过 10MB");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new HttpError(400, "ZIP 文件头损坏");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    entries.push({ name, method, compressed, uncompressedSize });
  }
  return entries;
}

function decodeZipEntry(entry: ZipEntry): Buffer {
  if (entry.method === 0) return entry.compressed;
  if (entry.method === 8) return zlib.inflateRawSync(entry.compressed);
  throw new HttpError(400, `ZIP 使用了不支持的压缩方式：${entry.method}`);
}

function validateZipPath(name: string): string[] {
  const normalized = name.replace(/\\/g, "/");
  const parts: string[] = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.includes("..") || parts.some((part: string) => part.includes("\0")) || normalized.startsWith("/")) {
    throw new HttpError(400, "技能包包含不安全的文件路径");
  }
  return parts;
}

export async function installSkillFromZip(buffer: Buffer, filename: string): Promise<string[]> {
  ensureInitialized();
  const dataRoot = getSkillsDataRoot();
  const entries = readZipEntries(buffer);
  const skillFiles = entries.filter((entry) => validateZipPath(entry.name).at(-1)?.toLowerCase() === "skill.md");
  if (!skillFiles.length) throw new HttpError(400, "技能包中没有找到 SKILL.md");
  const installed: string[] = [];
  const fallback = safeName(path.basename(filename, path.extname(filename)) || "skill");
  for (const entry of skillFiles) {
    const parts = validateZipPath(entry.name);
    const raw = decodeZipEntry(entry);
    if (raw.length > 10 * 1024 * 1024) throw new HttpError(400, "技能内容不能超过 10MB");
    const parsed = parseSkillMarkdown(raw.toString("utf8"), parts.length > 1 ? parts.at(-2)! : fallback);
    const destinationDir = path.join(dataRoot, parsed.name);
    await fsp.mkdir(destinationDir, { recursive: true });
    await fsp.writeFile(path.join(destinationDir, "SKILL.md"), raw);
    const settings = readSettings();
    settings.removed = (settings.removed || []).filter((item) => item !== parsed.name);
    settings.enabled = { ...(settings.enabled || {}), [parsed.name]: true };
    writeSettings(settings);
    installed.push(parsed.name);
  }
  return [...new Set(installed)];
}
