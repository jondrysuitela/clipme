import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database as SqlJsDatabase, Statement as SqlJsStatement } from "sql.js";

let db: SqliteFileDatabase | undefined;

export async function initDatabase(userDataPath: string) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, "clipme.sqlite");
  const SQL = await initSqlJs();
  const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  db = new SqliteFileDatabase(existing ? new SQL.Database(existing) : new SQL.Database(), dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      original_video_path TEXT,
      transcript_path TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      original_path TEXT NOT NULL,
      working_path TEXT NOT NULL,
      duration REAL,
      width INTEGER,
      height INTEGER,
      fps REAL,
      video_codec TEXT,
      audio_codec TEXT,
      file_size INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      duration REAL NOT NULL,
      hook_score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      suggested_caption TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      reframe_anchors_json TEXT,
      curation_status TEXT,
      preview_path TEXT,
      export_path TEXT,
      selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn("clips", "reframe_anchors_json", "TEXT");
  ensureColumn("clips", "curation_status", "TEXT");
}

export function getDb() {
  if (!db) throw new Error("Database is not initialized.");
  return db;
}

class SqliteFileDatabase {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savePromise: Promise<void> | null = null;
  private pendingSave = false;

  constructor(
    private database: SqlJsDatabase,
    private dbPath: string
  ) {}

  exec(sql: string) {
    this.database.exec(sql);
    this.scheduleSave();
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database.prepare(sql), () => this.scheduleSave());
  }

  beginTransaction() {
    this.database.exec("BEGIN TRANSACTION");
  }

  commit() {
    this.database.exec("COMMIT");
    this.scheduleSave();
  }

  rollback() {
    this.database.exec("ROLLBACK");
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, 100);
  }

  private flushSave() {
    if (this.savePromise) {
      this.pendingSave = true;
      return;
    }
    this.pendingSave = false;
    this.savePromise = this.performSave().finally(() => {
      this.savePromise = null;
      if (this.pendingSave) this.flushSave();
    });
  }

  private async performSave() {
    const tempPath = `${this.dbPath}.tmp`;
    const backupPath = `${this.dbPath}.bak`;
    const data = Buffer.from(this.database.export());
    await fs.promises.writeFile(tempPath, data);
    if (fs.existsSync(this.dbPath)) {
      try { await fs.promises.copyFile(this.dbPath, backupPath); } catch { /* backup best-effort */ }
    }
    try {
      await fs.promises.unlink(this.dbPath);
    } catch {
      // File may not exist yet
    }
    try {
      await fs.promises.rename(tempPath, this.dbPath);
    } catch {
      try {
        await fs.promises.copyFile(tempPath, this.dbPath);
        await fs.promises.unlink(tempPath);
      } catch (copyErr) {
        console.error("Database save failed (rename + copy fallback):", copyErr);
      }
    }
  }
}

class SqliteStatement {
  constructor(
    private statement: SqlJsStatement,
    private save: () => void
  ) {}

  run(...params: unknown[]) {
    this.bind(params);
    while (this.statement.step()) {
      // Drain rows for statements that return data.
    }
    this.statement.free();
    this.save();
  }

  get(...params: unknown[]) {
    this.bind(params);
    const hasRow = this.statement.step();
    const row = hasRow ? this.statement.getAsObject() : undefined;
    this.statement.free();
    return row;
  }

  all(...params: unknown[]) {
    this.bind(params);
    const rows: unknown[] = [];
    while (this.statement.step()) rows.push(this.statement.getAsObject());
    this.statement.free();
    return rows;
  }

  private bind(params: unknown[]) {
    if (params.length === 0) return;
    if (params.length === 1 && isPlainObject(params[0])) {
      this.statement.bind(expandNamedParams(params[0] as Record<string, unknown>));
      return;
    }
    this.statement.bind(params);
  }
}

function expandNamedParams(params: Record<string, unknown>) {
  const expanded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const normalized = value === undefined ? null : value;
    expanded[key] = normalized;
    expanded[`:${key}`] = normalized;
    expanded[`@${key}`] = normalized;
    expanded[`$${key}`] = normalized;
  }
  return expanded;
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureColumn(tableName: string, columnName: string, columnType: string) {
  try {
    db?.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`);
  } catch {
    // Existing installs already have the column.
  }
}
