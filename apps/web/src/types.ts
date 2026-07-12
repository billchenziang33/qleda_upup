export type Role = "admin" | "teacher" | "assistant" | "student" | "parent";
export type TaskType = "reading" | "listening" | "writing" | "speaking" | "vocabulary" | "grammar";
export type Priority = "high" | "medium" | "low";
export type TaskStatus = "not_started" | "in_progress" | "submitted" | "reviewed" | "completed";

export interface Student {
  id: string;
  name: string;
  grade: string;
  targetScore: number;
  currentLevel: string;
  group: string;
  teacherId: string;
  teacherName: string;
  assistantId: string;
}

export type CreateStudentInput = Pick<Student, "name" | "group" | "teacherName">;

export interface User {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface Task {
  id: string;
  studentId: string;
  title: string;
  type: TaskType;
  priority: Priority;
  dueDate: string;
  description: string;
  status: TaskStatus;
  pinned: boolean;
  score?: string;
  teacherComment?: string;
  assistantNote?: string;
  createdAt: string;
}

export type CreateTaskInput = {
  studentId: string;
  title: string;
  description: string;
  dueDate: string;
  pinned: boolean;
};

export interface TaskFile {
  id: string;
  taskId: string;
  uploaderId: string;
  uploaderRole: Role;
  name: string;
  fileType: string;
  url: string;
  cloudFileId?: string;
  thumbnailUrl?: string;
  createdAt: string;
}

export interface ParentExport {
  id: string;
  taskId: string;
  title: string;
  imageUrl: string;
  createdAt: string;
}

export interface PrintJob {
  id: string;
  requester: string;
  copies: number;
  note: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  status: "pending" | "printed" | "cancelled" | string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  authorRole: "teacher" | "assistant";
  authorName: string;
  message: string;
  createdAt: string;
}

export interface SharedFile {
  id: string;
  uploaderId: string;
  uploaderRole: "teacher" | "assistant" | string;
  uploaderName: string;
  note: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  cloudFileId?: string;
  thumbnailUrl?: string;
  fileSize?: number;
  createdAt: string;
}

export interface DashboardData {
  version: string;
  users: User[];
  students: Student[];
  tasks: Task[];
  taskFiles: TaskFile[];
  taskFilesLoadedTaskIds?: string[];
  tasksWithCorrection?: string[];
  parentExports: ParentExport[];
  printJobs: PrintJob[];
  auditLogs: AuditLog[];
  chatMessages: ChatMessage[];
  sharedFiles: SharedFile[];
  summary: {
    studentCount: number;
    activeTasks: number;
    pendingReview: number;
    pendingPrintJobs: number;
  };
}

export interface DashboardVersion {
  version: string;
}
