import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

export type RowValue = string | number | null;

const databasePath = fileURLToPath(new URL("../data/qleda.sqlite", import.meta.url));
const localWasmPath = fileURLToPath(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
const workspaceWasmPath = fileURLToPath(new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));

const useMysql = Boolean(process.env.MYSQL_HOST || process.env.DATABASE_URL?.startsWith("mysql"));

let sqlRuntime: SqlJsStatic | null = null;
let sqliteDatabase: Database | null = null;
let mysqlPool: Pool | null = null;
let schemaReady = false;

async function loadRuntime() {
  if (!sqlRuntime) {
    sqlRuntime = await initSqlJs({
      locateFile: () => (existsSync(localWasmPath) ? localWasmPath : workspaceWasmPath)
    });
  }
  return sqlRuntime;
}

function saveSqliteDatabase() {
  if (!sqliteDatabase) return;
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, Buffer.from(sqliteDatabase.export()));
}

function mapSqliteRows<T>(result: initSqlJs.QueryExecResult[]) {
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

function sqliteSchema(db: Database) {
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
      \`group\` TEXT NOT NULL,
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
      fileData TEXT,
      fileSize INTEGER,
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

    CREATE TABLE IF NOT EXISTS shared_files (
      id TEXT PRIMARY KEY,
      uploaderId TEXT NOT NULL,
      uploaderRole TEXT NOT NULL,
      uploaderName TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      fileName TEXT NOT NULL,
      fileType TEXT NOT NULL,
      fileUrl TEXT NOT NULL,
      fileData TEXT,
      fileSize INTEGER,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_student ON tasks(studentId);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(createdAt);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(createdAt);
    CREATE INDEX IF NOT EXISTS idx_shared_files_created ON shared_files(createdAt);
  `);
}

function ensureSqliteColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [];
  const hasColumn = columns.some((row) => row[1] === column);
  if (!hasColumn) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function sqliteMigrations(db: Database) {
  ensureSqliteColumn(db, "task_files", "fileData", "TEXT");
  ensureSqliteColumn(db, "task_files", "fileSize", "INTEGER");
  ensureSqliteColumn(db, "shared_files", "fileData", "TEXT");
  ensureSqliteColumn(db, "shared_files", "fileSize", "INTEGER");
}

const mysqlStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(80) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    role VARCHAR(40) NOT NULL,
    createdAt VARCHAR(40) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id VARCHAR(80) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    grade VARCHAR(120) NOT NULL,
    targetScore DOUBLE NOT NULL,
    currentLevel VARCHAR(255) NOT NULL,
    \`group\` VARCHAR(255) NOT NULL,
    teacherId VARCHAR(80) NOT NULL,
    assistantId VARCHAR(80) NOT NULL,
    createdAt VARCHAR(40) NOT NULL,
    updatedAt VARCHAR(40) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(80) PRIMARY KEY,
    studentId VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(40) NOT NULL,
    priority VARCHAR(40) NOT NULL,
    dueDate VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(40) NOT NULL,
    pinned TINYINT NOT NULL DEFAULT 0,
    score VARCHAR(120),
    teacherComment TEXT,
    assistantNote TEXT,
    createdAt VARCHAR(40) NOT NULL,
    updatedAt VARCHAR(40) NOT NULL,
    INDEX idx_tasks_student (studentId),
    INDEX idx_tasks_priority (priority),
    CONSTRAINT fk_tasks_student FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS task_files (
    id VARCHAR(80) PRIMARY KEY,
    taskId VARCHAR(80) NOT NULL,
    uploaderId VARCHAR(80) NOT NULL,
    uploaderRole VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    fileType VARCHAR(120) NOT NULL,
    url TEXT NOT NULL,
    fileData LONGTEXT,
    fileSize BIGINT,
    createdAt VARCHAR(40) NOT NULL,
    INDEX idx_task_files_task (taskId),
    CONSTRAINT fk_task_files_task FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS parent_exports (
    id VARCHAR(80) PRIMARY KEY,
    taskId VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    imageUrl TEXT NOT NULL,
    createdAt VARCHAR(40) NOT NULL,
    INDEX idx_parent_exports_task (taskId),
    CONSTRAINT fk_parent_exports_task FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS print_jobs (
    id VARCHAR(80) PRIMARY KEY,
    requester VARCHAR(255) NOT NULL,
    copies INT NOT NULL DEFAULT 1,
    note TEXT NOT NULL,
    fileName VARCHAR(255) NOT NULL,
    fileType VARCHAR(120) NOT NULL,
    fileUrl TEXT NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    createdAt VARCHAR(40) NOT NULL,
    updatedAt VARCHAR(40) NOT NULL,
    INDEX idx_print_jobs_status (status)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(80) PRIMARY KEY,
    actor VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    entityType VARCHAR(80) NOT NULL,
    entityId VARCHAR(80) NOT NULL,
    detail TEXT NOT NULL,
    createdAt VARCHAR(40) NOT NULL,
    INDEX idx_audit_logs_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(80) PRIMARY KEY,
    authorRole VARCHAR(40) NOT NULL,
    authorName VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    createdAt VARCHAR(40) NOT NULL,
    INDEX idx_chat_messages_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS shared_files (
    id VARCHAR(80) PRIMARY KEY,
    uploaderId VARCHAR(80) NOT NULL,
    uploaderRole VARCHAR(40) NOT NULL,
    uploaderName VARCHAR(80) NOT NULL,
    note TEXT NOT NULL,
    fileName VARCHAR(255) NOT NULL,
    fileType VARCHAR(120) NOT NULL,
    fileUrl TEXT NOT NULL,
    fileData LONGTEXT,
    fileSize BIGINT,
    createdAt VARCHAR(40) NOT NULL,
    INDEX idx_shared_files_created (createdAt)
  )`
];

