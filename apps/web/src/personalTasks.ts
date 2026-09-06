import {
  createPersonalTask as createPersonalTaskRequest,
  deletePersonalTask as deletePersonalTaskRequest,
  getPersonalTasks,
  updatePersonalTask as updatePersonalTaskRequest
} from "./api";

export type PersonalTaskPriority = "high" | "medium" | "low";
export type PersonalTaskCategory = "class" | "homework" | "test" | "extracurricular";

export interface PersonalTask {
  id: string;
  title: string;
  description: string;
  date: string;
  priority: PersonalTaskPriority;
  category: PersonalTaskCategory | null;
  isPriority: boolean;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalTestSubtask {
  id: string;
  testTaskId: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PersonalTaskDraft = Omit<Pick<PersonalTask, "title" | "description" | "date" | "priority" | "category" | "isPriority">, "category"> & { category: PersonalTaskCategory };

const priorityOrder: Record<PersonalTaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function getLocalDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function getMonthKey(date = new Date()) {
  return getLocalDateKey(date).slice(0, 7);
}

export function shiftMonth(month: string, direction: -1 | 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber - 1 + direction, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(year, monthNumber - 1, 1));
}

export function getMonthGrid(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: Math.ceil((mondayOffset + lastDay) / 7) * 7 }, (_, index) => {
    const day = index - mondayOffset + 1;
    if (day < 1 || day > lastDay) return null;
    return `${month}-${String(day).padStart(2, "0")}`;
  });
}

export function sortPersonalTasks(tasks: PersonalTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    const priorityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const dateDifference = left.date.localeCompare(right.date);
    if (dateDifference !== 0) return dateDifference;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function getPersonalTaskCategory(task: Pick<PersonalTask, "title" | "category">): PersonalTaskCategory {
  if (task.category) return task.category;
  const title = task.title.toLowerCase();
  if (/midterm|quiz|final|test|exam|期中|期末|考试|测验/.test(title)) return "test";
  if (/varsity|skate|滑冰|吃饭|dinner|appointment|邀约|约饭/.test(title)) return "extracurricular";
  if (/^[a-z]{2,5}\d{3,4}[a-z]?\d?\b|\b(lec|tut|pra|lab|sem)\b/i.test(task.title)) return "class";
  return "homework";
}

export function loadCalendarTasks(month: string) {
  return getPersonalTasks(month, "calendar");
}

export function loadPriorityTasks() {
  return getPersonalTasks(undefined, "priority");
}

export function createPersonalTask(input: PersonalTaskDraft) {
  return createPersonalTaskRequest(input);
}

export function updatePersonalTask(taskId: string, input: Partial<PersonalTaskDraft> & { completed?: boolean }) {
  return updatePersonalTaskRequest(taskId, input);
}

export function deletePersonalTask(taskId: string) {
  return deletePersonalTaskRequest(taskId);
}
