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
  assistantId: string;
}

export type CreateStudentInput = Omit<Student, "id" | "teacherId" | "assistantId"> & {
  teacherId?: string;
  assistantId?: string;
};

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
  type: TaskType;
  priority: Priority;
  dueDate: string;
  description: string;
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
  createdAt: string;
}

export interface ParentExport {
  id: string;
  taskId: string;
  title: string;
  imageUrl: string;
  createdAt: string;
}

export interface DashboardData {
  students: Student[];
  tasks: Task[];
  taskFiles: TaskFile[];
  parentExports: ParentExport[];
  summary: {
    studentCount: number;
    activeTasks: number;
    pendingReview: number;
  };
}
