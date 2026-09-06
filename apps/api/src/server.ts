import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { z } from "zod";
import { all, createId, databaseType, get, run } from "./db.js";

type Priority = "high" | "medium" | "low";
type TaskStatus = "not_started" | "in_progress" | "submitted" | "reviewed" | "completed";

interface StudentRow {
  id: string;
  name: string;
  grade: string;
  targetScore: number;
  currentLevel: string;
  group: string;
  teacherId: string;
  teacherName?: string;
  assistantId: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskRow {
  id: string;
  studentId: string;
  title: string;
  type: string;
  priority: string;
  dueDate: string;
  description: string;
  status: string;
  pinned: number;
  score: string | null;
  teacherComment: string | null;
  assistantNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskFileRow {
  id: string;
  taskId: string;
  uploaderId: string;
  uploaderRole: string;
  name: string;
  fileType: string;
  url: string;
  fileData?: string | null;
  fileSize?: number | null;
  createdAt: string;
}

interface PrintJobRow {
  id: string;
  requester: string;
  copies: number;
  note: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditLogRow {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

interface ChatMessageRow {
  id: string;
  authorRole: "teacher" | "assistant";
  authorName: string;
  message: string;
  createdAt: string;
}

interface SharedFileRow {
  id: string;
  uploaderId: string;
  uploaderRole: "teacher" | "assistant";
  uploaderName: string;
  note: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileData?: string | null;
  fileSize?: number | null;
  createdAt: string;
}

interface DailyCheckEntryRow {
  id: string;
  dateKey: string;
  teacherId: string;
  className: string;
  studentId: string;
  columnKey: string;
  checked: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface DailyCheckTaskNoteRow {
  id: string;
  dateKey: string;
  teacherId: string;
  className: string;
  columnKey: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface PersonalTaskRow {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  date: string;
  priority: Priority;
  category: PersonalTaskCategory | null;
  isPriority: number | boolean;
  completed: number | boolean;
  createdAt: string;
  updatedAt: string;
}

interface PersonalTestSubtaskRow {
  id: string;
  ownerId: string;
  testTaskId: string;
  title: string;
  completed: number | boolean;
  createdAt: string;
  updatedAt: string;
}

type PersonalTaskCategory = "class" | "homework" | "test" | "extracurricular";

export const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const uploadDirectory = fileURLToPath(new URL("../data/uploads", import.meta.url));
const exportDirectory = fileURLToPath(new URL("../data/exports", import.meta.url));
const oldCompletedTaskRetentionDays = 2;
const oldCompletedTaskCleanupIntervalMs = 12 * 60 * 60 * 1000;
const personalWorkspaceOwnerId = "personal_workspace_owner_v1";
let oldCompletedTaskCleanupAt = 0;
let oldCompletedTaskCleanupPromise: Promise<void> | null = null;

const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    }
  })
);
app.use(express.json());
app.use("/uploads", express.static(uploadDirectory));
app.use("/exports", express.static(exportDirectory));

const createStudentSchema = z.object({
  name: z.string().trim().min(1),
  grade: z.string().default(""),
  targetScore: z.number().min(0).max(9).default(0),
  currentLevel: z.string().default(""),
  group: z.string().trim().min(1),
  teacherName: z.string().trim().min(1),
  assistantId: z.string().min(1).default("u-assistant-chen")
});

const updateStudentSchema = z.object({
  name: z.string().trim().min(1).optional(),
  grade: z.string().optional(),
  targetScore: z.number().min(0).max(9).optional(),
  currentLevel: z.string().optional(),
  group: z.string().trim().min(1).optional(),
  teacherName: z.string().trim().min(1).optional()
});

const updateTeacherSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const createTeacherSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const renameTeacherGroupSchema = z.object({
  currentGroupName: z.string().trim().min(1),
  nextGroupName: z.string().trim().min(1)
});

const moveTeacherGroupSchema = z.object({
  groupName: z.string().trim().min(1),
  nextTeacherId: z.string().trim().min(1),
  nextGroupName: z.string().trim().min(1).optional()
});

const dailyFeedbackQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const dueDateSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/\//g, "-").slice(0, 10);
  return normalized || undefined;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

const createTaskSchema = z.object({
  studentId: z.string().min(1),
  title: z.string().min(2),
  type: z.enum(["reading", "listening", "writing", "speaking", "vocabulary", "grammar"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  dueDate: dueDateSchema,
  description: z.string().default(""),
  pinned: z.boolean().default(false)
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  status: z.enum(["not_started", "in_progress", "submitted", "reviewed", "completed"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  dueDate: dueDateSchema,
  pinned: z.boolean().optional(),
  teacherComment: z.string().optional(),
  assistantNote: z.string().optional(),
  score: z.string().optional()
});

const createPrintJobSchema = z.object({
  requester: z.string().min(1),
  copies: z.coerce.number().int().min(1).max(200),
  note: z.string().default("")
});

const updatePrintJobSchema = z.object({
  status: z.enum(["pending", "printed", "cancelled"])
});

const createChatMessageSchema = z.object({
  authorRole: z.enum(["teacher", "assistant"]),
  authorName: z.string().min(1).max(40),
  message: z.string().trim().min(1).max(500)
});

const createSharedFileSchema = z.object({
  uploaderId: z.string().min(1).default("u-teacher-lin"),
  uploaderRole: z.enum(["teacher", "assistant"]).default("teacher"),
  uploaderName: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300).default("")
});

const dailyCheckEntrySchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacherId: z.string().min(1),
  className: z.string().trim().min(1).max(255),
  studentId: z.string().min(1),
  columnKey: z.string().trim().min(1).max(80),
  checked: z.boolean(),
  note: z.string().trim().max(500).default("")
});

const dailyCheckTaskNoteSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacherId: z.string().min(1),
  className: z.string().trim().min(1).max(255),
  columnKey: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).default("")
});

const personalTaskDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(""));
const personalTaskMonthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  scope: z.enum(["calendar", "priority"]).default("calendar")
}).superRefine((value, context) => {
  if (value.scope === "calendar" && !value.month) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["month"], message: "month is required for calendar tasks" });
  }
});
const personalTaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).default(""),
  date: personalTaskDateSchema,
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  category: z.enum(["class", "homework", "test", "extracurricular"]).default("homework"),
  isPriority: z.boolean().default(false)
}).superRefine((value, context) => {
  if (!value.isPriority && !value.date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "calendar tasks require a date" });
  }
});
const personalTaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).optional(),
  date: personalTaskDateSchema.optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  category: z.enum(["class", "homework", "test", "extracurricular"]).optional(),
  isPriority: z.boolean().optional(),
  completed: z.boolean().optional()
});
const personalTestSubtaskQuerySchema = z.object({ testTaskId: z.string().trim().min(1).max(80) });
const personalTestSubtaskCreateSchema = z.object({
  testTaskId: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(255)
});
const personalTestSubtaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  completed: z.boolean().optional()
});

const dailyCheckTaskColumns = [
  { key: "list", label: "list" },
  { key: "reading", label: "阅读作业" },
  { key: "listening", label: "听力作业" },
  { key: "vocab_cn", label: "答案词（中）" },
  { key: "vocab_en", label: "答案词（英）" },
  { key: "speaking", label: "口语（2话题）" },
  { key: "writing", label: "写作作业" }
];

const priorityRank: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2
};

const statusRank: Record<TaskStatus, number> = {
  not_started: 0,
  in_progress: 1,
  submitted: 2,
  reviewed: 3,
  completed: 4
};

const taskStatusLabels: Record<TaskStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  submitted: "已提交",
  reviewed: "已批改",
  completed: "已完成"
};

function now() {
  return new Date().toISOString();
}

function subtractDays(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function getOldCompletedTaskCutoffDate() {
  return subtractDays(oldCompletedTaskRetentionDays).toISOString().slice(0, 10);
}

function countTasksWithinDays(tasks: Pick<TaskRow, "dueDate">[], days: number) {
  const cutoffDate = subtractDays(days);
  cutoffDate.setHours(0, 0, 0, 0);
  const cutoffKey = cutoffDate.toISOString().slice(0, 10);
  return tasks.filter((task) => task.dueDate && task.dueDate.slice(0, 10) >= cutoffKey).length;
}

function getDashboardRelevantTaskIds(tasks: TaskRow[], days: number) {
  const cutoffDate = subtractDays(days);
  cutoffDate.setHours(0, 0, 0, 0);
  const cutoffKey = cutoffDate.toISOString().slice(0, 10);
  return tasks
    .filter((task) => task.status !== "completed" || (task.dueDate && task.dueDate.slice(0, 10) >= cutoffKey))
    .map((task) => task.id);
}

async function deleteStoredAppFile(fileUrl: string, baseRoute: "/uploads/" | "/exports/", directory: string) {
  if (!fileUrl.startsWith(baseRoute)) return;
  const storedName = basename(fileUrl.replace(baseRoute, ""));
  await unlink(join(directory, storedName)).catch(() => undefined);
}

async function writeAuditLog(input: {
  actor?: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}) {
  const timestamp = now();
  await run(
    "INSERT INTO audit_logs (id, actor, action, entityType, entityId, detail, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      createId("log"),
      input.actor ?? "u-teacher-lin",
      input.action,
      input.entityType,
      input.entityId,
      input.detail,
      timestamp
    ]
  );
  await touchDashboardVersion(timestamp);
}

function mapTask(task: TaskRow) {
  return {
    ...task,
    pinned: Boolean(task.pinned),
    score: task.score ?? undefined,
    teacherComment: task.teacherComment ?? undefined,
    assistantNote: task.assistantNote ?? undefined
  };
}

async function findTeacherUserByName(name: string) {
  return get<{ id: string; name: string }>("SELECT id, name FROM users WHERE role = 'teacher' AND name = ?", [name.trim()]);
}

async function ensureTeacherUser(name: string) {
  const normalizedName = name.trim();
  const existing = await findTeacherUserByName(normalizedName);
  if (existing) return existing;

  const id = createId("u-teacher");
  await run("INSERT INTO users (id, name, role, createdAt) VALUES (?, ?, 'teacher', ?)", [id, normalizedName, now()]);
  return { id, name: normalizedName };
}

async function touchDashboardVersion(timestamp = now()) {
  const marker = `${timestamp}:${createId("dv")}`;
  if (databaseType() === "mysql") {
    await run(
      `INSERT INTO dashboard_versions (id, marker, updatedAt)
       VALUES ('main', ?, ?)
       ON DUPLICATE KEY UPDATE marker = VALUES(marker), updatedAt = VALUES(updatedAt)`,
      [marker, timestamp]
    );
    return;
  }

  await run(
    `INSERT INTO dashboard_versions (id, marker, updatedAt)
     VALUES ('main', ?, ?)
     ON CONFLICT(id) DO UPDATE SET marker = excluded.marker, updatedAt = excluded.updatedAt`,
    [marker, timestamp]
  );
}

async function readDashboardVersionMarker() {
  const row = await get<{ marker: string | null; updatedAt: string | null }>(
    "SELECT marker, updatedAt FROM dashboard_versions WHERE id = 'main'"
  );
  return row?.marker ?? row?.updatedAt ?? "";
}

async function markTasksWithTaskEvidenceCompleted() {
  await run(
    `UPDATE tasks
     SET status = 'completed', updatedAt = ?
     WHERE status <> 'completed'
       AND (
         COALESCE(TRIM(teacherComment), '') <> ''
         OR EXISTS (
           SELECT 1
           FROM task_files
           WHERE task_files.taskId = tasks.id
             AND task_files.uploaderRole = 'student'
         )
         OR EXISTS (
           SELECT 1
           FROM task_files
           WHERE task_files.taskId = tasks.id
             AND task_files.uploaderRole = 'assistant'
             AND task_files.fileType LIKE 'image/%'
         )
       )`,
    [now()]
  );
}