async function ensureMysqlColumn(pool: Pool, table: string, column: string, definition: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function mysqlMigrations(pool: Pool) {
  await ensureMysqlColumn(pool, "task_files", "fileData", "LONGTEXT");
  await ensureMysqlColumn(pool, "task_files", "fileSize", "BIGINT");
  await ensureMysqlColumn(pool, "shared_files", "fileData", "LONGTEXT");
  await ensureMysqlColumn(pool, "shared_files", "fileSize", "BIGINT");
}

async function seedIfEmpty(query: (sql: string, params?: RowValue[]) => Promise<unknown[]>, exec: (sql: string, params?: RowValue[]) => Promise<void>) {
  const count = (await query("SELECT COUNT(*) AS count FROM users"))[0] as { count: number } | undefined;
  if (Number(count?.count ?? 0) > 0) return;

  const createdAt = now();
  await exec(
    `${useMysql ? "INSERT IGNORE" : "INSERT OR IGNORE"} INTO users (id, name, role, createdAt) VALUES
      ('u-admin', 'Admin', 'admin', ?),
      ('u-teacher-lin', 'Lin Teacher', 'teacher', ?),
      ('u-assistant-chen', 'Chen TA', 'assistant', ?),
      ('u-student-anna', 'Anna', 'student', ?)`,
    [createdAt, createdAt, createdAt, createdAt]
  );

  await exec(
    `${useMysql ? "INSERT IGNORE" : "INSERT OR IGNORE"} INTO students (id, name, grade, targetScore, currentLevel, \`group\`, teacherId, assistantId, createdAt, updatedAt)
     VALUES
      ('s-anna', 'Anna Zhang', 'Grade 11', 7, 'Reading 6.0 / Writing 5.5', 'VIP 1-on-1', 'u-teacher-lin', 'u-assistant-chen', ?, ?),
      ('s-kevin', 'Kevin Liu', 'Year 1', 6.5, 'Listening 6.0 / Speaking 5.5', 'Listening & Speaking', 'u-teacher-lin', 'u-assistant-chen', ?, ?)`,
    [createdAt, createdAt, createdAt, createdAt]
  );

  await exec(
    `${useMysql ? "INSERT IGNORE" : "INSERT OR IGNORE"} INTO tasks
      (id, studentId, title, type, priority, dueDate, description, status, pinned, score, teacherComment, assistantNote, createdAt, updatedAt)
     VALUES
      ('t-reading-001', 's-anna', 'Cambridge 18 Test 2 Reading Passage 1', 'reading', 'high', '2026-06-01',
       'Finish the questions first, then mark wrong answers and locating sentences.', 'submitted', 1, NULL,
       'Most mistakes are in True/False/Not Given. Watch synonym replacement.', NULL, ?, ?),
      ('t-writing-001', 's-anna', 'Task 2: Education topic essay rewrite', 'writing', 'high', '2026-06-03',
       'Rewrite body paragraphs based on last correction. Focus on topic sentences.', 'reviewed', 0, 'Band 6.0',
       'The position is clearer, but examples are still too general.', 'Correction photo uploaded.', ?, ?),
      ('t-vocab-001', 's-kevin', 'IELTS listening scenario vocabulary: accommodation', 'vocabulary', 'medium', '2026-06-05',
       'Memorize 80 words, finish dictation, and upload a photo.', 'in_progress', 0, NULL, NULL, NULL, ?, ?)`,
    [createdAt, createdAt, createdAt, createdAt, createdAt, createdAt]
  );

  await exec(
    `${useMysql ? "INSERT IGNORE" : "INSERT OR IGNORE"} INTO task_files (id, taskId, uploaderId, uploaderRole, name, fileType, url, createdAt)
     VALUES
      ('f-001', 't-reading-001', 'u-teacher-lin', 'teacher', 'Cambridge 18 Reading PDF', 'application/pdf', '/mock-files/cambridge-18-reading.pdf', ?),
      ('f-002', 't-writing-001', 'u-assistant-chen', 'assistant', 'Writing correction photo', 'image/jpeg', '/mock-files/writing-correction.jpg', ?)`,
    [createdAt, createdAt]
  );

  await exec(
    `${useMysql ? "INSERT IGNORE" : "INSERT OR IGNORE"} INTO parent_exports (id, taskId, title, imageUrl, createdAt)
     VALUES ('e-001', 't-writing-001', 'Anna Zhang writing feedback', '/mock-exports/anna-writing-feedback.png', ?)`,
    [createdAt]
  );
}

async function getSqliteDatabase() {
  if (sqliteDatabase) return sqliteDatabase;

  const SQL = await loadRuntime();
  sqliteDatabase = existsSync(databasePath) ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database();
  sqliteDatabase.run("PRAGMA foreign_keys = ON;");
  sqliteSchema(sqliteDatabase);
  sqliteMigrations(sqliteDatabase);
  await seedIfEmpty(
    async (sql, params = []) => mapSqliteRows(sqliteDatabase!.exec(sql, params)),
    async (sql, params = []) => {
      sqliteDatabase!.run(sql, params);
    }
  );
  saveSqliteDatabase();
  return sqliteDatabase;
}

async function getMysqlPool() {
  if (mysqlPool) return mysqlPool;

  mysqlPool = process.env.DATABASE_URL
    ? mysql.createPool(process.env.DATABASE_URL)
    : mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        namedPlaceholders: false
      });

  if (!schemaReady) {
    for (const statement of mysqlStatements) {
      await mysqlPool.execute(statement);
    }
    await mysqlMigrations(mysqlPool);
    await seedIfEmpty(
      async (sql, params = []) => {
        const [rows] = await mysqlPool!.execute<RowDataPacket[]>(sql, params);
        return rows;
      },
      async (sql, params = []) => {
        await mysqlPool!.execute(sql, params);
      }
    );
    schemaReady = true;
  }

  return mysqlPool;
}

export async function getDatabase() {
  if (useMysql) return getMysqlPool();
  return getSqliteDatabase();
}

export async function all<T>(sql: string, params: RowValue[] = []) {
  if (useMysql) {
    const pool = await getMysqlPool();
    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    return rows as T[];
  }

  const db = await getSqliteDatabase();
  return mapSqliteRows<T>(db.exec(sql, params));
}

export async function get<T>(sql: string, params: RowValue[] = []) {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: RowValue[] = []) {
  if (useMysql) {
    const pool = await getMysqlPool();
    await pool.execute(sql, params);
    return;
  }

  const db = await getSqliteDatabase();
  db.run(sql, params);
  saveSqliteDatabase();
}

export function createId(prefix: string) {
  return id(prefix);
}

export function databaseType() {
  return useMysql ? "mysql" : "sqlite";
}
