# Test Schedule Design

## Goal

Add a separate Test Schedule view beside the Personal Workspace title. It reads Test-category calendar tasks, orders them chronologically, and lets the user persist independent subtasks under each test.

## Scope

- Add a `Test Schedule` button beside `Personal Workspace`.
- Open the view through the existing static-hosting-safe query entry: `/?personal=1&view=test-schedule`.
- Show only calendar tasks where `isPriority = 0` and the effective category is `test`.
- Sort test cards by date, then title.
- Keep the existing calendar, Priority tasks, refresh button, task editor, and dashboard behavior unchanged.
- Each test card supports adding a subtask, marking it complete/incomplete, and deleting it.
- Persist subtasks in CloudBase MySQL and SQLite local fallback.
- Keep subtasks scoped to the fixed existing personal workspace owner and the parent test task id.

## Data Model

Add a separate `personal_test_subtasks` table through the existing database initialization/migration path:

- `id`
- `ownerId`
- `testTaskId`
- `title`
- `completed`
- `createdAt`
- `updatedAt`
- indexes on `(ownerId, testTaskId)` and `(ownerId, completed)`

The parent test remains the existing `personal_tasks` row. Deleting a calendar task does not silently delete subtasks in this feature; the Test Schedule shows subtasks only while the parent test exists, and API deletion of a subtask is explicit.

## API

- `GET /api/personal-test-subtasks?testTaskId=<id>` returns subtasks for one owned test.
- `POST /api/personal-test-subtasks` accepts `{ testTaskId, title }` and creates an incomplete subtask.
- `PATCH /api/personal-test-subtasks/:subtaskId` accepts `{ title?, completed? }`.
- `DELETE /api/personal-test-subtasks/:subtaskId` deletes one owned subtask.

All endpoints validate ids/titles, verify the parent test belongs to the fixed personal owner and is a non-priority Test task, and return JSON using the existing API error handling.

## Frontend Design

- Add `TestSchedulePage.tsx` as an isolated page component.
- `PersonalWorkspacePage` reads the `view` query state and renders either the current workspace or the new Test Schedule view. A back button returns to `/?personal=1`.
- The new page loads the current semester calendar range used by the personal planner (September through December 2026), filters effective Test tasks, then loads subtasks for those tests.
- Each test card uses a Test-colored surface, shows title/date/description, and renders a nested checklist.
- The add-subtask control uses an inline input, Enter/Save submission, and Cancel; empty titles are rejected locally.
- Loading and error states are local to the new view. Existing workspace errors and task state are untouched.

## Compatibility

- Legacy tasks with `category = NULL` use the existing frontend title-based category inference. This means old Test/Quiz/Midterm/Final titles are included without a data rewrite.
- The feature does not change existing calendar task rows or Priority Task rows.
- No new third-party dependency is needed.

## Verification

- Add focused source regression assertions for the new route, Test filtering, subtask APIs, persistence table, and controls.
- Run:
  - `node --test apps/api/src/personal-tasks.test.mjs apps/web/src/personal-workspace.test.mjs`
  - `npm.cmd run typecheck`
  - `npm.cmd run build`
- Deploy backend and frontend only after all checks pass.
- Verify `/health`, `/api/dashboard/version`, `/api/dashboard`, the personal task endpoint, and the new subtask endpoint with read-only requests.
- Verify the hosted personal workspace exposes the Test Schedule button and the new view entry.