async function cleanupOldCompletedTasks() {
  const startedAt = Date.now();
  if (oldCompletedTaskCleanupPromise) return oldCompletedTaskCleanupPromise;
  if (startedAt - oldCompletedTaskCleanupAt < oldCompletedTaskCleanupIntervalMs) return;

  let cleanupSucceeded = false;
  oldCompletedTaskCleanupPromise = (async () => {
    const cutoffDate = getOldCompletedTaskCutoffDate();
    const expiredTasks = await all<Pick<TaskRow, "id">>(
      "SELECT id FROM tasks WHERE status = 'completed' AND dueDate <> '' AND dueDate < ?",
      [cutoffDate]
    );
    if (!expiredTasks.length) return;

    const taskIds = expiredTasks.map((task) => task.id);
    const [taskFiles, parentExports] = await Promise.all([
      all<Pick<TaskFileRow, "id" | "taskId" | "url">>(
        `SELECT id, taskId, url
         FROM task_files
         WHERE taskId IN (
           SELECT id
           FROM tasks
           WHERE status = 'completed' AND dueDate <> '' AND dueDate < ?
         )`,
        [cutoffDate]
      ),
      all<{ id: string; taskId: string; imageUrl: string }>(
        `SELECT id, taskId, imageUrl
         FROM parent_exports
         WHERE taskId IN (
           SELECT id
           FROM tasks
           WHERE status = 'completed' AND dueDate <> '' AND dueDate < ?
         )`,
        [cutoffDate]
      )
    ]);

    await Promise.all([
      ...taskFiles.map((file) => deleteStoredAppFile(file.url, "/uploads/", uploadDirectory)),
      ...parentExports.map((item) => deleteStoredAppFile(item.imageUrl, "/exports/", exportDirectory))
    ]);

    const expiredTaskSubquery = `
      SELECT id
      FROM tasks
      WHERE status = 'completed' AND dueDate <> '' AND dueDate < ?
    `;

    await run(`DELETE FROM audit_logs WHERE entityType = 'task' AND entityId IN (${expiredTaskSubquery})`, [cutoffDate]);
    await run(`DELETE FROM parent_exports WHERE taskId IN (${expiredTaskSubquery})`, [cutoffDate]);
    await run(`DELETE FROM task_files WHERE taskId IN (${expiredTaskSubquery})`, [cutoffDate]);
    await run("DELETE FROM tasks WHERE status = 'completed' AND dueDate <> '' AND dueDate < ?", [cutoffDate]);

    await writeAuditLog({
      actor: "system",
      action: "old_completed_tasks_cleaned",
      entityType: "task",
      entityId: `cleanup-before-${cutoffDate}`,
      detail: `Deleted ${taskIds.length} completed tasks older than ${oldCompletedTaskRetentionDays} days and ${taskFiles.length} related files`
    });
    cleanupSucceeded = true;
  })()
    .catch((error) => {
      console.error("Failed to cleanup old completed tasks", error);
    })
    .finally(() => {
      if (cleanupSucceeded) oldCompletedTaskCleanupAt = Date.now();
      oldCompletedTaskCleanupPromise = null;
    });

  return oldCompletedTaskCleanupPromise;
}

function normalizeUploadedFileName(value: string | undefined | null, fallback = "file") {
  const fileName = basename(value || fallback);

  try {
    const decoded = Buffer.from(fileName, "latin1").toString("utf8");
    const looksRecovered = /[\u4e00-\u9fff]/.test(decoded) && !decoded.includes("�");
    if (looksRecovered) return decoded;
  } catch {
    return fileName;
  }

  return fileName;
}

function mapTaskFile(file: TaskFileRow) {
  const { fileData: _fileData, fileSize: _fileSize, ...safeFile } = file;
  return {
    ...safeFile,
    url: `/api/task-files/${file.id}/content`,
    name: normalizeUploadedFileName(file.name, "Untitled attachment")
  };
}

function mapPrintJob(job: PrintJobRow) {
  return {
    ...job,
    fileName: normalizeUploadedFileName(job.fileName, "print-file")
  };
}

function mapSharedFile(file: SharedFileRow) {
  const { fileData: _fileData, ...safeFile } = file;
  return {
    ...safeFile,
    fileName: normalizeUploadedFileName(file.fileName, "shared-file")
  };
}

function mapDailyCheckEntry(entry: DailyCheckEntryRow) {
  return {
    ...entry,
    checked: Boolean(entry.checked)
  };
}

function mapPersonalTask(task: PersonalTaskRow) {
  const { ownerId: _ownerId, ...personalTask } = task;
  return {
    ...personalTask,
    isPriority: Boolean(task.isPriority),
    completed: Boolean(task.completed)
  };
}

function inferPersonalTaskCategory(title: string): PersonalTaskCategory {
  const normalizedTitle = title.toLowerCase();
  if (/midterm|quiz|final|test|exam|期中|期末|考试|测验/.test(normalizedTitle)) return "test";
  if (/varsity|skate|滑冰|吃饭|dinner|appointment|邀约|约饭/.test(normalizedTitle)) return "extracurricular";
  if (/^[a-z]{2,5}\d{3,4}[a-z]?\d?\b|\b(lec|tut|pra|lab|sem)\b/i.test(title)) return "class";
  return "homework";
}

function getPersonalTaskEffectiveCategory(task: Pick<PersonalTaskRow, "title" | "category">): PersonalTaskCategory {
  return task.category ?? inferPersonalTaskCategory(task.title);
}

function mapPersonalTestSubtask(subtask: PersonalTestSubtaskRow) {
  const { ownerId: _ownerId, ...mapped } = subtask;
  return { ...mapped, completed: Boolean(subtask.completed) };
}

async function getOwnedTestTask(testTaskId: string) {
  const task = await get<Pick<PersonalTaskRow, "id" | "ownerId" | "title" | "category" | "isPriority">>(
    "SELECT id, ownerId, title, category, isPriority FROM personal_tasks WHERE id = ? AND ownerId = ?",
    [testTaskId, personalWorkspaceOwnerId]
  );
  if (!task || Boolean(task.isPriority) || getPersonalTaskEffectiveCategory(task) !== "test") return null;
  return task;
}

function sortTasksForTeacher<T extends { pinned: boolean; status: string; priority: string; dueDate: string }>(input: T[]) {
  return [...input].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    if (priorityRank[a.priority as Priority] !== priorityRank[b.priority as Priority]) {
      return priorityRank[a.priority as Priority] - priorityRank[b.priority as Priority];
    }
    const dueDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (dueDiff !== 0) return dueDiff;
    return statusRank[a.status as TaskStatus] - statusRank[b.status as TaskStatus];
  });
}

function escapeXml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapSvgText(value: string, maxChars = 24) {
  const clean = value.trim() || "暂无评语";
  const lines: string[] = [];
  for (let index = 0; index < clean.length; index += maxChars) {
    lines.push(clean.slice(index, index + maxChars));
  }
  return lines;
}

function sanitizeExportFileName(value: string | undefined | null, fallback: string) {
  const clean = String(value ?? "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
  return clean || fallback;
}

function getDateKey(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\//g, "-").slice(0, 10);
}

function getShanghaiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return `${partMap.get("year")}-${partMap.get("month")}-${partMap.get("day")}`;
}

function stripControlCharacters(value: string | null | undefined) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function normalizeDailyCheckMatchText(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isDailyCheckTaskMatch(taskTitle: string, columnKey: string, taskNote: string | null | undefined) {
  const normalizedTitle = normalizeDailyCheckMatchText(taskTitle);
  if (!normalizedTitle) return false;
  const column = dailyCheckTaskColumns.find((item) => item.key === columnKey);
  return (
    normalizedTitle === normalizeDailyCheckMatchText(column?.label) ||
    normalizedTitle === normalizeDailyCheckMatchText(taskNote)
  );
}

function getDailyCheckClassName(student: StudentRow) {
  return student.group.trim() || "未分班";
}

async function findDailyCheckColumnForTask(task: TaskRow, student: StudentRow) {
  const dateKey = getDateKey(task.dueDate);
  if (!dateKey) return null;

  const taskNotes = await all<DailyCheckTaskNoteRow>(
    "SELECT * FROM daily_check_task_notes WHERE dateKey = ? AND teacherId = ? AND className = ?",
    [dateKey, student.teacherId, getDailyCheckClassName(student)]
  );
  const notesByColumn = new Map(taskNotes.map((note) => [note.columnKey, note.note]));
  return (
    dailyCheckTaskColumns.find((column) => isDailyCheckTaskMatch(task.title, column.key, notesByColumn.get(column.key))) ??
    null
  );
}

async function upsertDailyCheckEntryFromTask(task: TaskRow, student: StudentRow, columnKey: string, timestamp = now()) {
  const dateKey = getDateKey(task.dueDate);
  if (!dateKey) return;

  const id = createId("dce");
  const checkedValue = task.status === "completed" ? 1 : 0;
  const taskNote = String(task.teacherComment ?? "").trim();

  if (databaseType() === "mysql") {
    await run(
      `INSERT INTO daily_check_entries (id, dateKey, teacherId, className, studentId, columnKey, checked, note, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE checked = VALUES(checked), note = VALUES(note), updatedAt = VALUES(updatedAt)`,
      [id, dateKey, student.teacherId, getDailyCheckClassName(student), student.id, columnKey, checkedValue, taskNote, timestamp, timestamp]
    );
    return;
  }

  await run(
    `INSERT INTO daily_check_entries (id, dateKey, teacherId, className, studentId, columnKey, checked, note, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dateKey, teacherId, className, studentId, columnKey)
     DO UPDATE SET checked = excluded.checked,
                   note = excluded.note,
                   updatedAt = excluded.updatedAt`,
    [id, dateKey, student.teacherId, getDailyCheckClassName(student), student.id, columnKey, checkedValue, taskNote, timestamp, timestamp]
  );
}

async function syncDailyCheckEntryFromTask(taskId: string, timestamp = now()) {
  const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task) return;
  const student = await get<StudentRow>(
    `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
            students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
     FROM students
     LEFT JOIN users ON users.id = students.teacherId
     WHERE students.id = ?`,
    [task.studentId]
  );
  if (!student) return;
  const column = await findDailyCheckColumnForTask(task, student);
  if (!column) return;
  await upsertDailyCheckEntryFromTask(task, student, column.key, timestamp);
}

async function syncTaskFromDailyCheckEntry(input: {
  dateKey: string;
  teacherId: string;
  className: string;
  studentId: string;
  columnKey: string;
  checked: boolean;
  note: string;
}, timestamp = now()) {
  const taskNote = await get<DailyCheckTaskNoteRow>(
    "SELECT * FROM daily_check_task_notes WHERE dateKey = ? AND teacherId = ? AND className = ? AND columnKey = ?",
    [input.dateKey, input.teacherId, input.className, input.columnKey]
  );
  const matchingTasks = await all<TaskRow>(
    "SELECT * FROM tasks WHERE studentId = ? AND substr(replace(dueDate, '/', '-'), 1, 10) = ? ORDER BY createdAt DESC",
    [input.studentId, input.dateKey]
  );
  const task = matchingTasks.find((item) => isDailyCheckTaskMatch(item.title, input.columnKey, taskNote?.note));
  if (!task) return;

  const nextStatus: TaskStatus = input.checked || input.note.trim() ? "completed" : "not_started";
  const nextTeacherComment = input.note.trim();
  await run("UPDATE tasks SET status = ?, teacherComment = ?, updatedAt = ? WHERE id = ?", [
    nextStatus,
    nextTeacherComment,
    timestamp,
    task.id
  ]);
}

