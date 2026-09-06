import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const webSource = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
const match = serverSource.match(/function getDailyCheckClassName\(student: StudentRow\) \{([\s\S]*?)\n\}/);

test("daily check scope keeps classes under one teacher separate", () => {
  assert.ok(match, "daily check class scope helper must exist");
  const helperSource = match[0].replace("student: StudentRow", "student");
  const getDailyCheckClassName = new Function(`${helperSource}; return getDailyCheckClassName;`)();

  assert.equal(
    getDailyCheckClassName({ group: "6.0", teacherName: "2026年8月雅思" }),
    "6.0"
  );
  assert.equal(
    getDailyCheckClassName({ group: "6.5", teacherName: "2026年8月雅思" }),
    "6.5"
  );
});

test("daily check selector creates one option per class", () => {
  const panelSource = webSource.slice(webSource.indexOf("function DailyCheckPanel"), webSource.indexOf("function SharedFilesPanel"));

  assert.match(panelSource, /\.flatMap\(\(teacher\) =>\s*teacher\.groups\.map\(/);
  assert.match(panelSource, /className: group\.groupName/);
  assert.doesNotMatch(panelSource, /className: teacher\.teacherName/);
});
