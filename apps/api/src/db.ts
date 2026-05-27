import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

export type RowValue = string | number | null;

const databasePath = fileURLToPath(new URL("../data/qleda.sqlite", import.meta.url));
const localWasmPath = fileURLToPath(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
const workspaceWasmPath = fileURLToPath(new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));

let sqlRuntime: SqlJsStatic | null = null;
let database: Database | null = null;

async function loadRuntime() {
  if (!sqlRuntime) {
    sqlRuntime = await initSqlJs({
      locateFile: () => (existsSync(localWasmPath) ? localWasmPath : workspaceWasmPath)
    });
  }
  return sqlRuntime;
}

function saveDatabase() {
  if (!database) return;
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, Buffer.from(database.export()));
}

function mapRows<T>(result: initSqlJs.QueryExecResult[]) {
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    columns.reduce<Record<string, RowValue>>((item, column, index) => {
      item[column] = row[index] as RowValue;
      return item;
    }, {})
  ) as T[];
}

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      targetScore REAL NOT NULL,
      currentLevel TEXT NOT NULL,
      "group" TEXT NOT NULL,
      teacherId TEXT NOT NULL,
      assistantId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      studentId TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL,
      dueDate TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      score TEXT,
      teacherComment TEXT,
      assistantNote TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_files (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      uploaderId TEXT NOT NULL,
      uploaderRole TEXT NOT NULL,
      name TEXT NOT NULL,
      fileType TEXT NOT NULL,
      url TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS parent_exports (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      title TEXT NOT NULL,
      imageUrl TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      copies INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      fileName TEXT NOT NULL,
      fileType TEXT NOT NULL,
      fileUrl TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      detail TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      authorRole TEXT NOT NULL,
      authorName TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_student ON tasks(studentId);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(createdAt);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(createdAt);
  `);
}

function seedIfEmpty(db: Database) {
  const count = mapRows<{ count: number }>(db.exec("SELECT COUNT(*) AS count FROM users"))[0]?.count ?? 0;
  if (count > 0) return;

  const createdAt = now();
  db.run(
    `INSERT INTO users (id, name, role, createdAt) VALUES
      ('u-admin', 'Admin', 'admin', ?),
      ('u-teacher-lin', 'Lin Teacher', 'teacher', ?),
      ('u-assistant-chen', 'Chen TA', 'assistant', ?),
      ('u-student-anna', 'Anna', 'student', ?);`,
    [createdAt, createdAt, createdAt, createdAt]
  );

  db.run(
    `INSERT INTO students (id, name, grade, targetScore, currentLevel, "group", teacherId, assistantId, createdAt, updatedAt)
     VALUES
      ('s-anna', 'Anna Zhang', 'Grade 11', 7, 'Reading 6.0 / Writing 5.5', 'VIP 1-on-1', 'u-teacher-lin', 'u-assistant-chen', ?, ?),
      ('s-kevin', 'Kevin Liu', 'Year 1', 6.5, 'Listening 6.0 / Speaking 5.5', 'Listening & Speaking', 'u-teacher-lin', 'u-assistant-chen', ?, ?);`,
    [createdAt, createdAt, createdAt, createdAt]
  );

  db.run(
    `INSERT INTO tasks
      (id, studentId, title, type, priority, dueDate, description, status, pinned, score, teacherComment, assistantNote, createdAt, updatedAt)
     VALUES
      ('t-reading-001', 's-anna', 'Cambridge 18 Test 2 Reading Passage 1', 'reading', 'high', '2026-06-01',
       'Finish the questions first, then mark wrong answers and locating sentences.', 'submitted', 1, NULL,
       'Most mistakes are in True/False/Not Given. Watch synonym replacement.', NULL, ?, ?),
      ('t-writing-001', 's-anna', 'Task 2: Education topic essay rewrite', 'writing', 'high', '2026-06-03',
       'Rewrite body paragraphs based on last correction. Focus on topic sentences.', 'reviewed', 0, 'Band 6.0',
       'The position is clearer, but examples are still too general.', 'Correction photo uploaded.', ?, ?),
      ('t-vocab-001', 's-kevin', 'IELTS listening scenario vocabulary: accommodation', 'vocabulary', 'medium', '2026-06-05',
       'Memorize 80 words, finish dictation, and upload a photo.', 'in_progress', 0, NULL, NULL, NULL, ?, ?);`,
    [createdAt, createdAt, createdAt, createdAt, createdAt, createdAt]
  );

  db.run(
    `INSERT INTO task_files (id, taskId, uploaderId, uploaderRole, name, fileType, url, createdAt)
     VALUES
      ('f-001', 't-reading-001', 'u-teacher-lin', 'teacher', 'Cambridge 18 Reading PDF', 'application/pdf', '/mock-files/cambridge-18-reading.pdf', ?),
      ('f-002', 't-writing-001', 'u-assistant-chen', 'assistant', 'Writing correction photo', 'image/jpeg', '/mock-files/writing-correction.jpg', ?);`,
    [createdAt, createdAt]
  );

  db.run(
    `INSERT INTO parent_exports (id, taskId, title, imageUrl, createdAt)
     VALUES ('e-001', 't-writing-001', 'Anna Zhang writing feedback', '/mock-exports/anna-writing-feedback.png', ?);`,
    [createdAt]
  );
}

export async function getDatabase() {
  if (database) return database;

  const SQL = await loadRuntime();
  database = existsSync(databasePath) ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database();
  database.run("PRAGMA foreign_keys = ON;");
  createSchema(database);
  seedIfEmpty(database);
  saveDatabase();
  return database;
}

export async function all<T>(sql: string, params: RowValue[] = []) {
  const db = await getDatabase();
  return mapRows<T>(db.exec(sql, params));
}

export async function get<T>(sql: string, params: RowValue[] = []) {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: RowValue[] = []) {
  const db = await getDatabase();
  db.run(sql, params);
  saveDatabase();
}

export function createId(prefix: string) {
  return id(prefix);
}