async function syncDailyCheckColumnFromMatchingTasks(input: {
  dateKey: string;
  teacherId: string;
  className: string;
  columnKey: string;
  note: string;
}, timestamp = now()) {
  const students = await all<StudentRow>(
    `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
            students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
     FROM students
     LEFT JOIN users ON users.id = students.teacherId
     WHERE students.teacherId = ? AND students.\`group\` = ?`,
    [input.teacherId, input.className]
  );
  if (students.length === 0) return;

  const studentById = new Map(students.map((student) => [student.id, student]));
  const tasks = await all<TaskRow>(
    `SELECT * FROM tasks
     WHERE substr(replace(dueDate, '/', '-'), 1, 10) = ?
       AND studentId IN (${students.map(() => "?").join(", ")})
     ORDER BY createdAt DESC`,
    [input.dateKey, ...students.map((student) => student.id)]
  );

  for (const task of tasks) {
    if (!isDailyCheckTaskMatch(task.title, input.columnKey, input.note)) continue;
    const student = studentById.get(task.studentId);
    if (!student) continue;
    await upsertDailyCheckEntryFromTask(task, student, input.columnKey, timestamp);
  }
}

function pdfSafeText(value: string | null | undefined, fallback = "-") {
  const clean = stripControlCharacters(value);
  if (!clean) return fallback;
  return clean.replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");
}

async function readDashboardVersion() {
  const [users, students, tasks, taskFiles, sharedFiles, printJobs, auditLogs, dailyCheckEntries, dailyCheckTaskNotes] = await Promise.all([
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(createdAt) AS marker FROM users WHERE role <> 'archived_teacher'"),
    get<{ count: number; marker: string | null }>(
      `SELECT COUNT(*) AS count, MAX(students.updatedAt) AS marker
       FROM students
       INNER JOIN users ON users.id = students.teacherId AND users.role = 'teacher'`
    ),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(updatedAt) AS marker FROM tasks"),
    readDashboardVersionMarker().then((marker) => ({ count: 1, marker })),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(createdAt) AS marker FROM shared_files"),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(updatedAt) AS marker FROM print_jobs"),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(createdAt) AS marker FROM audit_logs"),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(updatedAt) AS marker FROM daily_check_entries"),
    get<{ count: number; marker: string | null }>("SELECT COUNT(*) AS count, MAX(updatedAt) AS marker FROM daily_check_task_notes")
  ]);

  return [
    users,
    students,
    tasks,
    taskFiles,
    sharedFiles,
    printJobs,
    auditLogs,
    dailyCheckEntries,
    dailyCheckTaskNotes
  ]
    .map((part) => `${part?.count ?? 0}:${part?.marker ?? ""}`)
    .join("|");
}

async function imageDataUriFromTaskFile(file: TaskFileRow) {
  if (file.fileData) {
    return `data:${file.fileType};base64,${file.fileData}`;
  }

  if (file.url.startsWith("data:")) return file.url;

  if (file.url.startsWith("http://") || file.url.startsWith("https://")) {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Failed to fetch correction image: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || file.fileType;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  }

  const storedName = basename(file.url.replace("/uploads/", ""));
  const bytes = await readFile(join(uploadDirectory, storedName));
  return `data:${file.fileType};base64,${bytes.toString("base64")}`;
}

async function readTaskFileBytes(file: TaskFileRow) {
  if (file.fileData) {
    return Buffer.from(file.fileData, "base64");
  }

  if (file.url.startsWith("data:")) {
    const base64 = file.url.split(",", 2)[1] ?? "";
    return Buffer.from(base64, "base64");
  }

  if (file.url.startsWith("http://") || file.url.startsWith("https://")) {
    const response = await fetch(file.url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  if (file.url.startsWith("/uploads/")) {
    const storedName = basename(file.url.replace("/uploads/", ""));
    const localBytes = await readFile(join(uploadDirectory, storedName)).catch(() => null);
    if (localBytes) return localBytes;
  }

  const storedFile = await get<Pick<TaskFileRow, "fileData">>("SELECT fileData FROM task_files WHERE id = ?", [file.id]).catch(() => null);
  if (storedFile?.fileData) {
    return Buffer.from(storedFile.fileData, "base64");
  }

  return null;
}

async function createPdfImageBytes(bytes: Buffer, fileType: string) {
  if (!fileType.startsWith("image/")) return bytes;
  const lowerFileType = fileType.toLowerCase();
  if ((lowerFileType === "image/jpeg" || lowerFileType === "image/jpg") && bytes.length <= 3 * 1024 * 1024) {
    return bytes;
  }
  return sharp(bytes)
    .rotate()
    .resize({ width: 900, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 68 })
    .toBuffer()
    .catch(() => bytes);
}

async function compressUploadedImage(bytes: Buffer, fileType: string) {
  if (!fileType.startsWith("image/")) return bytes;
  if (fileType === "image/gif" || fileType === "image/svg+xml") return bytes;

  try {
    let pipeline = sharp(bytes, { animated: false }).rotate().resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true
    });

    if (fileType === "image/png") {
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: 76
      });
    } else if (fileType === "image/webp") {
      pipeline = pipeline.webp({ quality: 74 });
    } else {
      pipeline = pipeline.jpeg({ quality: 72, mozjpeg: true });
    }

    const compressedBytes = await pipeline.toBuffer();
    return compressedBytes.length < bytes.length ? compressedBytes : bytes;
  } catch {
    return bytes;
  }
}

async function prepareStoredUpload(file: Express.Multer.File) {
  const originalBytes = file.buffer;
  const storedBytes = file.mimetype.startsWith("image/")
    ? await compressUploadedImage(originalBytes, file.mimetype)
    : originalBytes;

  return {
    originalName: normalizeUploadedFileName(file.originalname, "file"),
    fileType: file.mimetype ?? "application/octet-stream",
    storedBytes
  };
}

