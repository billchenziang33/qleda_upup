import { createPersonalTestSubtask, deletePersonalTestSubtask, getPersonalTestSubtasks, updatePersonalTestSubtask } from "./api";
import type { PersonalTestSubtask } from "./personalTasks";

export type TestSubtask = PersonalTestSubtask;

export function loadTestSubtasks(testTaskId: string) {
  return getPersonalTestSubtasks(testTaskId);
}

export function createTestSubtask(testTaskId: string, title: string) {
  return createPersonalTestSubtask({ testTaskId, title });
}

export function updateTestSubtask(subtaskId: string, input: { title?: string; completed?: boolean }) {
  return updatePersonalTestSubtask(subtaskId, input);
}

export function deleteTestSubtask(subtaskId: string) {
  return deletePersonalTestSubtask(subtaskId);
}
