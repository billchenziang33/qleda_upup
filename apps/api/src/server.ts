import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
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

export const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const uploadDirectory = fileURLToPath(new URL("../data/uploads", import.meta.url));
const exportDirectory = fileURLToPath(new URL("../data/exports", import.meta.url));

const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
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
  teacherId: z.string().min(1).default("u-teacher-lin"),
  assistantId: z.string().min(1).default("u-assistant-chen")
});

const updateStudentSchema = z.object({
  name: z.string().trim().min(1).optional(),
  grade: z.string().optional(),
  targetScore: z.number().min(0).max(9).optional(),
  currentLevel: z.string().optional(),
  group: z.string().trim().min(1).optional()
});

const createTaskSchema = z.object({
  studentId: z.string().min(1),
  title: z.string().min(2),
  type: z.enum(["reading", "listening", "writing", "speaking", "vocabulary", "grammar"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().default(""),
  pinned: z.boolean().default(false)
});

const updateTaskSchema = z.object({
  status: z.enum(["not_started", "in_progress", "submitted", "reviewed", "completed"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
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

function now() {
  return new Date().toISOString();
}

async function writeAuditLog(input: {
  actor?: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}) {
  await run(
    "INSERT INTO audit_logs (id, actor, action, entityType, entityId, detail, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      createId("log"),
      input.actor ?? "u-teacher-lin",
      input.action,
      input.entityType,
      input.entityId,
      input.detail,
      now()
    ]
  );
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
    return readFile(join(uploadDirectory, storedName)).catch(() => null);
  }

  return null;
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

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [users, students, tasks, taskFiles, parentExports, printJobs, auditLogs, chatMessages] = await Promise.all([
      all("SELECT * FROM users ORDER BY createdAt ASC"),
      all<StudentRow>(
        "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students ORDER BY createdAt ASC"
      ),
      all<TaskRow>("SELECT * FROM tasks ORDER BY createdAt ASC"),
      all<TaskFileRow>(
        "SELECT id, taskId, uploaderId, uploaderRole, name, fileType, url, fileSize, createdAt FROM task_files ORDER BY createdAt ASC"
      ),
      all("SELECT * FROM parent_exports ORDER BY createdAt DESC"),
      all<PrintJobRow>("SELECT * FROM print_jobs ORDER BY createdAt DESC"),
      all<AuditLogRow>("SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT 80"),
      all<ChatMessageRow>("SELECT * FROM chat_messages ORDER BY createdAt DESC LIMIT 60")
    ]);
    const tasksWithCorrection = new Set(
      taskFiles
        .filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"))
        .map((file) => file.taskId)
    );
    const pendingReviewTasks = tasks.filter((task) => task.status !== "completed" && !tasksWithCorrection.has(task.id));

    res.json({
      users,
      students,
      tasks: sortTasksForTeacher(tasks.map(mapTask)),
      taskFiles: taskFiles.map(mapTaskFile),
      parentExports,
      printJobs: printJobs.map(mapPrintJob),
      auditLogs,
      chatMessages: chatMessages.reverse(),
      summary: {
        studentCount: students.length,
        activeTasks: tasks.filter((task) => task.status !== "completed").length,
        pendingReview: pendingReviewTasks.length,
        pendingPrintJobs: printJobs.filter((job) => job.status === "pending").length
      }
    });
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
        "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students ORDER BY createdAt ASC"
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
        payload.teacherId,
        payload.assistantId,
        timestamp,
        timestamp
      ]
    );

    const student = await get<StudentRow>(
      "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?",
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
      "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?",
      [studentId]
    );
    if (!existing) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    await run(
      "UPDATE students SET name = ?, grade = ?, targetScore = ?, currentLevel = ?, `group` = ?, updatedAt = ? WHERE id = ?",
      [
        payload.name ?? existing.name,
        payload.grade ?? existing.grade,
        payload.targetScore ?? existing.targetScore,
        payload.currentLevel ?? existing.currentLevel,
        payload.group ?? existing.group,
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
      "SELECT id, name, grade, targetScore, currentLevel, `group` AS `group`, teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?",
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

    await run(
      `UPDATE tasks
       SET status = ?, priority = ?, pinned = ?, teacherComment = ?, assistantNote = ?, score = ?, updatedAt = ?
       WHERE id = ?`,
      [
        payload.status ?? existing.status,
        payload.priority ?? existing.priority,
        payload.pinned === undefined ? existing.pinned : payload.pinned ? 1 : 0,
        payload.teacherComment ?? existing.teacherComment,
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

    if (req.file) {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(join(uploadDirectory, storedName), req.file.buffer);
    }

    const fileBuffer = req.file?.buffer;
    const fileType = req.file?.mimetype ?? "application/octet-stream";

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
      if (task && task.status === "reviewed" && remainingCorrections.length === 0) {
        await run("UPDATE tasks SET status = 'submitted', updatedAt = ? WHERE id = ?", [now(), existing.taskId]);
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
