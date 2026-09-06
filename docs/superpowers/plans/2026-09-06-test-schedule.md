# Test Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a separate Test Schedule view that lists calendar Test tasks chronologically and persists nested subtasks in CloudBase.

**Architecture:** Keep `PersonalWorkspacePage` as the entry point and use the existing query-based personal route. Add an isolated `TestSchedulePage` and `testSubtasks.ts` frontend module. Add a separate `personal_test_subtasks` table and owner-scoped Express endpoints; the existing `personal_tasks` rows remain the source of parent tests.

**Tech Stack:** React, TypeScript, Vite, Express, Zod, SQLite fallback, CloudBase MySQL, existing lucide-react icons.

## Global Constraints

- Preserve existing calendar, Priority Task, refresh, dashboard, and task editor behavior.
- Do not batch update or delete existing personal task rows.
- Keep the original CloudBase Hosting domain and `qleda-api` service.
- Use no new third-party dependencies.
- Run typecheck, focused tests, and build before deployment.

---

### Task 1: Add persistent subtask storage and API

**Files:**
- Modify: `apps/api/src/db.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/personal-tasks.test.mjs`

**Interfaces:**
- Produces `GET /api/personal-test-subtasks?testTaskId=<id>`.
- Produces `POST /api/personal-test-subtasks` with `{ testTaskId: string, title: string }`.
- Produces `PATCH /api/personal-test-subtasks/:subtaskId` with `{ title?: string, completed?: boolean }`.
- Produces `DELETE /api/personal-test-subtasks/:subtaskId`.

- [ ] Add SQLite/MySQL `personal_test_subtasks` table and indexes through existing initialization code.
- [ ] Add owner-scoped row type and Zod schemas.
- [ ] Add a helper that verifies the parent exists, belongs to `personal_workspace_owner_v1`, has `isPriority = 0`, and has effective category `test` using stored category or the existing title inference rules.
- [ ] Add the four endpoints with explicit owner and parent checks; return 404 for missing/non-test parents.
- [ ] Add source assertions for table, routes, validation, and owner scoping.
- [ ] Run `node --test apps/api/src/personal-tasks.test.mjs`; expect all tests to pass.

### Task 2: Add frontend subtask API and Test Schedule page

**Files:**
- Create: `apps/web/src/testSubtasks.ts`
- Create: `apps/web/src/TestSchedulePage.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/personalTasks.ts`
- Modify: `apps/web/src/PersonalWorkspacePage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/personal-workspace.test.mjs`

**Interfaces:**
- `testSubtasks.ts` exports `TestSubtask`, `loadTestSubtasks(testTaskId)`, `createTestSubtask(testTaskId, title)`, `updateTestSubtask(subtaskId, input)`, and `deleteTestSubtask(subtaskId)`.
- `TestSchedulePage` accepts `{ onBack: () => void }` and loads the September–December 2026 calendar range, filters `getPersonalTaskCategory(task) === "test"`, and renders subtasks grouped under each parent test.

- [ ] Add typed API wrappers and the `TestSubtask` model.
- [ ] Add `TestSchedulePage` with chronological parent cards, nested checklist controls, inline add form, completion toggle, delete action, loading state, and error state.
- [ ] Load all four Fall 2026 calendar months with `Promise.all`, deduplicate by task id, and sort by `date`, then `title`.
- [ ] Add query-state branching in `PersonalWorkspacePage`: `view=test-schedule` renders the new page; otherwise render the unchanged workspace.
- [ ] Add the `Test Schedule` button beside the `Personal Workspace` title and a back button that returns to `/?personal=1`.
- [ ] Add isolated `.test-schedule-*` styles and reuse the existing Test color palette.
- [ ] Add source assertions for route, button, filtering, subtask controls, and four-month loading.
- [ ] Run `node --test apps/web/src/personal-workspace.test.mjs`; expect all tests to pass.

### Task 3: Full local verification and documentation

**Files:**
- Modify: `summary.md`

- [ ] Run `npm.cmd run typecheck` from `C:\Users\admin\IdeaProjects\qleda_upup`.
- [ ] Run `npm.cmd run build` and record the generated asset names.
- [ ] Verify no unrelated personal task data changed locally; no destructive migration is performed.
- [ ] Update `summary.md` with files changed, database migration, tests, and deployment result.

### Task 4: Deploy and verify production

**Files:**
- Copy: `apps/api/src/server.ts` and `apps/api/src/db.ts` to `C:\Users\admin\Documents\New project\qleda_upup_cloudrun_deploy\apps\api\src`

- [ ] Query current `qleda-api` detail and confirm environment id, 1 CPU/2 GB, 0–5 instances, port 4000, access types, and MySQL variables.
- [ ] Deploy the clean CloudRun package to service `qleda-api` and confirm new version has 100% traffic.
- [ ] Upload `C:\Users\admin\IdeaProjects\qleda_upup\apps\web\dist` to Hosting `/`.
- [ ] Verify `/health`, `/api/dashboard/version`, `/api/dashboard`, `/api/personal-tasks?scope=calendar&month=2026-09`, and the new subtask endpoint with read-only requests.
- [ ] Use browser accessibility inspection to confirm the personal workspace exposes `Test Schedule` and the new view exposes the Test Schedule heading.
