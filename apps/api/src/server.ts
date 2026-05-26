import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { all, createId, get, run } from "./db.js";

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
  createdAt: string;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 4000);
const uploadDirectory = fileURLToPath(new URL("../data/uploads", import.meta.url));

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());
app.use("/uploads", express.static(uploadDirectory));

const createStudentSchema = z.object({
  name: z.string().min(2),
  grade: z.string().min(1),
  targetScore: z.number().min(0).max(9),
  currentLevel: z.string().min(1),
  group: z.string().min(1),
  teacherId: z.string().min(1).default("u-teacher-lin"),
  assistantId: z.string().min(1).default("u-assistant-chen")
});

const createTaskSchema = z.object({
  studentId: z.string().min(1),
  title: z.string().min(2),
  type: z.enum(["reading", "listening", "writing", "speaking", "vocabulary", "grammar"]),
  priority: z.enum(["high", "medium", "low"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

function mapTask(task: TaskRow) {
  return {
    ...task,
    pinned: Boolean(task.pinned),
    score: task.score ?? undefined,
    teacherComment: task.teacherComment ?? undefined,
    assistantNote: task.assistantNote ?? undefined
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "qleda-api", database: "sqlite" });
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [users, students, tasks, taskFiles, parentExports] = await Promise.all([
      all("SELECT * FROM users ORDER BY createdAt ASC"),
      all<StudentRow>(
        'SELECT id, name, grade, targetScore, currentLevel, "group" AS "group", teacherId, assistantId, createdAt, updatedAt FROM students ORDER BY createdAt ASC'
      ),
      all<TaskRow>("SELECT * FROM tasks ORDER BY createdAt ASC"),
      all("SELECT * FROM task_files ORDER BY createdAt ASC"),
      all("SELECT * FROM parent_exports ORDER BY createdAt DESC")
    ]);

    res.json({
      users,
      students,
      tasks: sortTasksForTeacher(tasks.map(mapTask)),
      taskFiles,
      parentExports,
      summary: {
        studentCount: students.length,
        activeTasks: tasks.filter((task) => task.status !== "completed").length,
        pendingReview: tasks.filter((task) => task.status === "submitted").length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/students", async (_req, res, next) => {
  try {
    res.json(
      await all<StudentRow>(
        'SELECT id, name, grade, targetScore, currentLevel, "group" AS "group", teacherId, assistantId, createdAt, updatedAt FROM students ORDER BY createdAt ASC'
      )
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/students", async (req, res, next) => {
  try {
    const payload = createStudentSchema.parse(req.body);
    const id = createId("s");
    const timestamp = now();

    await run(
      `INSERT INTO students (id, name, grade, targetScore, currentLevel, "group", teacherId, assistantId, createdAt, updatedAt)
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
      'SELECT id, name, grade, targetScore, currentLevel, "group" AS "group", teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?',
      [id]
    );
    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/students/:studentId", async (req, res, next) => {
  try {
    const studentId = String(req.params.studentId);
    const existing = await get<StudentRow>(
      'SELECT id, name, grade, targetScore, currentLevel, "group" AS "group", teacherId, assistantId, createdAt, updatedAt FROM students WHERE id = ?',
      [studentId]
    );
    if (!existing) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    const tasks = await all<TaskRow>("SELECT * FROM tasks WHERE studentId = ?", [studentId]);
    for (const task of tasks) {
      await run("DELETE FROM task_files WHERE taskId = ?", [task.id]);
      await run("DELETE FROM parent_exports WHERE taskId = ?", [task.id]);
      await run("DELETE FROM tasks WHERE id = ?", [task.id]);
    }
    await run("DELETE FROM students WHERE id = ?", [studentId]);

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
        payload.type,
        payload.priority,
        payload.dueDate,
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
    const originalName = req.file?.originalname ?? "file";
    const safeName = basename(originalName).replace(/[^\w.-]+/g, "_");
    const storedName = `${id}-${safeName}`;
    const fileUrl = `/uploads/${storedName}`;

    if (req.file) {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(join(uploadDirectory, storedName), req.file.buffer);
    }

    await run(
      `INSERT INTO task_files (id, taskId, uploaderId, uploaderRole, name, fileType, url, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.id,
        String(req.body.uploaderId ?? "u-teacher-lin"),
        String(req.body.uploaderRole ?? "teacher"),
        req.file?.originalname ?? "Untitled attachment",
        req.file?.mimetype ?? "application/octet-stream",
        fileUrl,
        now()
      ]
    );

    res.status(201).json(await get("SELECT * FROM task_files WHERE id = ?", [id]));
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

    const files = await all<TaskFileRow>("SELECT * FROM task_files WHERE taskId = ? ORDER BY createdAt DESC", [task.id]);
    const correctionImage = files.find(
      (file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/") && file.url.startsWith("/uploads/")
    );

    if (!correctionImage) {
      res.status(404).json({ message: "No correction image found for this task" });
      return;
    }

    const id = createId("e");

    await run(
      "INSERT INTO parent_exports (id, taskId, title, imageUrl, createdAt) VALUES (?, ?, ?, ?, ?)",
      [id, task.id, correctionImage.name, correctionImage.url, now()]
    );

    res.status(201).json(await get("SELECT * FROM parent_exports WHERE id = ?", [id]));
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

app.listen(port, () => {
  console.log(`QLEDA API is running on http://localhost:${port}`);
});
