import type {
  CreateStudentInput,
  CreateTaskInput,
  DashboardData,
  DashboardVersion,
  DailyCheckEntry,
  DailyCheckTaskNote,
  ParentExport,
  PrintJob,
  SharedFile,
  Student,
  Task,
  TaskFile,
  TaskStatus
} from "./types";
import type { PersonalTask, PersonalTaskDraft, PersonalTestSubtask } from "./personalTasks";

const cloudBaseRunApiUrl = "https://qleda-api-263206-10-1437709388.sh.run.tcloudbase.com";

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? cloudBaseRunApiUrl : "")).replace(/\/$/, "");

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

export function getDashboardVersion() {
  return request<DashboardVersion>("/api/dashboard/version");
}

export function getPersonalTasks(month?: string, scope: "calendar" | "priority" = "calendar") {
  const query = new URLSearchParams({ scope });
  if (month) query.set("month", month);
  return request<PersonalTask[]>(`/api/personal-tasks?${query.toString()}`);
}

export function createPersonalTask(input: PersonalTaskDraft) {
  return request<PersonalTask>("/api/personal-tasks", { method: "POST", body: JSON.stringify(input) });
}

export function updatePersonalTask(taskId: string, input: Partial<PersonalTaskDraft> & { completed?: boolean }) {
  return request<PersonalTask>(`/api/personal-tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deletePersonalTask(taskId: string) {
  const response = await fetch(`${apiBaseUrl}/api/personal-tasks/${taskId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

export function getPersonalTestSubtasks(testTaskId: string) {
  const query = new URLSearchParams({ testTaskId });
  return request<PersonalTestSubtask[]>(`/api/personal-test-subtasks?${query.toString()}`);
}

export function createPersonalTestSubtask(input: { testTaskId: string; title: string }) {
  return request<PersonalTestSubtask>("/api/personal-test-subtasks", { method: "POST", body: JSON.stringify(input) });
}

export function updatePersonalTestSubtask(subtaskId: string, input: { title?: string; completed?: boolean }) {
  return request<PersonalTestSubtask>(`/api/personal-test-subtasks/${subtaskId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deletePersonalTestSubtask(subtaskId: string) {
  const response = await fetch(`${apiBaseUrl}/api/personal-test-subtasks/${subtaskId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

export function getTaskFiles(taskId: string) {
  return request<TaskFile[]>(`/api/tasks/${taskId}/files`);
}

export function createStudent(input: CreateStudentInput) {
  return request<Student>("/api/students", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createTeacher(input: { name: string }) {
  return request<{ id: string; name: string }>("/api/teachers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateStudent(studentId: string, input: { name?: string; group?: string; teacherName?: string }) {
  return request<Student>(`/api/students/${studentId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function updateTeacherName(teacherId: string, input: { name: string }) {
  return request<{ id: string; name: string }>(`/api/teachers/${teacherId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function archiveTeacher(teacherId: string) {
  return request<void>(`/api/teachers/${teacherId}`, {
    method: "DELETE"
  });
}

export function renameTeacherGroup(teacherId: string, input: { currentGroupName: string; nextGroupName: string }) {
  return request<{ updatedCount: number }>(`/api/teachers/${teacherId}/groups/rename`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function moveTeacherGroup(
  teacherId: string,
  input: { groupName: string; nextTeacherId: string; nextGroupName?: string }
) {
  return request<{ updatedCount: number; groupName: string; teacherId: string }>(`/api/teachers/${teacherId}/groups/move`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function createTask(input: CreateTaskInput) {
  const { dueDate: rawDueDate, ...rest } = input;
  const normalizedDueDate = rawDueDate?.trim().replace(/\//g, "-").slice(0, 10) ?? "";
  const payload = {
    ...rest,
    ...(normalizedDueDate ? { dueDate: normalizedDueDate } : {})
  };

  return request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTask(
  taskId: string,
  input: { title?: string; status?: TaskStatus; assistantNote?: string; teacherComment?: string; dueDate?: string }
) {
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

export async function deleteStudentGroup(groupName: string) {
  const response = await fetch(`${apiBaseUrl}/api/student-groups/${encodeURIComponent(groupName)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function deleteTeacherGroup(teacherId: string, groupName: string) {
  const response = await fetch(`${apiBaseUrl}/api/teachers/${teacherId}/groups/${encodeURIComponent(groupName)}`, {
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

function decodeDownloadFileName(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
}

export async function downloadDailyFeedbackPdf(studentId: string, date: string, fallbackFileName?: string) {
  const response = await fetch(`${apiBaseUrl}/api/students/${studentId}/daily-feedback.pdf?date=${encodeURIComponent(date)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return {
    blob: await response.blob(),
    fileName: decodeDownloadFileName(response.headers.get("Content-Disposition"), fallbackFileName ?? `${date}-当日全部作业反馈.pdf`)
  };
}

export function createSharedFile(input: {
  file: File;
  uploaderId: string;
  uploaderRole: "teacher" | "assistant";
  uploaderName: string;
  note: string;
}) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("uploaderId", input.uploaderId);
  formData.append("uploaderRole", input.uploaderRole);
  formData.append("uploaderName", input.uploaderName);
  formData.append("note", input.note);

  return request<SharedFile>("/api/shared-files", {
    method: "POST",
    body: formData
  });
}

export function updateDailyCheckEntry(input: {
  dateKey: string;
  teacherId: string;
  className: string;
  studentId: string;
  columnKey: string;
  checked: boolean;
  note: string;
}) {
  return request<DailyCheckEntry>("/api/daily-check-entries", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function updateDailyCheckTaskNote(input: {
  dateKey: string;
  teacherId: string;
  className: string;
  columnKey: string;
  note: string;
}) {
  return request<DailyCheckTaskNote>("/api/daily-check-task-notes", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteSharedFile(sharedFileId: string) {
  const response = await fetch(`${apiBaseUrl}/api/shared-files/${sharedFileId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export function createPrintJobFromSharedFile(sharedFileId: string, input: { requester: string; copies: number; note: string }) {
  return request<PrintJob>(`/api/shared-files/${sharedFileId}/print-jobs`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
