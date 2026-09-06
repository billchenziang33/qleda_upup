# Hidden Personal Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-device personal calendar and priority todo workspace available only through a three-second hold on the existing fan control.

**Architecture:** Keep existing teaching views isolated. Add a small path branch in `App.tsx`, a callback-only extension to `CurtainBrandHero`, dedicated personal-workspace React modules, and separate Express CRUD endpoints backed by a new MySQL/SQLite `personal_tasks` table. All private data uses the fixed owner id `personal_workspace_owner_v1` because the application has no individual authentication layer.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react, Express 5, Zod 4, mysql2, sql.js, CloudBase MySQL.

## Global Constraints

- Preserve all existing pages, layouts, interactions, API behavior, data, and normal fan short-press behavior.
- Do not add a visible personal-workspace button, icon, navigation entry, tooltip, or route link.
- The long hold duration is exactly `3000` milliseconds.
- Reuse the existing green, mint, gold, paper, rounded-card, glass, shadow, and responsive CSS language.
- Do not use `any`, `@ts-ignore`, broad silent error handling, or a new UI library.
- Do not deploy until typecheck, build, local user-visible checks, and regression checks pass.

---

### Task 1: Define the Personal Task Contract and Persistent Table

**Files:**
- Modify: `apps/api/src/db.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/src/personal-tasks.test.mjs`

**Interfaces:**
- Produces database table `personal_tasks` and API type `PersonalTaskRow`.
- Produces fixed owner constant `personalWorkspaceOwnerId`.

- [ ] **Step 1: Write a source-level failing test**

Create `apps/api/src/personal-tasks.test.mjs` that asserts the backend source contains all required routes, the table name, the fixed owner id, and the two indexes:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("./server.ts", import.meta.url), "utf8");
const database = await readFile(new URL("../src/db.ts", import.meta.url), "utf8");

