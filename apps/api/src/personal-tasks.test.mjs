import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [server, database] = await Promise.all([
  readFile(new URL("./server.ts", import.meta.url), "utf8"),
  readFile(new URL("./db.ts", import.meta.url), "utf8")
]);

test("personal task persistence is isolated from teaching tables", () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS personal_tasks/);
  assert.match(database, /idx_personal_tasks_owner_date/);
  assert.match(database, /idx_personal_tasks_owner_priority/);
  assert.match(database, /personal_test_subtasks/);
  assert.match(database, /idx_personal_test_subtasks_owner_test/);
  assert.match(database, /isPriority/);
  assert.match(database, /category/);
  assert.match(database, /ensureSqliteColumn\(db, "personal_tasks", "isPriority"/);
  assert.match(database, /ensureMysqlColumn\(pool, "personal_tasks", "isPriority"/);
  assert.match(server, /personal_workspace_owner_v1/);
  assert.match(server, /app\.get\("\/api\/personal-tasks"/);
  assert.match(server, /app\.post\("\/api\/personal-tasks"/);
  assert.match(server, /app\.patch\("\/api\/personal-tasks\/:taskId"/);
  assert.match(server, /app\.delete\("\/api\/personal-tasks\/:taskId"/);
});

test("personal task mutations validate and scope records to the private owner", () => {
  assert.match(server, /personalTaskCreateSchema/);
  assert.match(server, /personalTestSubtaskCreateSchema/);
  assert.match(server, /personal-test-subtasks/);
  assert.match(server, /getOwnedTestTask/);
  assert.match(server, /personalTaskUpdateSchema = z\.object/);
  assert.doesNotMatch(server, /personalTaskCreateSchema\.partial\(\)/);
  assert.match(server, /z\.enum\(\["high", "medium", "low"\]\)/);
  assert.match(server, /personalTaskDateSchema/);
  assert.match(server, /isPriority/);
  assert.match(server, /category/);
  assert.match(server, /scope/);
  assert.match(server, /isPriority = 0/);
  assert.match(server, /isPriority = 1/);
  assert.match(server, /z\.literal\(""\)/);
  assert.match(server, /WHERE id = \? AND ownerId = \?/);
});