async function readSharedFileBytes(file: SharedFileRow) {
  if (file.fileData) {
    return Buffer.from(file.fileData, "base64");
  }

  if (file.fileUrl.startsWith("data:")) {
    const base64 = file.fileUrl.split(",", 2)[1] ?? "";
    return Buffer.from(base64, "base64");
  }

  if (file.fileUrl.startsWith("http://") || file.fileUrl.startsWith("https://")) {
    const response = await fetch(file.fileUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  if (file.fileUrl.startsWith("/uploads/")) {
    const storedName = basename(file.fileUrl.replace("/uploads/", ""));
    return readFile(join(uploadDirectory, storedName)).catch(() => null);
  }

  return null;
}

function formatPdfDueDate(value: string) {
  if (!value) return "未设置 DDL";
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T20:00` : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ");
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function resolvePdfFontPath() {
  const bundledFullFontPath = fileURLToPath(new URL("../assets/QledaCjk.ttf", import.meta.url));
  const bundledSubsetFontPath = fileURLToPath(new URL("../assets/NotoSansSC-QledaSubset.ttf", import.meta.url));
  const candidates = [
    process.env.PDF_FONT_PATH,
    bundledFullFontPath,
    bundledSubsetFontPath,
    "C:\\Windows\\Fonts\\simhei.ttf",
    "C:\\Windows\\Fonts\\msyh.ttc",
    "C:\\Windows\\Fonts\\Deng.ttf"
  ].filter((value): value is string => Boolean(value));

  return candidates.find((fontPath) => /\.(otf|ttf|ttc)$/i.test(fontPath) && existsSync(fontPath));
}

function setPdfFont(doc: PDFKit.PDFDocument) {
  const fontPath = resolvePdfFontPath();
  if (fontPath) {
    doc.registerFont("QledaCjk", fontPath);
    doc.font("QledaCjk");
    return;
  }
  doc.font("Helvetica");
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    setPdfFont(doc);
  }
}

function drawPdfSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensurePdfSpace(doc, 40);
  doc.fillColor("#073f34").fontSize(16).text(title).moveDown(0.45);
}

function drawPdfMetaPill(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number) {
  doc.roundedRect(x, y, width, 22, 11).fill("#e4f2e8");
  doc.fillColor("#073f34").fontSize(9).text(text, x + 9, y + 6, { width: width - 18, lineBreak: false });
}

function collectPdfBuffer(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function preloadDailyFeedbackImages(files: TaskFileRow[]) {
  const imageFiles = files.filter((file) => file.fileType.startsWith("image/"));
  const loadedImages = await mapWithConcurrency(imageFiles, 4, async (file) => {
    const bytes = await readTaskFileBytes(file);
    if (!bytes) return null;
    return { fileId: file.id, bytes: await createPdfImageBytes(bytes, file.fileType) };
  });
  const imageBytesByFileId = new Map<string, Buffer>();
  loadedImages.forEach((item) => {
    if (item) imageBytesByFileId.set(item.fileId, item.bytes);
  });
  return imageBytesByFileId;
}

async function attachDailyFeedbackImageData(files: TaskFileRow[]) {
  const imageFiles = files.filter((file) => file.fileType.startsWith("image/"));
  if (!imageFiles.length) return files;

  const placeholders = imageFiles.map(() => "?").join(",");
  const imageDataRows = await all<Pick<TaskFileRow, "id" | "fileData">>(
    `SELECT id, fileData
     FROM task_files
     WHERE id IN (${placeholders})`,
    imageFiles.map((file) => file.id)
  );
  const imageDataById = new Map(imageDataRows.map((row) => [row.id, row.fileData]));
  return files.map((file) =>
    file.fileType.startsWith("image/") ? { ...file, fileData: imageDataById.get(file.id) ?? file.fileData ?? null } : file
  );
}

const dailyFeedbackPdfCache = new Map<string, { expiresAt: number; pdf: Buffer }>();
const dailyFeedbackPdfCacheTtlMs = 60 * 60 * 1000;
const dailyFeedbackPdfCacheMaxEntries = 30;

function createDailyFeedbackCacheKey(input: {
  student: StudentRow;
  tasks: TaskRow[];
  taskFiles: TaskFileRow[];
  date: string;
}) {
  const hash = createHash("sha1");
  hash.update(input.student.id);
  hash.update(input.student.name);
  hash.update(input.student.group || "");
  hash.update(input.student.currentLevel || "");
  hash.update(input.student.updatedAt || "");
  hash.update(input.date);
  input.tasks.forEach((task) => {
    hash.update(
      [
        task.id,
        task.title,
        task.type,
        task.status,
        task.score || "",
        task.teacherComment || "",
        task.assistantNote || "",
        task.dueDate,
        task.updatedAt
      ].join("|")
    );
  });
  input.taskFiles.forEach((file) => {
    hash.update([file.id, file.taskId, file.name, file.fileType, file.fileSize || "", file.createdAt].join("|"));
  });
  return `${input.student.id}:${input.date}:${hash.digest("hex")}`;
}

function rememberDailyFeedbackPdf(cacheKey: string, pdf: Buffer) {
  const nowMs = Date.now();
  for (const [key, value] of dailyFeedbackPdfCache.entries()) {
    if (value.expiresAt <= nowMs) dailyFeedbackPdfCache.delete(key);
  }
  dailyFeedbackPdfCache.set(cacheKey, { expiresAt: nowMs + dailyFeedbackPdfCacheTtlMs, pdf });
  while (dailyFeedbackPdfCache.size > dailyFeedbackPdfCacheMaxEntries) {
    const oldestKey = dailyFeedbackPdfCache.keys().next().value;
    if (!oldestKey) break;
    dailyFeedbackPdfCache.delete(oldestKey);
  }
}

async function createDailyFeedbackPdf(input: {
  student: StudentRow;
  tasks: TaskRow[];
  taskFiles: TaskFileRow[];
  date: string;
}) {
  const title = `${input.student.name}-${input.date}-当日全部作业反馈`;
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: title,
      Author: "QULEDA Teaching Operations",
      Subject: "Daily homework feedback"
    }
  });
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const taskFilesByTask = new Map<string, TaskFileRow[]>();
  input.taskFiles.forEach((file) => {
    const current = taskFilesByTask.get(file.taskId) ?? [];
    current.push(file);
    taskFilesByTask.set(file.taskId, current);
  });
  const imageBytesByFileId = await preloadDailyFeedbackImages(input.taskFiles);

  setPdfFont(doc);
  doc.rect(0, 0, doc.page.width, 150).fill("#f8f3df");
  doc
    .fillColor("#073f34")
    .fontSize(30)
    .text("QULEDA", 42, 38, { width: contentWidth * 0.45 })
    .fontSize(10)
    .fillColor("#0f765e")
    .text("DAILY HOMEWORK FEEDBACK", 44, 75, { characterSpacing: 1.2 })
    .fontSize(24)
    .fillColor("#17211d")
    .text("当日全部作业反馈", 42, 104, { width: contentWidth });

  doc
    .roundedRect(340, 34, 212, 84, 22)
    .fill("#0a4f42")
    .fillColor("#fffdf5")
    .fontSize(15)
    .text(input.student.name, 362, 56, { width: 168 })
    .fontSize(10)
    .fillColor("#d6e9de")
    .text(`${input.date} | ${input.tasks.length} 个任务`, 362, 82, { width: 168 });

  doc.y = 180;
  drawPdfSectionTitle(doc, "学生概览");
  const overviewY = doc.y;
  drawPdfMetaPill(doc, `班级 ${input.student.group || "未分班"}`, 42, overviewY, 138);
  drawPdfMetaPill(doc, `目标分 ${input.student.targetScore}`, 192, overviewY, 110);
  drawPdfMetaPill(doc, `当前水平 ${input.student.currentLevel || "未填写"}`, 314, overviewY, 238);
  doc.y = overviewY + 44;

  for (const [index, task] of input.tasks.entries()) {
    ensurePdfSpace(doc, 160);
    const taskTop = doc.y;
    doc
      .roundedRect(42, taskTop, contentWidth, 48, 16)
      .fill(index % 2 === 0 ? "#edf6eb" : "#fff8e8")
      .fillColor("#073f34")
      .fontSize(15)
      .text(`${index + 1}. ${stripControlCharacters(task.title)}`, 58, taskTop + 12, { width: contentWidth - 116, lineGap: 2 })
      .fillColor("#0f765e")
      .fontSize(9)
      .text(`DDL ${formatPdfDueDate(task.dueDate)}`, 428, taskTop + 16, { width: 108, align: "right" });

    doc.y = taskTop + 64;
    const pillY = doc.y;
    drawPdfMetaPill(doc, taskStatusLabels[task.status as TaskStatus] ?? task.status, 58, pillY, 88);
    drawPdfMetaPill(doc, task.score ? `分数 ${task.score}` : "暂无分数", 156, pillY, 104);
    drawPdfMetaPill(doc, `类型 ${stripControlCharacters(task.type)}`, 270, pillY, 98);
    doc.y = pillY + 38;

    const description = stripControlCharacters(task.description);
    if (description) {
      doc.fillColor("#4f5d55").fontSize(10).text(description, 58, doc.y, { width: contentWidth - 32, lineGap: 3 }).moveDown(0.6);
    }

    const comment = stripControlCharacters(task.teacherComment || task.assistantNote) || "老师暂未留下文字评语，请以批改图片为准。";
    const commentHeight = Math.max(64, doc.heightOfString(comment, { width: contentWidth - 60, lineGap: 4 }) + 36);
    ensurePdfSpace(doc, commentHeight + 20);
    const commentY = doc.y;
    doc.roundedRect(54, commentY, contentWidth - 24, commentHeight, 18).fill("#fffaf0");
    doc
      .fillColor("#073f34")
      .fontSize(11)
      .text("老师评语", 72, commentY + 14)
      .fillColor("#17211d")
      .fontSize(10.5)
      .text(comment, 72, commentY + 34, { width: contentWidth - 60, lineGap: 4 });
    doc.y = commentY + commentHeight + 18;

    const taskImages = (taskFilesByTask.get(task.id) ?? []).filter((file) => file.fileType.startsWith("image/"));
    if (taskImages.length === 0) {
      ensurePdfSpace(doc, 34);
      doc.fillColor("#69736c").fontSize(9.5).text("暂无作业或批改图片。", 58, doc.y, { width: contentWidth - 32 }).moveDown(1);
      continue;
    }

    for (const file of taskImages) {
      const imageCardHeight = 712;
      const imageFitHeight = 660;
      const imageCardX = 42;
      const imageCardWidth = contentWidth;
      const imageInnerX = 50;
      const imageInnerWidth = contentWidth - 16;
      ensurePdfSpace(doc, imageCardHeight + 22);
      const imageY = doc.y;
      const imageLabel = file.uploaderRole === "assistant" ? "批改图片" : "作业图片";
      doc.roundedRect(imageCardX, imageY, imageCardWidth, imageCardHeight, 18).fill("#ffffff");
      doc.fillColor("#073f34").fontSize(10).text(`${imageLabel} · ${normalizeUploadedFileName(file.name, imageLabel)}`, imageInnerX, imageY + 14, {
        width: imageInnerWidth
      });
      try {
        const bytes = imageBytesByFileId.get(file.id) ?? (await readTaskFileBytes(file));
        if (!bytes) throw new Error("No image bytes");
        doc.image(bytes, imageInnerX, imageY + 38, {
          fit: [imageInnerWidth, imageFitHeight],
          align: "center",
          valign: "center"
        });
      } catch {
        doc.fillColor("#a1573b").fontSize(10).text("图片暂时无法载入。", imageInnerX, imageY + 48, { width: imageInnerWidth });
      }
      doc.y = imageY + imageCardHeight + 22;
    }
  }

  return collectPdfBuffer(doc);
}

async function createParentFeedbackImage(input: {
  task: TaskRow;
  student: StudentRow | undefined;
  correctionImage: TaskFileRow;
}) {
  const id = createId("e");
  const studentName = sanitizeExportFileName(input.student?.name, "学生");
  const taskTitle = sanitizeExportFileName(input.task.title.slice(0, 24), "任务");
  const exportedName = `${studentName}-${taskTitle}-家长反馈长图-${id}.svg`;
  const exportedUrl = `/exports/${encodeURIComponent(exportedName)}`;
  const comment = input.task.teacherComment || input.task.assistantNote || "老师暂未留下文字评语，请以批改图片为准。";
  const commentLines = wrapSvgText(comment);
  const imageDataUri = await imageDataUriFromTaskFile(input.correctionImage);
  const height = Math.max(1120, 900 + commentLines.length * 34);
  const commentTspans = commentLines
    .map((line, index) => `<tspan x="86" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff8e8"/>
      <stop offset="52%" stop-color="#edf6eb"/>
      <stop offset="100%" stop-color="#eadcc5"/>
    </linearGradient>
    <linearGradient id="green" x1="0" x2="1">
      <stop offset="0%" stop-color="#0f765e"/>
      <stop offset="100%" stop-color="#073f34"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#073f34" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="900" height="${height}" rx="46" fill="url(#bg)"/>
  <circle cx="120" cy="84" r="190" fill="#0f765e" opacity="0.12"/>
  <circle cx="760" cy="40" r="210" fill="#d69a2d" opacity="0.14"/>
  <text x="72" y="108" fill="#073f34" font-family="Arial, sans-serif" font-size="56" font-weight="900" letter-spacing="-3">QULEDA</text>
  <text x="74" y="145" fill="#0f765e" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="4">PARENT FEEDBACK</text>
  <rect x="54" y="190" width="792" height="190" rx="32" fill="#fffaf0" opacity="0.9" filter="url(#shadow)"/>
  <text x="86" y="248" fill="#17211d" font-family="Arial, sans-serif" font-size="30" font-weight="800">${escapeXml(input.student?.name ?? "学生")}</text>
  <text x="86" y="294" fill="#69736c" font-family="Arial, sans-serif" font-size="22">${escapeXml(input.task.title)}</text>
  <text x="86" y="334" fill="#0f765e" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(input.task.score ?? "暂无分数")}</text>
  <rect x="54" y="420" width="792" height="430" rx="32" fill="#fffaf0" opacity="0.95" filter="url(#shadow)"/>
  <text x="86" y="472" fill="#073f34" font-family="Arial, sans-serif" font-size="26" font-weight="900">批改后的作业</text>
  <image href="${imageDataUri}" x="86" y="505" width="728" height="300" preserveAspectRatio="xMidYMid meet"/>
  <rect x="54" y="890" width="792" height="${height - 944}" rx="32" fill="#fffaf0" opacity="0.94" filter="url(#shadow)"/>
  <text x="86" y="944" fill="#073f34" font-family="Arial, sans-serif" font-size="26" font-weight="900">老师评语</text>
  <text x="86" y="1000" fill="#17211d" font-family="Arial, sans-serif" font-size="24" font-weight="600">${commentTspans}</text>
  <text x="86" y="${height - 58}" fill="#69736c" font-family="Arial, sans-serif" font-size="16">Generated by QULEDA Teaching Operations</text>
</svg>`;

  await mkdir(exportDirectory, { recursive: true });
  await writeFile(join(exportDirectory, exportedName), svg, "utf8");
  return { id, exportedName, exportedUrl };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "qleda-api", database: databaseType() });
});

app.get("/api/dashboard/version", async (_req, res, next) => {
  try {
    res.json({ version: await readDashboardVersion() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/personal-tasks", async (req, res, next) => {
  try {
    const { month, scope } = personalTaskMonthQuerySchema.parse(req.query);
    const where = scope === "priority" ? "isPriority = 1" : "isPriority = 0 AND date LIKE ?";
    const params = scope === "priority" ? [personalWorkspaceOwnerId] : [personalWorkspaceOwnerId, `${month}%`];
    const tasks = await all<PersonalTaskRow>(
      `SELECT id, ownerId, title, description, date, priority, category, isPriority, completed, createdAt, updatedAt
       FROM personal_tasks
       WHERE ownerId = ? AND ${where}
       ORDER BY date ASC, completed ASC, createdAt ASC`,
      params
    );
    res.json(tasks.map(mapPersonalTask));
  } catch (error) {
    next(error);
  }
});

app.post("/api/personal-tasks", async (req, res, next) => {
  try {
    const payload = personalTaskCreateSchema.parse(req.body);
    const timestamp = now();
    const id = createId("pt");
    await run(
      `INSERT INTO personal_tasks (id, ownerId, title, description, date, priority, category, isPriority, completed, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, personalWorkspaceOwnerId, payload.title, payload.description, payload.date, payload.priority, payload.category, payload.isPriority ? 1 : 0, timestamp, timestamp]
    );
    await touchDashboardVersion(timestamp);
    const saved = await get<PersonalTaskRow>(
      "SELECT id, ownerId, title, description, date, priority, category, isPriority, completed, createdAt, updatedAt FROM personal_tasks WHERE id = ? AND ownerId = ?",
      [id, personalWorkspaceOwnerId]
    );
    res.status(201).json(saved ? mapPersonalTask(saved) : null);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/personal-tasks/:taskId", async (req, res, next) => {
  try {
    const payload = personalTaskUpdateSchema.parse(req.body);
    const taskId = String(req.params.taskId);
    const existing = await get<PersonalTaskRow>(
      "SELECT id, ownerId, title, description, date, priority, category, isPriority, completed, createdAt, updatedAt FROM personal_tasks WHERE id = ? AND ownerId = ?",
      [taskId, personalWorkspaceOwnerId]
    );
    if (!existing) {
      res.status(404).json({ message: "Personal task not found" });
      return;
    }
    if (!existing.isPriority && payload.date === "") {
      res.status(400).json({ message: "Calendar tasks require a date" });
      return;
    }

    const timestamp = now();
    await run(
      `UPDATE personal_tasks
       SET title = ?, description = ?, date = ?, priority = ?, category = ?, isPriority = ?, completed = ?, updatedAt = ?
       WHERE id = ? AND ownerId = ?`,
      [
        payload.title ?? existing.title,
        payload.description ?? existing.description,
        payload.date ?? existing.date,
        payload.priority ?? existing.priority,
        payload.category ?? existing.category,
        payload.isPriority === undefined ? Number(existing.isPriority) : payload.isPriority ? 1 : 0,
        payload.completed === undefined ? Number(existing.completed) : payload.completed ? 1 : 0,
        timestamp,
        taskId,
        personalWorkspaceOwnerId
      ]
    );
    await touchDashboardVersion(timestamp);
    const saved = await get<PersonalTaskRow>(
      "SELECT id, ownerId, title, description, date, priority, category, isPriority, completed, createdAt, updatedAt FROM personal_tasks WHERE id = ? AND ownerId = ?",
      [taskId, personalWorkspaceOwnerId]
    );
    res.json(saved ? mapPersonalTask(saved) : null);
  } catch (error) {
    next(error);
  }
});

