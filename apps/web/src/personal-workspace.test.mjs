import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const [page, calendar, priority, editor, styles, hero, app, schedule, subtasks] = await Promise.all([
  readFile(new URL("./PersonalWorkspacePage.tsx", root), "utf8"),
  readFile(new URL("./PersonalCalendarPlanner.tsx", root), "utf8"),
  readFile(new URL("./PriorityTodoPanel.tsx", root), "utf8"),
  readFile(new URL("./PersonalTaskEditor.tsx", root), "utf8"),
  readFile(new URL("./styles.css", root), "utf8"),
  readFile(new URL("./CurtainBrandHero.tsx", root), "utf8"),
  readFile(new URL("./App.tsx", root), "utf8"),
  readFile(new URL("./TestSchedulePage.tsx", root), "utf8"),
  readFile(new URL("./testSubtasks.ts", root), "utf8")
]);

test("personal workspace keeps calendar, priorities, and responsive styling separate", () => {
  assert.match(page, /PersonalCalendarPlanner/);
  assert.match(page, /PriorityTodoPanel/);
  assert.match(calendar, /personal-calendar-day/);
  assert.match(calendar, /onDeleteTask/);
  assert.match(calendar, /personal-calendar-delete/);
  assert.match(calendar, /onViewDate/);
  assert.match(calendar, /onDoubleClick/);
  assert.match(priority, /priority-todo-panel/);
  assert.match(priority, /onCreateTask/);
  assert.match(priority, /Add task/);
  assert.match(page, /loadCalendarTasks/);
  assert.match(page, /loadPriorityTasks/);
  assert.match(page, /点击以刷新 Task/);
  assert.match(page, /refresh\(month\)/);
  assert.match(styles, /\.personal-refresh-button/);
  assert.match(page, /isPriority/);
  assert.match(page, /deleteCandidate/);
  assert.match(page, /确认删除这个任务/);
  assert.match(page, /confirmDelete/);
  assert.match(page, /dayDetailsDate/);
  assert.match(page, /personal-day-details/);
  assert.match(calendar, /category-\$\{getPersonalTaskCategory\(task\)\}/);
  assert.match(editor, /categoryOptions/);
  assert.match(editor, /Category/);
  assert.match(page, /categoryLabels/);
  assert.match(styles, /category-homework/);
  assert.match(styles, /category-test/);
  assert.match(styles, /category-extracurricular/);
  assert.match(priority, /No priority tasks yet/);
  assert.match(page, /openCreate\("", true\)/);
  assert.match(editor, /date: task\?\.date \?\? date/);
  assert.match(editor, /PersonalTaskEditor/);
  assert.match(styles, /\.personal-workspace-grid/);
  assert.match(styles, /@media \(max-width: 980px\)/);
  assert.match(page, /TestSchedulePage/);
  assert.match(page, /view=test-schedule/);
  assert.match(page, /Test Schedule/);
  assert.match(schedule, /semesterMonths/);
  assert.match(schedule, /getPersonalTaskCategory\(task\) === "test"/);
  assert.match(schedule, /Add subtask/);
  assert.match(schedule, /test-subtask-save/);
  assert.match(schedule, /test-subtask-cancel/);
  assert.match(schedule, /toggleSubtask/);
  assert.match(schedule, /deleteTestSubtask/);
  assert.match(subtasks, /loadTestSubtasks/);
});

test("fan long press has a single two-second secret entry without removing wind controls", () => {
  assert.match(hero, /onSecretLongPress/);
  assert.match(hero, /window\.setTimeout\([\s\S]+?, 2000\)/);
  assert.match(hero, /onPointerUp/);
  assert.match(hero, /onPointerLeave/);
  assert.match(hero, /onPointerCancel/);
  assert.match(hero, /setFanPressed\(true\)/);
  assert.match(hero, /setFanPressed\(false\)/);
  assert.match(app, /isPersonalWorkspaceRoute/);
});
