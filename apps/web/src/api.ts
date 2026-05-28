import type { ChatMessage, CreateStudentInput, CreateTaskInput, DashboardData, ParentExport, PrintJob, Student, Task, TaskFile, TaskStatus } from "./types";

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export function resolveApiUrl(path: string) {
  if (!path || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }

  return path.startsWith("/") ? `${apiBaseUrl}${path}` : path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: isFormData
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...init?.headers
        },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getDashboard() {
  return request<DashboardData>("/api/dashboard");
}

export function createStudent(input: CreateStudentInput) {
  return request<Student>("/api/students", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createTask(input: CreateTaskInput) {
  return request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateTask(taskId: string, input: { status?: TaskStatus; assistantNote?: string; teacherComment?: string }) {
  return request<Task>(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function updatePrintJob(jobId: string, input: { status: "pending" | "printed" | "cancelled" }) {
  return request<PrintJob>(`/api/print-jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteTask(taskId: string) {
  const response = await fetch(`${apiBaseUrl}/api/tasks/${taskId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function deleteStudent(studentId: string) {
  const response = await fetch(`${apiBaseUrl}/api/students/${studentId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function deleteTaskFile(fileId: string) {
  const response = await fetch(`${apiBaseUrl}/api/task-files/${fileId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export function uploadTaskFile(taskId: string, input: { file: File; uploaderId: string; uploaderRole: string }) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("uploaderId", input.uploaderId);
  formData.append("uploaderRole", input.uploaderRole);

  return request<TaskFile>(`/api/tasks/${taskId}/files`, {
    method: "POST",
    body: formData
  });
}

export function createPrintJob(input: { file: File; requester: string; copies: number; note: string }) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("requester", input.requester);
  formData.append("copies", String(input.copies));
  formData.append("note", input.note);

  return request<PrintJob>("/api/print-jobs", {
    method: "POST",
    body: formData
  });
}

export function createChatMessage(input: { authorRole: "teacher" | "assistant"; authorName: string; message: string }) {
  return request<ChatMessage>("/api/chat-messages", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteChatMessage(messageId: string) {
  const response = await fetch(`${apiBaseUrl}/api/chat-messages/${messageId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function deletePrintJob(jobId: string) {
  const response = await fetch(`${apiBaseUrl}/api/print-jobs/${jobId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export function createParentExport(taskId: string) {
  return request<ParentExport>(`/api/tasks/${taskId}/parent-exports`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
