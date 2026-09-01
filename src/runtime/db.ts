import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface StatementLike {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
}

interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
}

interface DatabaseSyncConstructor {
  new (filename: string): SqliteDatabaseLike;
}

/** Load node:sqlite lazily so type-checking also works with older @types/node packages. */
function loadDatabaseSync(): DatabaseSyncConstructor {
  try {
    let mod: { DatabaseSync?: DatabaseSyncConstructor } | undefined;
    if (typeof require !== "undefined") {
      mod = require("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor };
    } else {
      const nodeRequire = createRequire(import.meta.url);
      mod = nodeRequire("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor };
    }
    if (!mod?.DatabaseSync) throw new Error("DatabaseSync is not available");
    return mod.DatabaseSync;
  } catch (error) {
    throw new Error(
      `当前 Node.js 不支持 node:sqlite。请使用 Node.js 22.5+（推荐 Node.js 24+）。原始错误：${String(error)}`,
    );
  }
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function boolToSql(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

export function sqlToBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(Number(value));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function projectRoot(): string {
  let currentDir = process.cwd();
  try {
    if (typeof __dirname !== "undefined") {
      currentDir = __dirname;
    } else if (typeof import.meta !== "undefined" && import.meta.url) {
      currentDir = path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  const candidates = [process.cwd(), path.resolve(currentDir, "../.."), path.resolve(currentDir, "..")];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "package.json"))) || candidates[0];
}

export function defaultDatabasePath(root = projectRoot()): string {
  const configuredDataDir = process.env.INDEXNYA_DATA_DIR?.trim();
  if (configuredDataDir) {
    const configuredDb = process.env.INDEXNYA_DB_PATH?.trim();
    return configuredDb ? path.resolve(configuredDataDir, configuredDb) : path.join(path.resolve(configuredDataDir), "learning_agent.db");
  }

  const configured = process.env.INDEXNYA_DB_PATH?.trim();
  if (configured) return path.resolve(root, configured);

  const modern = path.join(root, "data", "learning_agent.db");
  if (fs.existsSync(modern)) return modern;

  const legacyCandidates = [
    path.join(root, "backend", "learning_agent.db"),
    path.join(root, "legacy", "fastapi", "learning_agent.db"),
  ];
  const legacy = legacyCandidates.find((candidate) => fs.existsSync(candidate));
  if (legacy) return legacy;

  return modern;
}

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '同学',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  parent_conversation_id INTEGER NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  conversation_id INTEGER NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  file_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE TABLE IF NOT EXISTS explore_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  conversation_id INTEGER NULL,
  parent_card_id INTEGER NULL,
  source_message_id INTEGER NULL,
  type TEXT NOT NULL,
  term TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  branch_conversation_id INTEGER NULL,
  content TEXT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (parent_card_id) REFERENCES explore_cards(id),
  FOREIGN KEY (source_message_id) REFERENCES messages(id),
  FOREIGN KEY (branch_conversation_id) REFERENCES conversations(id)
);
CREATE TABLE IF NOT EXISTS literatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id)
);
CREATE TABLE IF NOT EXISTS understandings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  concept TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ai_score REAL NOT NULL DEFAULT 0,
  ai_feedback TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved',
  embedding TEXT NOT NULL DEFAULT '[]',
  anchors TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id)
);
CREATE TABLE IF NOT EXISTS practice_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  conversation_id INTEGER NULL,
  topic TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  is_correct INTEGER NULL,
  asked_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
`;

const MIGRATIONS: Array<[string, string, string]> = [
  ["conversations", "parent_conversation_id", "INTEGER NULL"],
  ["messages", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["resources", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["explore_cards", "content", "TEXT NULL"],
  ["practice_records", "answered_at", "TEXT NULL"],
];

export class Database {
  readonly filename: string;
  private readonly raw: SqliteDatabaseLike;

  constructor(filename = defaultDatabasePath()) {
    this.filename = filename === ":memory:" ? filename : path.resolve(filename);
    if (this.filename !== ":memory:") fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const Constructor = loadDatabaseSync();
    this.raw = new Constructor(this.filename);
    this.raw.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.raw.exec(CREATE_SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    for (const [table, column, definition] of MIGRATIONS) {
      const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name);
      if (!columns.includes(column)) {
        this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.raw.prepare(sql).run(...params.map(normalizeParam));
    return {
      changes: toNumber(result.changes),
      lastInsertRowid: toNumber(result.lastInsertRowid),
    };
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.raw.prepare(sql).get<T>(...params.map(normalizeParam));
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.raw.prepare(sql).all<T>(...params.map(normalizeParam));
  }

  transaction<T>(callback: () => T): T {
    this.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors; preserve the original exception.
      }
      throw error;
    }
  }

  /** Temporarily disable FK checks for restore/delete operations with legacy rows. */
  withoutForeignKeys<T>(callback: () => T): T {
    this.exec("PRAGMA foreign_keys = OFF");
    try {
      return callback();
    } finally {
      this.exec("PRAGMA foreign_keys = ON");
    }
  }

  close(): void {
    this.raw.close();
  }
}

function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

let singleton: Database | undefined;

export function getDatabase(): Database {
  singleton ??= new Database();
  return singleton;
}
