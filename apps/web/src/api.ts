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
    cache: init?.method ? init.cache : "no-store",
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

type ImageCompressionOptions = {
  maxSide?: number;
  quality?: number;
  minBytes?: number;
};

async function compressImageFile(file: File, options: ImageCompressionOptions = {}) {
  const minBytes = options.minBytes ?? 350 * 1024;
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < minBytes) {
    return file;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image compression failed"));
      image.src = objectUrl;
    });

    const maxSide = options.maxSide ?? 1800;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));

    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", options.quality ?? 0.82)
    );
    if (!blob || blob.size >= file.size) return file;

    const compressedName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], compressedName, {
      type: "image/jpeg",
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadTaskFile(
  taskId: string,
  input: {
    file: File;
    uploaderId: string;
    uploaderRole: string;
    compressImage?: boolean | ImageCompressionOptions;
  }
) {
  const file =
    input.compressImage
      ? await compressImageFile(input.file, typeof input.compressImage === "object" ? input.compressImage : undefined)
      : input.file;
  const formData = new FormData();
  formData.append("file", file);
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
