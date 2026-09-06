# Hidden Personal Workspace Design

## Goal and Scope

Add a personal workspace to QLEDA that is entered only by holding the existing "长按一下 夏日清凉" fan control for three seconds. The workspace offers a calendar planner and a priority todo view backed by the same task data and shared across desktop and mobile devices.

This change is additive only. It must not change existing teaching pages, teacher/student flows, task behavior, UI layout, database records, or ordinary fan press behavior.

## Existing-System Constraints

- The frontend is React 19 with Vite. It has no React Router; `App.tsx` uses `portalMode` for the existing views.
- The fan control is in `CurtainBrandHero.tsx`. A normal press starts the fan and curtain wind effect. The component is rendered on both the landing and teacher pages.
- The backend is Express. Production data is CloudBase MySQL, with schema initialization and compatible SQLite support in `apps/api/src/db.ts`.
- The project has no real individual login identity. CloudBase MCP is installed but not authenticated in the current Codex session, so this feature will use the existing Express-to-MySQL path rather than an MCP-managed NoSQL collection.

## Owner and Data Model

Use the fixed private owner id `personal_workspace_owner_v1`. It makes the same workspace visible across the user's devices without changing the teacher, assistant, or student identity model.

This is a hidden entry rather than an authentication boundary: a person who discovers both the route and private API convention could theoretically access the data. A future real-auth implementation can replace the fixed owner id with a user id.

Create a `personal_tasks` MySQL/SQLite table:

| Field | Purpose |
| --- | --- |
| `id` | Unique task identifier |
| `ownerId` | Fixed private workspace owner id |
| `title` | Required title |
| `description` | Optional description |
| `date` | Task date in `YYYY-MM-DD` format |
| `priority` | `high`, `medium`, or `low` |
| `completed` | Completion state |
| `createdAt` | Creation timestamp |
| `updatedAt` | Last update timestamp |

Indexes: `ownerId + date` for calendar reads and `ownerId + priority + completed` for priority ordering.

## API

Add separate Express endpoints without changing existing APIs:

- `GET /api/personal-tasks?month=YYYY-MM`
- `POST /api/personal-tasks`
- `PATCH /api/personal-tasks/:taskId`
- `DELETE /api/personal-tasks/:taskId`

The server operates only on the fixed owner. Writes update `dashboard_versions`, so the existing cross-device refresh mechanism can observe a change without loading private tasks into the teaching dashboard.

## Secret Entry

`CurtainBrandHero` gains an optional `onSecretLongPress` callback.

- Pointer down starts a three-second timer and preserves the existing wind behavior.
- Pointer up, pointer leave, and pointer cancel clear the timer and preserve existing wind cleanup.
- A completed hold invokes the callback once, with an optional subtle vibration.
- A one-time suppression marker prevents a subsequent ghost click from causing an extra interaction.
- A normal short press never invokes the callback and remains visually and behaviorally unchanged.

Both existing hero instances navigate to `/personal` after a successful hold. Direct navigation to `/personal` is allowed. The new path renders independently, leaving existing landing and teacher layouts untouched.

## Frontend Structure

Add focused modules:

- `PersonalWorkspacePage.tsx`: page state, loading and local error feedback.
- `PersonalCalendarPlanner.tsx`: month navigation, calendar grid, and day summaries.
- `PriorityTodoPanel.tsx`: priority-ordered task view.
- `PersonalTaskEditor.tsx`: shared quick add/edit surface.
- `personalTasks.ts`: task types, API calls, and date helpers.

Calendar and priority views share one `PersonalTask` model and one source of state.

## Interaction and Errors

- Clicking a date opens a compact add/edit surface; Enter submits and Escape closes it.
- A calendar day displays only a small number of tasks plus a `+N` indicator.
- Task completion, editing, priority changes, and deletion are supported from the personal workspace.
- Writes are optimistic. Failure restores prior state and shows a compact local message.
- Loading, empty, save-failed, delete-failed, and unavailable API states are handled inside the workspace rather than with a new global error page.

## Visual and Responsive Design

- Desktop: calendar at approximately 65%, priority panel at 35%.
- Below the existing 980px breakpoint: calendar followed by the priority list.
- Reuse existing CSS variables, paper/glass cards, green/gold/mint palette, rounded card language, shadows, and responsive rules.
- Do not change global visual tokens or current UI selectors outside the small fan-entry extension.

## Verification

1. Add focused tests for date/priority sorting and hold timing behavior.
2. Run API and web typechecks and the full build.
3. Verify normal fan presses still produce only wind, holds below three seconds do not navigate, and a three-second hold navigates once.
4. Verify personal-task CRUD, refresh persistence, and synchronized calendar/priority views.
5. Verify desktop and mobile layouts, then regression-check landing, teacher, student, daily check, and existing APIs.
6. Deploy only after verification and an explicit deployment request.