test("personal task persistence is isolated from teaching tables", () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS personal_tasks/);
  assert.match(database, /idx_personal_tasks_owner_date/);
  assert.match(database, /idx_personal_tasks_owner_priority/);
  assert.match(server, /personal_workspace_owner_v1/);
  assert.match(server, /app\.get\("\/api\/personal-tasks"/);
  assert.match(server, /app\.post\("\/api\/personal-tasks"/);
  assert.match(server, /app\.patch\("\/api\/personal-tasks\/:taskId"/);
  assert.match(server, /app\.delete\("\/api\/personal-tasks\/:taskId"/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test apps/api/src/personal-tasks.test.mjs`

Expected: failure because `personal_tasks` and its routes do not yet exist.

- [ ] **Step 3: Add the schema and typed contract**

In `db.ts`, add matching SQLite and MySQL `CREATE TABLE IF NOT EXISTS personal_tasks` definitions:

```sql
id VARCHAR(80) PRIMARY KEY,
ownerId VARCHAR(80) NOT NULL,
title VARCHAR(255) NOT NULL,
description TEXT NOT NULL,
date VARCHAR(20) NOT NULL,
priority VARCHAR(20) NOT NULL,
completed TINYINT NOT NULL DEFAULT 0,
createdAt VARCHAR(40) NOT NULL,
updatedAt VARCHAR(40) NOT NULL
```

Create `idx_personal_tasks_owner_date (ownerId, date)` and `idx_personal_tasks_owner_priority (ownerId, priority, completed)` in both dialects. In `server.ts`, define:

```ts
type PersonalTaskPriority = "high" | "medium" | "low";

interface PersonalTaskRow {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  date: string;
  priority: PersonalTaskPriority;
  completed: number | boolean;
  createdAt: string;
  updatedAt: string;
}

const personalWorkspaceOwnerId = "personal_workspace_owner_v1";
```

- [ ] **Step 4: Run the test and typecheck**

Run: `node --test apps/api/src/personal-tasks.test.mjs && npm.cmd run typecheck -w apps/api`

Expected: both commands pass.

### Task 2: Add Isolated Personal Task CRUD API

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/personal-tasks.test.mjs`

**Interfaces:**
- Consumes: `PersonalTaskRow`, `personalWorkspaceOwnerId`, `now()`, `createId()`, `run()`, `all()`, `get()`, `touchDashboardVersion()`.
- Produces endpoints with responses shaped as `{ id, title, description, date, priority, completed, createdAt, updatedAt }`.

- [ ] **Step 1: Extend the failing test with data contract checks**

Assert source-level schemas require a non-empty title, an ISO date, and the three priorities:

```js
assert.match(server, /personalTaskCreateSchema/);
assert.match(server, /z\.enum\(\["high", "medium", "low"\]\)/);
assert.match(server, /regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
assert.match(server, /WHERE id = \? AND ownerId = \?/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test apps/api/src/personal-tasks.test.mjs`

Expected: failure because CRUD validation and owner-scoped mutations are absent.

- [ ] **Step 3: Implement schemas, mapper, ordering, and routes**

Add Zod schemas:

```ts
const personalTaskDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const personalTaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).default(""),
  date: personalTaskDateSchema,
  priority: z.enum(["high", "medium", "low"]).default("medium")
});
const personalTaskUpdateSchema = personalTaskCreateSchema.partial().extend({ completed: z.boolean().optional() });
```

The month GET accepts `YYYY-MM`, selects only `ownerId = ? AND date LIKE ?`, and orders by `date ASC, completed ASC, createdAt ASC`. Create, patch, and delete all include `ownerId = personalWorkspaceOwnerId`. Convert SQL booleans with `completed: Boolean(row.completed)`. Every successful write calls `touchDashboardVersion()`.

- [ ] **Step 4: Run backend regression checks**

Run: `node --test apps/api/src/personal-tasks.test.mjs apps/api/src/daily-check-scope.test.mjs && npm.cmd run typecheck -w apps/api`

Expected: all tests and API typecheck pass.

### Task 3: Build the Shared Frontend Data Layer

**Files:**
- Create: `apps/web/src/personalTasks.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/personalTasks.test.mjs`

**Interfaces:**
- Produces `PersonalTask`, `PersonalTaskPriority`, `getMonthBounds`, `sortPersonalTasks`, `createPersonalTask`, `updatePersonalTask`, and `deletePersonalTask`.
- Uses existing `request` helper behavior through exported API wrappers.

- [ ] **Step 1: Write date/sorting tests**

Test that `sortPersonalTasks` returns unfinished high before unfinished medium before unfinished low, then completed tasks, using nearest date and creation time as ties:

```js
assert.deepEqual(
  sortPersonalTasks(tasks).map((task) => task.id),
  ["high-soon", "medium", "low", "completed"]
);
assert.deepEqual(getMonthBounds("2026-09"), { start: "2026-09-01", end: "2026-09-30" });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test apps/web/src/personalTasks.test.mjs`

Expected: failure because the module is absent.

- [ ] **Step 3: Implement typed client helpers**

Define:

```ts
export type PersonalTaskPriority = "high" | "medium" | "low";
export interface PersonalTask {
  id: string;
  title: string;
  description: string;
  date: string;
  priority: PersonalTaskPriority;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Add API wrappers in `api.ts` that call the new four endpoints using existing `request`, with no dashboard changes. Keep date helpers pure and put ordering in `personalTasks.ts`.

- [ ] **Step 4: Run client static checks**

Run: `node --test apps/web/src/personalTasks.test.mjs && npm.cmd run typecheck -w apps/web`

Expected: pass.

### Task 4: Add the Personal Workspace UI Modules

**Files:**
- Create: `apps/web/src/PersonalTaskEditor.tsx`
- Create: `apps/web/src/PersonalCalendarPlanner.tsx`
- Create: `apps/web/src/PriorityTodoPanel.tsx`
- Create: `apps/web/src/PersonalWorkspacePage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `PersonalTask` and API helpers from `personalTasks.ts`.
- Produces `PersonalWorkspacePage` with `onExit(): void`.

- [ ] **Step 1: Write source-level UI contract tests**

Create `apps/web/src/personal-workspace.test.mjs` that checks for the workspace page, calendar, priority panel, and mobile breakpoint selectors:

```js
assert.match(page, /PersonalCalendarPlanner/);
assert.match(page, /PriorityTodoPanel/);
assert.match(styles, /\.personal-workspace-grid/);
assert.match(styles, /@media \(max-width: 980px\)/);
assert.match(styles, /\.personal-calendar-day/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test apps/web/src/personal-workspace.test.mjs`

Expected: failure because the page and selectors are absent.

- [ ] **Step 3: Implement the four focused UI files**

`PersonalWorkspacePage` owns the selected month, current task list, editor target, saving state, local error and optimistic rollback. It loads the selected month when mounted or when the month changes.

`PersonalCalendarPlanner` renders a Monday-first month grid, previous/next/today icon controls, at most two tasks per day, and a `+N` count. A date click calls `onCreateForDate(date)`.

`PersonalTaskEditor` is a compact modal using existing `.modal-backdrop`, `.student-form`, `.form-header`, `.icon-button`, and `.submit-button` patterns. It supports Enter submission except inside the description textarea and Escape closing.

`PriorityTodoPanel` receives the same tasks and renders `sortPersonalTasks(tasks)` with checkbox, title, date, priority control, edit icon, and delete icon. It has a compact empty state.

Add only `.personal-*` selectors to `styles.css`. Reuse existing CSS variables. The grid is `minmax(0, 1.85fr) minmax(300px, 1fr)` on desktop and one column below `980px`.

- [ ] **Step 4: Run UI contract test and Web typecheck**

Run: `node --test apps/web/src/personal-workspace.test.mjs && npm.cmd run typecheck -w apps/web`

Expected: pass.

### Task 5: Wire the Hidden Route and Three-Second Long Press

**Files:**
- Modify: `apps/web/src/CurtainBrandHero.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/curtain-long-press.test.mjs`

**Interfaces:**
- `CurtainBrandHero` accepts `onSecretLongPress?: () => void`.
- `App` routes `window.location.pathname === "/personal"` to `PersonalWorkspacePage`.

- [ ] **Step 1: Write the long-press source contract test**

Assert the component has a `3000` timeout, clears it on pointer up/leave/cancel, calls the optional callback once, and preserves `setFanPressed(true/false)`:

```js
assert.match(hero, /onSecretLongPress/);
assert.match(hero, /window\.setTimeout\([^,]+, 3000\)/);
assert.match(hero, /onPointerUp/);
assert.match(hero, /onPointerLeave/);
assert.match(hero, /onPointerCancel/);
assert.match(hero, /setFanPressed\(true\)/);
assert.match(hero, /setFanPressed\(false\)/);
assert.match(app, /window\.location\.pathname === "\/personal"/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test apps/web/src/curtain-long-press.test.mjs`

Expected: failure because the callback and path branch do not exist.

- [ ] **Step 3: Implement the long-hold state safely**

Use refs for the timer and a one-shot `longPressTriggeredRef`. On `pointerdown`, set pointer capture, reset the trigger flag, set wind active, and start the 3000 ms timer. The timer sets the trigger flag, invokes `navigator.vibrate?.(12)`, and calls `onSecretLongPress?.()`. On pointer end/cancel/leave, clear the timer and set wind inactive. Do not add `onClick`; the current component has no click navigation to preserve.

In `App.tsx`, import `PersonalWorkspacePage` and pass `onSecretLongPress={() => window.location.assign("/personal")}` to both `CurtainBrandHero` usages. Before loading dashboard-dependent portal branches, render the workspace when the pathname is `/personal`, with `onExit={() => window.location.assign("/")}`.

- [ ] **Step 4: Run front-end tests and typecheck**

Run: `node --test apps/web/src/personalTasks.test.mjs apps/web/src/personal-workspace.test.mjs apps/web/src/curtain-long-press.test.mjs && npm.cmd run typecheck -w apps/web`

Expected: pass.

### Task 6: Verify the Full Feature and Regressions

**Files:**
- Modify: `summary.md`

**Interfaces:**
- Consumes completed API, UI, and long-press implementation.
- Produces verified local build and an updated project handoff summary.

- [ ] **Step 1: Run all focused tests and full checks**

Run:

```powershell
node --test apps/api/src/daily-check-scope.test.mjs apps/api/src/personal-tasks.test.mjs
node --test apps/web/src/personalTasks.test.mjs apps/web/src/personal-workspace.test.mjs apps/web/src/curtain-long-press.test.mjs
npm.cmd run typecheck
npm.cmd run build
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run the local app and exercise visible flows**

Run: `npm.cmd run dev`

Verify desktop and mobile: landing page short fan press, sub-three-second hold, three-second hold from both hero placements, `/personal`, calendar add/edit/complete/delete, priority ordering, reload persistence, and existing teacher/student portal entry.

- [ ] **Step 3: Update the project summary**

Append the personal workspace implementation, table/API names, fixed owner limitation, test commands, and deployment status to `summary.md` without deleting existing historical notes.

- [ ] **Step 4: Do not deploy automatically**

Report the local verification result and wait for an explicit user deployment request before building a CloudRun deployment package or uploading static hosting.