app.get("/api/personal-test-subtasks", async (req, res, next) => {
  try {
    const { testTaskId } = personalTestSubtaskQuerySchema.parse(req.query);
    if (!await getOwnedTestTask(testTaskId)) {
      res.status(404).json({ message: "Test task not found" });
      return;
    }
    const subtasks = await all<PersonalTestSubtaskRow>(
      `SELECT id, ownerId, testTaskId, title, completed, createdAt, updatedAt
       FROM personal_test_subtasks
       WHERE ownerId = ? AND testTaskId = ?
       ORDER BY completed ASC, createdAt ASC`,
      [personalWorkspaceOwnerId, testTaskId]
    );
    res.json(subtasks.map(mapPersonalTestSubtask));
  } catch (error) {
    next(error);
  }
});

app.post("/api/personal-test-subtasks", async (req, res, next) => {
  try {
    const payload = personalTestSubtaskCreateSchema.parse(req.body);
    if (!await getOwnedTestTask(payload.testTaskId)) {
      res.status(404).json({ message: "Test task not found" });
      return;
    }
    const timestamp = now();
    const id = createId("pts");
    await run(
      `INSERT INTO personal_test_subtasks (id, ownerId, testTaskId, title, completed, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [id, personalWorkspaceOwnerId, payload.testTaskId, payload.title, timestamp, timestamp]
    );
    await touchDashboardVersion(timestamp);
    const saved = await get<PersonalTestSubtaskRow>(
      "SELECT id, ownerId, testTaskId, title, completed, createdAt, updatedAt FROM personal_test_subtasks WHERE id = ? AND ownerId = ?",
      [id, personalWorkspaceOwnerId]
    );
    res.status(201).json(saved ? mapPersonalTestSubtask(saved) : null);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/personal-test-subtasks/:subtaskId", async (req, res, next) => {
  try {
    const payload = personalTestSubtaskUpdateSchema.parse(req.body);
    const subtaskId = String(req.params.subtaskId);
    const existing = await get<PersonalTestSubtaskRow>(
      "SELECT id, ownerId, testTaskId, title, completed, createdAt, updatedAt FROM personal_test_subtasks WHERE id = ? AND ownerId = ?",
      [subtaskId, personalWorkspaceOwnerId]
    );
    if (!existing || !await getOwnedTestTask(existing.testTaskId)) {
      res.status(404).json({ message: "Test subtask not found" });
      return;
    }
    const timestamp = now();
    await run(
      `UPDATE personal_test_subtasks
       SET title = ?, completed = ?, updatedAt = ?
       WHERE id = ? AND ownerId = ?`,
      [payload.title ?? existing.title, payload.completed === undefined ? Number(existing.completed) : payload.completed ? 1 : 0, timestamp, subtaskId, personalWorkspaceOwnerId]
    );
    await touchDashboardVersion(timestamp);
    const saved = await get<PersonalTestSubtaskRow>(
      "SELECT id, ownerId, testTaskId, title, completed, createdAt, updatedAt FROM personal_test_subtasks WHERE id = ? AND ownerId = ?",
      [subtaskId, personalWorkspaceOwnerId]
    );
    res.json(saved ? mapPersonalTestSubtask(saved) : null);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/personal-test-subtasks/:subtaskId", async (req, res, next) => {
  try {
    const subtaskId = String(req.params.subtaskId);
    const existing = await get<PersonalTestSubtaskRow>(
      "SELECT id, ownerId, testTaskId, title, completed, createdAt, updatedAt FROM personal_test_subtasks WHERE id = ? AND ownerId = ?",
      [subtaskId, personalWorkspaceOwnerId]
    );
    if (!existing || !await getOwnedTestTask(existing.testTaskId)) {
      res.status(404).json({ message: "Test subtask not found" });
      return;
    }
    await run("DELETE FROM personal_test_subtasks WHERE id = ? AND ownerId = ?", [subtaskId, personalWorkspaceOwnerId]);
    await touchDashboardVersion(now());
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/personal-tasks/:taskId", async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId);
    const existing = await get<Pick<PersonalTaskRow, "id">>(
      "SELECT id FROM personal_tasks WHERE id = ? AND ownerId = ?",
      [taskId, personalWorkspaceOwnerId]
    );
    if (!existing) {
      res.status(404).json({ message: "Personal task not found" });
      return;
    }

    const timestamp = now();
    await run("DELETE FROM personal_tasks WHERE id = ? AND ownerId = ?", [taskId, personalWorkspaceOwnerId]);
    await touchDashboardVersion(timestamp);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    await cleanupOldCompletedTasks();
    await markTasksWithTaskEvidenceCompleted();
    const todayDateKey = getShanghaiDateKey();
    const [users, students, tasks, parentExports, printJobs, auditLogs, chatMessages, sharedFiles, dailyCheckEntries, dailyCheckTaskNotes, version] = await Promise.all([
      all("SELECT * FROM users WHERE role <> 'archived_teacher' ORDER BY createdAt ASC"),
      all<StudentRow>(
        `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
                students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
         FROM students
         INNER JOIN users ON users.id = students.teacherId AND users.role = 'teacher'
         ORDER BY students.createdAt ASC`
      ),
      all<TaskRow>("SELECT * FROM tasks ORDER BY createdAt ASC"),
      all("SELECT * FROM parent_exports ORDER BY createdAt DESC"),
      all<PrintJobRow>("SELECT * FROM print_jobs ORDER BY createdAt DESC"),
      all<AuditLogRow>("SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT 80"),
      all<ChatMessageRow>("SELECT * FROM chat_messages ORDER BY createdAt DESC LIMIT 60"),
      all<SharedFileRow>(
        "SELECT id, uploaderId, uploaderRole, uploaderName, note, fileName, fileType, fileUrl, fileSize, createdAt FROM shared_files ORDER BY createdAt DESC LIMIT 40"
      ),
      all<DailyCheckEntryRow>("SELECT * FROM daily_check_entries WHERE dateKey = ? ORDER BY updatedAt DESC", [todayDateKey]),
      all<DailyCheckTaskNoteRow>("SELECT * FROM daily_check_task_notes WHERE dateKey = ? ORDER BY updatedAt DESC", [todayDateKey]),
      readDashboardVersion()
    ]);
    const visibleStudentIds = new Set(students.map((student) => student.id));
    const visibleTasks = tasks.filter((task) => visibleStudentIds.has(task.studentId));
    const relevantTaskIds = getDashboardRelevantTaskIds(visibleTasks, oldCompletedTaskRetentionDays);
    const taskFiles =
      relevantTaskIds.length > 0
        ? await all<TaskFileRow>(
            `SELECT id, taskId, uploaderId, uploaderRole, name, fileType, url, fileSize, createdAt
             FROM task_files
             WHERE taskId IN (${relevantTaskIds.map(() => "?").join(", ")})
             ORDER BY createdAt ASC`,
            relevantTaskIds
          )
        : [];
    const correctedTaskRows = await all<{ taskId: string }>(
      `SELECT DISTINCT taskId
       FROM task_files
       WHERE uploaderRole = 'assistant' AND fileType LIKE 'image/%'`
    );
    const tasksWithCorrection = new Set(correctedTaskRows.map((row) => row.taskId));
    const pendingReviewTasks = visibleTasks.filter((task) => task.status !== "completed" && !tasksWithCorrection.has(task.id));

    res.json({
      users,
      students,
      tasks: sortTasksForTeacher(visibleTasks.map(mapTask)),
      taskFiles: taskFiles.map(mapTaskFile),
      taskFilesLoadedTaskIds: relevantTaskIds,
      tasksWithCorrection: Array.from(tasksWithCorrection),
      parentExports,
      printJobs: printJobs.map(mapPrintJob),
      auditLogs,
      chatMessages: chatMessages.reverse(),
      sharedFiles: sharedFiles.map(mapSharedFile),
      dailyCheckEntries: dailyCheckEntries.map(mapDailyCheckEntry),
      dailyCheckTaskNotes,
      version,
      summary: {
        studentCount: students.length,
        activeTasks: countTasksWithinDays(visibleTasks, oldCompletedTaskRetentionDays),
        pendingReview: pendingReviewTasks.length,
        pendingPrintJobs: printJobs.filter((job) => job.status === "pending").length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/daily-check-entries", async (req, res, next) => {
  try {
    const payload = dailyCheckEntrySchema.parse(req.body);
    const timestamp = now();
    const checkedValue = payload.checked || payload.note.trim() ? 1 : 0;
    let id = createId("dce");

    if (databaseType() === "mysql") {
      await run(
        `INSERT INTO daily_check_entries (id, dateKey, teacherId, className, studentId, columnKey, checked, note, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE checked = VALUES(checked), note = VALUES(note), updatedAt = VALUES(updatedAt)`,
        [id, payload.dateKey, payload.teacherId, payload.className, payload.studentId, payload.columnKey, checkedValue, payload.note, timestamp, timestamp]
      );
    } else {
      await run(
        `INSERT INTO daily_check_entries (id, dateKey, teacherId, className, studentId, columnKey, checked, note, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dateKey, teacherId, className, studentId, columnKey)
         DO UPDATE SET checked = excluded.checked, note = excluded.note, updatedAt = excluded.updatedAt`,
        [id, payload.dateKey, payload.teacherId, payload.className, payload.studentId, payload.columnKey, checkedValue, payload.note, timestamp, timestamp]
      );
    }

    const saved = await get<DailyCheckEntryRow>(
      `SELECT * FROM daily_check_entries
       WHERE dateKey = ? AND teacherId = ? AND className = ? AND studentId = ? AND columnKey = ?`,
      [payload.dateKey, payload.teacherId, payload.className, payload.studentId, payload.columnKey]
    );
    if (saved) id = saved.id;
    await syncTaskFromDailyCheckEntry(payload, timestamp);
    await touchDashboardVersion(timestamp);
    res.json(saved ? mapDailyCheckEntry(saved) : { id, ...payload, createdAt: timestamp, updatedAt: timestamp });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/daily-check-task-notes", async (req, res, next) => {
  try {
    const payload = dailyCheckTaskNoteSchema.parse(req.body);
    const timestamp = now();
    let id = createId("dctn");

    if (databaseType() === "mysql") {
      await run(
        `INSERT INTO daily_check_task_notes (id, dateKey, teacherId, className, columnKey, note, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE note = VALUES(note), updatedAt = VALUES(updatedAt)`,
        [id, payload.dateKey, payload.teacherId, payload.className, payload.columnKey, payload.note, timestamp, timestamp]
      );
    } else {
      await run(
        `INSERT INTO daily_check_task_notes (id, dateKey, teacherId, className, columnKey, note, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dateKey, teacherId, className, columnKey)
         DO UPDATE SET note = excluded.note, updatedAt = excluded.updatedAt`,
        [id, payload.dateKey, payload.teacherId, payload.className, payload.columnKey, payload.note, timestamp, timestamp]
      );
    }

    const saved = await get<DailyCheckTaskNoteRow>(
      `SELECT * FROM daily_check_task_notes
       WHERE dateKey = ? AND teacherId = ? AND className = ? AND columnKey = ?`,
      [payload.dateKey, payload.teacherId, payload.className, payload.columnKey]
    );
    if (saved) id = saved.id;
    await syncDailyCheckColumnFromMatchingTasks(payload, timestamp);
    await touchDashboardVersion(timestamp);
    res.json(saved ?? { id, ...payload, createdAt: timestamp, updatedAt: timestamp });
  } catch (error) {
    next(error);
  }
});

app.post("/api/shared-files", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "Shared file is required" });
      return;
    }

    const payload = createSharedFileSchema.parse(req.body);
    const id = createId("sf");
    const timestamp = now();
    const preparedFile = await prepareStoredUpload(req.file);
    const originalName = normalizeUploadedFileName(req.file.originalname, "shared-file");
    const safeName = basename(originalName).replace(/[^\w.-]+/g, "_");
    const storedName = `${id}-${safeName}`;
    const fileUrl = `/uploads/${storedName}`;

    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, storedName), preparedFile.storedBytes);

    await run(
      `INSERT INTO shared_files (id, uploaderId, uploaderRole, uploaderName, note, fileName, fileType, fileUrl, fileData, fileSize, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.uploaderId,
        payload.uploaderRole,
        payload.uploaderName,
        payload.note,
        originalName,
        preparedFile.fileType,
        fileUrl,
        preparedFile.storedBytes.toString("base64"),
        preparedFile.storedBytes.length,
        timestamp
      ]
    );

    await writeAuditLog({
      actor: payload.uploaderId,
      action: "shared_file_uploaded",
      entityType: "shared_file",
      entityId: id,
      detail: `${payload.uploaderName} uploaded ${originalName} to shared files`
    });

    const sharedFile = await get<SharedFileRow>(
      "SELECT id, uploaderId, uploaderRole, uploaderName, note, fileName, fileType, fileUrl, fileSize, createdAt FROM shared_files WHERE id = ?",
      [id]
    );
    res.status(201).json(sharedFile ? mapSharedFile(sharedFile) : sharedFile);
  } catch (error) {
    next(error);
  }
});

app.post("/api/shared-files/:sharedFileId/print-jobs", async (req, res, next) => {
  try {
    const sharedFileId = String(req.params.sharedFileId);
    const payload = createPrintJobSchema.parse(req.body);
    const sharedFile = await get<SharedFileRow>("SELECT * FROM shared_files WHERE id = ?", [sharedFileId]);
    if (!sharedFile) {
      res.status(404).json({ message: "Shared file not found" });
      return;
    }

    const bytes = await readSharedFileBytes(sharedFile);
    if (!bytes) {
      res.status(404).json({ message: "Stored shared file content is no longer available" });
      return;
    }

    const id = createId("p");
    const timestamp = now();
    const originalName = normalizeUploadedFileName(sharedFile.fileName, "shared-file");
    const safeName = basename(originalName).replace(/[^\w.-]+/g, "_");
    const storedName = `${id}-${safeName}`;
    const fileUrl = `/uploads/${storedName}`;

    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, storedName), bytes);

    await run(
      `INSERT INTO print_jobs (id, requester, copies, note, fileName, fileType, fileUrl, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        payload.requester,
        payload.copies,
        payload.note,
        originalName,
        sharedFile.fileType,
        fileUrl,
        timestamp,
        timestamp
      ]
    );

    await writeAuditLog({
      actor: sharedFile.uploaderId,
      action: "shared_file_print_job_created",
      entityType: "print_job",
      entityId: id,
      detail: `Added shared file ${originalName} to print queue (${payload.copies} copies, ${payload.requester})`
    });

    res.status(201).json(await get<PrintJobRow>("SELECT * FROM print_jobs WHERE id = ?", [id]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/shared-files/:sharedFileId", async (req, res, next) => {
  try {
    const sharedFileId = String(req.params.sharedFileId);
    const existing = await get<SharedFileRow>("SELECT * FROM shared_files WHERE id = ?", [sharedFileId]);
    if (!existing) {
      res.status(404).json({ message: "Shared file not found" });
      return;
    }

    if (existing.fileUrl.startsWith("/uploads/")) {
      const storedName = basename(existing.fileUrl.replace("/uploads/", ""));
      await unlink(join(uploadDirectory, storedName)).catch(() => undefined);
    }

    await run("DELETE FROM shared_files WHERE id = ?", [sharedFileId]);
    await writeAuditLog({
      actor: existing.uploaderId,
      action: "shared_file_deleted",
      entityType: "shared_file",
      entityId: sharedFileId,
      detail: `Deleted shared file ${normalizeUploadedFileName(existing.fileName)}`
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat-messages", async (req, res, next) => {
  try {
    const payload = createChatMessageSchema.parse(req.body);
    const id = createId("msg");
    const timestamp = now();

    await run(
      "INSERT INTO chat_messages (id, authorRole, authorName, message, createdAt) VALUES (?, ?, ?, ?, ?)",
      [id, payload.authorRole, payload.authorName, payload.message, timestamp]
    );

    await writeAuditLog({
      actor: payload.authorRole === "teacher" ? "u-teacher-lin" : "u-assistant-chen",
      action: "create",
      entityType: "chat_message",
      entityId: id,
      detail: `${payload.authorName} 发送了一条沟通消息。`
    });

    const message = await get<ChatMessageRow>("SELECT * FROM chat_messages WHERE id = ?", [id]);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/chat-messages/:messageId", async (req, res, next) => {
  try {
    const message = await get<ChatMessageRow>("SELECT * FROM chat_messages WHERE id = ?", [req.params.messageId]);
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    await run("DELETE FROM chat_messages WHERE id = ?", [req.params.messageId]);
    await writeAuditLog({
      actor: message.authorRole === "teacher" ? "u-teacher-lin" : "u-assistant-chen",
      action: "delete",
      entityType: "chat_message",
      entityId: message.id,
      detail: `${message.authorName} 删除了一条沟通消息。`
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/students", async (_req, res, next) => {
  try {
    res.json(
      await all<StudentRow>(
        `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
                students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
         FROM students
         INNER JOIN users ON users.id = students.teacherId AND users.role = 'teacher'
         ORDER BY students.createdAt ASC`
      )
    );
  } catch (error) {
    next(error);
  }
});

async function deleteStudentWithTasks(studentId: string) {
  const tasks = await all<TaskRow>("SELECT * FROM tasks WHERE studentId = ?", [studentId]);
  for (const task of tasks) {
    await run("DELETE FROM task_files WHERE taskId = ?", [task.id]);
    await run("DELETE FROM parent_exports WHERE taskId = ?", [task.id]);
    await run("DELETE FROM tasks WHERE id = ?", [task.id]);
  }
  await run("DELETE FROM students WHERE id = ?", [studentId]);
}

app.post("/api/students", async (req, res, next) => {
  try {
    const payload = createStudentSchema.parse(req.body);
    const id = createId("s");
    const timestamp = now();
    const teacher = await ensureTeacherUser(payload.teacherName);

    await run(
      `INSERT INTO students (id, name, grade, targetScore, currentLevel, \`group\`, teacherId, assistantId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.name,
        payload.grade,
        payload.targetScore,
        payload.currentLevel,
        payload.group,
        teacher.id,
        payload.assistantId,
        timestamp,
        timestamp
      ]
    );

    const student = await get<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.id = ?`,
      [id]
    );
    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/students/:studentId", async (req, res, next) => {
  try {
    const studentId = String(req.params.studentId);
    const payload = updateStudentSchema.parse(req.body);
    const existing = await get<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.id = ?`,
      [studentId]
    );
    if (!existing) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    const teacher = payload.teacherName ? await ensureTeacherUser(payload.teacherName) : { id: existing.teacherId };

    await run(
      "UPDATE students SET name = ?, grade = ?, targetScore = ?, currentLevel = ?, `group` = ?, teacherId = ?, updatedAt = ? WHERE id = ?",
      [
        payload.name ?? existing.name,
        payload.grade ?? existing.grade,
        payload.targetScore ?? existing.targetScore,
        payload.currentLevel ?? existing.currentLevel,
        payload.group ?? existing.group,
        teacher.id,
        now(),
        studentId
      ]
    );

    if (payload.group && payload.group !== existing.group) {
      await writeAuditLog({
        action: "student_group_updated",
        entityType: "student",
        entityId: studentId,
        detail: `${existing.name} moved from ${existing.group || "No group"} to ${payload.group}`
      });
    }

    const student = await get<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.id = ?`,
      [studentId]
    );
    res.json(student);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/students/:studentId", async (req, res, next) => {
  try {
    const studentId = String(req.params.studentId);
    const existing = await get<StudentRow>(
      "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?",
      [studentId]
    );
    if (!existing) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    await deleteStudentWithTasks(studentId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.delete("/api/student-groups/:groupName", async (req, res, next) => {
  try {
    const groupName = String(req.params.groupName);
    const students = await all<StudentRow>(
      "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE `group` = ?",
      [groupName]
    );
    if (!students.length) {
      res.status(404).json({ message: "Student group not found" });
      return;
    }

    for (const student of students) {
      await deleteStudentWithTasks(student.id);
    }

    await writeAuditLog({
      action: "student_group_deleted",
      entityType: "student_group",
      entityId: groupName,
      detail: `Deleted ${students.length} students from group ${groupName}`
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks/:taskId/files", async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId);
    const task = await get<TaskRow>("SELECT id FROM tasks WHERE id = ?", [taskId]);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    const files = await all<TaskFileRow>(
      "SELECT id, taskId, uploaderId, uploaderRole, name, fileType, url, fileSize, createdAt FROM task_files WHERE taskId = ? ORDER BY createdAt ASC",
      [taskId]
    );
    res.json(files.map(mapTaskFile));
  } catch (error) {
    next(error);
  }
});

app.post("/api/teachers", async (req, res, next) => {
  try {
    const payload = createTeacherSchema.parse(req.body);
    const existing = await findTeacherUserByName(payload.name);
    const teacher = existing ?? (await ensureTeacherUser(payload.name));

    if (!existing) {
      await writeAuditLog({
        actor: teacher.id,
        action: "teacher_created",
        entityType: "teacher",
        entityId: teacher.id,
        detail: `Teacher ${teacher.name} created`
      });
    }

    res.status(existing ? 200 : 201).json(teacher);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/teachers/:teacherId", async (req, res, next) => {
  try {
    const teacherId = String(req.params.teacherId);
    const payload = updateTeacherSchema.parse(req.body);
    const existing = await get<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", [teacherId]);
    if (!existing) {
      res.status(404).json({ message: "Teacher not found" });
      return;
    }

    await run("UPDATE users SET name = ? WHERE id = ?", [payload.name, teacherId]);
    await writeAuditLog({
      actor: teacherId,
      action: "teacher_renamed",
      entityType: "teacher",
      entityId: teacherId,
      detail: `Teacher name changed from ${existing.name} to ${payload.name}`
    });

    res.json({ id: teacherId, name: payload.name });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/teachers/:teacherId", async (req, res, next) => {
  try {
    const teacherId = String(req.params.teacherId);
    const existing = await get<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", [teacherId]);
    if (!existing) {
      res.status(404).json({ message: "Teacher not found" });
      return;
    }

    const students = await all<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.teacherId = ?`,
      [teacherId]
    );

    await run("UPDATE users SET role = 'archived_teacher' WHERE id = ? AND role = 'teacher'", [teacherId]);
    await touchDashboardVersion();
    await writeAuditLog({
      actor: teacherId,
      action: "teacher_archived",
      entityType: "teacher",
      entityId: teacherId,
      detail: `Archived teacher ${existing.name} with ${students.length} students; student data retained`
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/teachers/:teacherId/groups/move", async (req, res, next) => {
  try {
    const teacherId = String(req.params.teacherId);
    const payload = moveTeacherGroupSchema.parse(req.body);
    const nextGroupName = payload.nextGroupName?.trim() || payload.groupName;

    const [teacher, nextTeacher, students] = await Promise.all([
      get<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", [teacherId]),
      get<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'", [payload.nextTeacherId]),
      all<StudentRow>(
        `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
                students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
         FROM students
         LEFT JOIN users ON users.id = students.teacherId
         WHERE students.teacherId = ? AND students.\`group\` = ?`,
        [teacherId, payload.groupName]
      )
    ]);

    if (!teacher) {
      res.status(404).json({ message: "Teacher not found" });
      return;
    }
    if (!nextTeacher) {
      res.status(404).json({ message: "Target teacher not found" });
      return;
    }
    if (!students.length) {
      res.status(404).json({ message: "Teacher group not found" });
      return;
    }

    await run("UPDATE students SET teacherId = ?, `group` = ?, updatedAt = ? WHERE teacherId = ? AND `group` = ?", [
      payload.nextTeacherId,
      nextGroupName,
      now(),
      teacherId,
      payload.groupName
    ]);
    await writeAuditLog({
      actor: teacherId,
      action: "teacher_group_moved",
      entityType: "student_group",
      entityId: `${teacherId}:${payload.groupName}`,
      detail: `Moved group ${payload.groupName} from ${teacher.name} to ${nextTeacher.name} as ${nextGroupName}`
    });

    res.json({ updatedCount: students.length, teacherId: payload.nextTeacherId, groupName: nextGroupName });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/teachers/:teacherId/groups/rename", async (req, res, next) => {
  try {
    const teacherId = String(req.params.teacherId);
    const payload = renameTeacherGroupSchema.parse(req.body);
    const students = await all<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.teacherId = ? AND students.\`group\` = ?`,
      [teacherId, payload.currentGroupName]
    );
    if (!students.length) {
      res.status(404).json({ message: "Teacher group not found" });
      return;
    }

    await run("UPDATE students SET `group` = ?, updatedAt = ? WHERE teacherId = ? AND `group` = ?", [
      payload.nextGroupName,
      now(),
      teacherId,
      payload.currentGroupName
    ]);
    await writeAuditLog({
      actor: teacherId,
      action: "teacher_group_renamed",
      entityType: "student_group",
      entityId: `${teacherId}:${payload.currentGroupName}`,
      detail: `Group ${payload.currentGroupName} renamed to ${payload.nextGroupName}`
    });

    res.json({ updatedCount: students.length });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/teachers/:teacherId/groups/:groupName", async (req, res, next) => {
  try {
    const teacherId = String(req.params.teacherId);
    const groupName = String(req.params.groupName);
    const students = await all<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.teacherId = ? AND students.\`group\` = ?`,
      [teacherId, groupName]
    );
    if (!students.length) {
      res.status(404).json({ message: "Teacher group not found" });
      return;
    }

    for (const student of students) {
      await deleteStudentWithTasks(student.id);
    }

    await writeAuditLog({
      actor: teacherId,
      action: "teacher_group_deleted",
      entityType: "student_group",
      entityId: `${teacherId}:${groupName}`,
      detail: `Deleted ${students.length} students from group ${groupName}`
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", async (req, res, next) => {
  try {
    const studentId = String(req.query.studentId ?? "");
    const tasks = studentId
      ? await all<TaskRow>("SELECT * FROM tasks WHERE studentId = ? ORDER BY createdAt ASC", [studentId])
      : await all<TaskRow>("SELECT * FROM tasks ORDER BY createdAt ASC");
    res.json(sortTasksForTeacher(tasks.map(mapTask)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", async (req, res, next) => {
  try {
    const payload = createTaskSchema.parse(req.body);
    const id = createId("t");
    const timestamp = now();

    await run(
      `INSERT INTO tasks
        (id, studentId, title, type, priority, dueDate, description, status, pinned, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?)`,
      [
        id,
        payload.studentId,
        payload.title,
        payload.type ?? "reading",
        payload.priority ?? "medium",
        payload.dueDate ?? new Date().toISOString().slice(0, 10),
        payload.description,
        payload.pinned ? 1 : 0,
        timestamp,
        timestamp
      ]
    );

    const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
    await syncDailyCheckEntryFromTask(id, timestamp);
    res.status(201).json(mapTask(task));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:taskId", async (req, res, next) => {
  try {
    const payload = updateTaskSchema.parse(req.body);
    const taskId = String(req.params.taskId);
    const existing = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (!existing) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    const nextTeacherComment = payload.teacherComment ?? existing.teacherComment;
    const hasTeacherComment = Boolean((nextTeacherComment ?? "").trim());
    const nextStatus = payload.status ?? (hasTeacherComment ? "completed" : existing.status);

    await run(
      `UPDATE tasks
       SET title = ?, status = ?, priority = ?, dueDate = ?, pinned = ?, teacherComment = ?, assistantNote = ?, score = ?, updatedAt = ?
       WHERE id = ?`,
      [
        payload.title ?? existing.title,
        nextStatus,
        payload.priority ?? existing.priority,
        payload.dueDate ?? existing.dueDate,
        payload.pinned === undefined ? existing.pinned : payload.pinned ? 1 : 0,
        nextTeacherComment,
        payload.assistantNote ?? existing.assistantNote,
        payload.score ?? existing.score,
        now(),
        taskId
      ]
    );
    if (payload.status && payload.status !== existing.status) {
      await writeAuditLog({
        action: "task_status_updated",
        entityType: "task",
        entityId: taskId,
        detail: `Task status changed from ${existing.status} to ${payload.status}`
      });
    }
    if (payload.teacherComment !== undefined && payload.teacherComment !== (existing.teacherComment ?? "")) {
      await writeAuditLog({
        action: "teacher_note_updated",
        entityType: "task",
        entityId: taskId,
        detail: `Teacher note updated for task ${existing.title}`
      });
    }

    await syncDailyCheckEntryFromTask(taskId);
    const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [taskId]);
    res.json(mapTask(task));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:taskId", async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId);
    const existing = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (!existing) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    await run("DELETE FROM task_files WHERE taskId = ?", [taskId]);
    await run("DELETE FROM parent_exports WHERE taskId = ?", [taskId]);
    await run("DELETE FROM tasks WHERE id = ?", [taskId]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/audit-logs/:logId/undo", async (req, res, next) => {
  try {
    const log = await get<AuditLogRow>("SELECT * FROM audit_logs WHERE id = ?", [String(req.params.logId)]);
    if (!log) {
      res.status(404).json({ message: "Audit log not found" });
      return;
    }

    if (log.action === "teacher_created") {
      const students = await all<StudentRow>("SELECT * FROM students WHERE teacherId = ?", [log.entityId]);
      if (students.length) {
        res.status(409).json({ message: "这个分组已经有学生，不能直接撤回创建。" });
        return;
      }
      await run("DELETE FROM users WHERE id = ? AND role = 'teacher'", [log.entityId]);
      await writeAuditLog({
        actor: log.actor,
        action: "undo_teacher_created",
        entityType: "teacher",
        entityId: log.entityId,
        detail: `Undid teacher creation from log ${log.id}`
      });
      res.json({ message: "已撤回分组创建。" });
      return;
    }

    if (log.action === "teacher_renamed") {
      const match = /^Teacher name changed from (.+) to (.+)$/.exec(log.detail);
      if (match) {
        await run("UPDATE users SET name = ? WHERE id = ? AND role = 'teacher'", [match[1], log.entityId]);
        await writeAuditLog({
          actor: log.actor,
          action: "undo_teacher_renamed",
          entityType: "teacher",
          entityId: log.entityId,
          detail: `Undid teacher rename from log ${log.id}`
        });
        res.json({ message: "已恢复分组名称。" });
        return;
      }
    }

    if (log.action === "teacher_group_renamed") {
      const match = /^Group (.+) renamed to (.+)$/.exec(log.detail);
      const teacherId = log.entityId.split(":")[0];
      if (match && teacherId) {
        await run("UPDATE students SET `group` = ?, updatedAt = ? WHERE teacherId = ? AND `group` = ?", [
          match[1],
          now(),
          teacherId,
          match[2]
        ]);
        await writeAuditLog({
          actor: log.actor,
          action: "undo_teacher_group_renamed",
          entityType: "student_group",
          entityId: log.entityId,
          detail: `Undid teacher group rename from log ${log.id}`
        });
        res.json({ message: "已恢复班级名称。" });
        return;
      }
    }

    if (log.action === "student_group_updated") {
      const match = /^(.+) moved from (.+) to (.+)$/.exec(log.detail);
      if (match) {
        const previousGroup = match[2] === "No group" ? "" : match[2];
        await run("UPDATE students SET `group` = ?, updatedAt = ? WHERE id = ?", [previousGroup, now(), log.entityId]);
        await writeAuditLog({
          actor: log.actor,
          action: "undo_student_group_updated",
          entityType: "student",
          entityId: log.entityId,
          detail: `Undid student group move from log ${log.id}`
        });
        res.json({ message: "已恢复学生原班级。" });
        return;
      }
    }

    if (log.action === "task_status_updated") {
      const match = /^Task status changed from (.+) to (.+)$/.exec(log.detail);
      if (match) {
        await run("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?", [match[1], now(), log.entityId]);
        await writeAuditLog({
          actor: log.actor,
          action: "undo_task_status_updated",
          entityType: "task",
          entityId: log.entityId,
          detail: `Undid task status update from log ${log.id}`
        });
        res.json({ message: "已恢复任务状态。" });
        return;
      }
    }

    if (log.action === "print_job_status_updated") {
      const match = /^Print job .+ changed from (.+) to (.+)$/.exec(log.detail);
      if (match) {
        await run("UPDATE print_jobs SET status = ?, updatedAt = ? WHERE id = ?", [match[1], now(), log.entityId]);
        await writeAuditLog({
          actor: log.actor,
          action: "undo_print_job_status_updated",
          entityType: "print_job",
          entityId: log.entityId,
          detail: `Undid print job status update from log ${log.id}`
        });
        res.json({ message: "已恢复打印状态。" });
        return;
      }
    }

    res.status(409).json({ message: "这条记录缺少可恢复快照，不能安全撤回。" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:taskId/files", upload.single("file"), async (req, res, next) => {
  try {
    const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [String(req.params.taskId)]);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    const id = createId("f");
    const originalName = normalizeUploadedFileName(req.file?.originalname, "file");
    const safeName = basename(originalName).replace(/[^\w.-]+/g, "_");
    const storedName = `${id}-${safeName}`;
    const fileUrl = `/uploads/${storedName}`;
    const preparedFile = req.file ? await prepareStoredUpload(req.file) : null;

    if (preparedFile) {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(join(uploadDirectory, storedName), preparedFile.storedBytes);
    }

    const fileBuffer = preparedFile?.storedBytes;
    const fileType = preparedFile?.fileType ?? "application/octet-stream";

    await run(
      `INSERT INTO task_files (id, taskId, uploaderId, uploaderRole, name, fileType, url, fileData, fileSize, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.id,
        String(req.body.uploaderId ?? "u-teacher-lin"),
        String(req.body.uploaderRole ?? "teacher"),
        normalizeUploadedFileName(req.file?.originalname, "Untitled attachment"),
        fileType,
        fileUrl,
        fileBuffer ? fileBuffer.toString("base64") : null,
        fileBuffer?.length ?? null,
        now()
      ]
    );
    await writeAuditLog({
      actor: String(req.body.uploaderId ?? "u-teacher-lin"),
      action: "task_file_uploaded",
      entityType: "task",
      entityId: task.id,
      detail: `${String(req.body.uploaderRole ?? "teacher")} uploaded ${originalName}`
    });
    const uploaderRole = String(req.body.uploaderRole ?? "teacher");
    if (
      uploaderRole === "student" ||
      (uploaderRole === "assistant" && fileType.startsWith("image/"))
    ) {
      const timestamp = now();
      await run("UPDATE tasks SET status = 'completed', updatedAt = ? WHERE id = ?", [timestamp, task.id]);
      await syncDailyCheckEntryFromTask(task.id, timestamp);
    }

    const createdFile = await get<TaskFileRow>(
      "SELECT id, taskId, uploaderId, uploaderRole, name, fileType, url, fileSize, createdAt FROM task_files WHERE id = ?",
      [id]
    );
    res.status(201).json(createdFile ? mapTaskFile(createdFile) : createdFile);
  } catch (error) {
    next(error);
  }
});

app.get("/api/task-files/:fileId/content", async (req, res, next) => {
  try {
    const file = await get<TaskFileRow>("SELECT * FROM task_files WHERE id = ?", [String(req.params.fileId)]);
    if (!file) {
      res.status(404).json({ message: "File not found" });
      return;
    }

    const bytes = await readTaskFileBytes(file);
    if (!bytes) {
      res.status(404).json({ message: "Stored file content is no longer available" });
      return;
    }

    res.setHeader("Content-Type", file.fileType || "application/octet-stream");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `${file.fileType.startsWith("image/") || file.fileType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
        normalizeUploadedFileName(file.name, "attachment")
      )}`
    );
    res.end(bytes);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/task-files/:fileId", async (req, res, next) => {
  try {
    const fileId = String(req.params.fileId);
    const existing = await get<TaskFileRow>("SELECT * FROM task_files WHERE id = ?", [fileId]);
    if (!existing) {
      res.status(404).json({ message: "File not found" });
      return;
    }

    if (existing.url.startsWith("/uploads/")) {
      const storedName = basename(existing.url.replace("/uploads/", ""));
      await unlink(join(uploadDirectory, storedName)).catch(() => undefined);
    }

    await run("DELETE FROM task_files WHERE id = ?", [fileId]);
    await run("DELETE FROM parent_exports WHERE taskId = ?", [existing.taskId]);
    await writeAuditLog({
      action: "task_file_deleted",
      entityType: "task",
      entityId: existing.taskId,
      detail: `Deleted file ${normalizeUploadedFileName(existing.name)}`
    });
    if (existing.uploaderRole === "assistant" && existing.fileType.startsWith("image/")) {
      const remainingCorrections = await all<TaskFileRow>(
        "SELECT * FROM task_files WHERE taskId = ? AND uploaderRole = 'assistant' AND fileType LIKE 'image/%'",
        [existing.taskId]
      );
      const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [existing.taskId]);
      if (task && task.status === "completed" && remainingCorrections.length === 0 && !(task.teacherComment ?? "").trim()) {
        const remainingAssignments = await all<TaskFileRow>(
          "SELECT * FROM task_files WHERE taskId = ? AND NOT (uploaderRole = 'assistant' AND fileType LIKE 'image/%')",
          [existing.taskId]
        );
        await run("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?", [
          remainingAssignments.length > 0 ? "submitted" : "not_started",
          now(),
          existing.taskId
        ]);
      }
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/print-jobs", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "Print file is required" });
      return;
    }

    const payload = createPrintJobSchema.parse(req.body);
    const id = createId("p");
    const timestamp = now();
    const originalName = normalizeUploadedFileName(req.file.originalname, "print-file");
    const safeName = basename(originalName).replace(/[^\w.-]+/g, "_");
    const storedName = `${id}-${safeName}`;
    const fileUrl = `/uploads/${storedName}`;

    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, storedName), req.file.buffer);

    await run(
      `INSERT INTO print_jobs (id, requester, copies, note, fileName, fileType, fileUrl, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        payload.requester,
        payload.copies,
        payload.note,
        originalName,
        req.file.mimetype ?? "application/octet-stream",
        fileUrl,
        timestamp,
        timestamp
      ]
    );
    await writeAuditLog({
      action: "print_job_created",
      entityType: "print_job",
      entityId: id,
      detail: `Added ${originalName} to print queue (${payload.copies} copies, ${payload.requester})`
    });

    res.status(201).json(await get<PrintJobRow>("SELECT * FROM print_jobs WHERE id = ?", [id]));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/print-jobs/:jobId", async (req, res, next) => {
  try {
    const jobId = String(req.params.jobId);
    const payload = updatePrintJobSchema.parse(req.body);
    const existing = await get<PrintJobRow>("SELECT * FROM print_jobs WHERE id = ?", [jobId]);
    if (!existing) {
      res.status(404).json({ message: "Print job not found" });
      return;
    }

    await run("UPDATE print_jobs SET status = ?, updatedAt = ? WHERE id = ?", [payload.status, now(), jobId]);
    await writeAuditLog({
      action: "print_job_status_updated",
      entityType: "print_job",
      entityId: jobId,
      detail: `Print job ${normalizeUploadedFileName(existing.fileName)} changed from ${existing.status} to ${payload.status}`
    });

    res.json(await get<PrintJobRow>("SELECT * FROM print_jobs WHERE id = ?", [jobId]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/print-jobs/:jobId", async (req, res, next) => {
  try {
    const jobId = String(req.params.jobId);
    const existing = await get<PrintJobRow>("SELECT * FROM print_jobs WHERE id = ?", [jobId]);
    if (!existing) {
      res.status(404).json({ message: "Print job not found" });
      return;
    }

    if (existing.fileUrl.startsWith("/uploads/")) {
      const storedName = basename(existing.fileUrl.replace("/uploads/", ""));
      await unlink(join(uploadDirectory, storedName)).catch(() => undefined);
    }

    await run("DELETE FROM print_jobs WHERE id = ?", [jobId]);
    await writeAuditLog({
      action: "print_job_deleted",
      entityType: "print_job",
      entityId: jobId,
      detail: `Deleted print job ${normalizeUploadedFileName(existing.fileName)}`
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:taskId/parent-exports", async (req, res, next) => {
  try {
    const task = await get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [String(req.params.taskId)]);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    const [student, files] = await Promise.all([
      get<StudentRow>(
        "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?",
        [task.studentId]
      ),
      all<TaskFileRow>("SELECT * FROM task_files WHERE taskId = ? ORDER BY createdAt DESC", [task.id])
    ]);
    const correctionImage = files.find((file) => file.fileType.startsWith("image/"));

    if (!correctionImage) {
      res.status(404).json({ message: "No correction image found for this task" });
      return;
    }

    const exported = await createParentFeedbackImage({ task, student, correctionImage });

    await run(
      "INSERT INTO parent_exports (id, taskId, title, imageUrl, createdAt) VALUES (?, ?, ?, ?, ?)",
      [exported.id, task.id, exported.exportedName, exported.exportedUrl, now()]
    );

    res.status(201).json(await get("SELECT * FROM parent_exports WHERE id = ?", [exported.id]));
  } catch (error) {
    next(error);
  }
});

app.get("/api/students/:studentId/daily-feedback.pdf", async (req, res, next) => {
  try {
    const studentId = String(req.params.studentId);
    const { date } = dailyFeedbackQuerySchema.parse(req.query);
    const student = await get<StudentRow>(
      `SELECT students.id, students.name, students.grade, students.targetScore, students.currentLevel, students.\`group\` AS \`group\`,
              students.teacherId, users.name AS teacherName, students.assistantId, students.createdAt, students.updatedAt
       FROM students
       LEFT JOIN users ON users.id = students.teacherId
       WHERE students.id = ?`,
      [studentId]
    );

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    const allTasks = await all<TaskRow>("SELECT * FROM tasks WHERE studentId = ? ORDER BY dueDate ASC, createdAt ASC", [studentId]);
    const tasks = allTasks.filter((task) => getDateKey(task.dueDate) === date);
    if (!tasks.length) {
      res.status(404).json({ message: "No tasks found for this student and date" });
      return;
    }

    const placeholders = tasks.map(() => "?").join(",");
    const taskFiles = placeholders
      ? await all<TaskFileRow>(
          `SELECT id, taskId, uploaderId, uploaderRole, name, fileType, url, fileSize, createdAt
           FROM task_files
           WHERE taskId IN (${placeholders})
           ORDER BY createdAt ASC`,
          tasks.map((task) => task.id)
        )
      : [];
    const taskFilesWithImageData = await attachDailyFeedbackImageData(taskFiles);
    const cacheKey = createDailyFeedbackCacheKey({ student, tasks, taskFiles: taskFilesWithImageData, date });
    const cachedPdf = dailyFeedbackPdfCache.get(cacheKey);
    const pdf =
      cachedPdf && cachedPdf.expiresAt > Date.now()
        ? cachedPdf.pdf
        : await createDailyFeedbackPdf({ student, tasks, taskFiles: taskFilesWithImageData, date });
    if (!cachedPdf || cachedPdf.expiresAt <= Date.now()) {
      rememberDailyFeedbackPdf(cacheKey, pdf);
    }
    const fileName = `${sanitizeExportFileName(student.name, "学生")}-${date}-当日全部作业反馈.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: "Invalid request", issues: error.issues });
    return;
  }

  console.error(error);
  res.status(500).json({ message: "Internal server error" });
});

export function startServer() {
  return app.listen(port, host, () => {
    console.log(`QULEDA API is running on http://${host}:${port}`);
  });
}

if (process.env.QLEDA_DISABLE_LISTEN !== "true") {
  startServer();
}

export default app;
