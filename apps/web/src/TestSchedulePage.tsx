import { ArrowLeft, Check, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getPersonalTaskCategory, loadCalendarTasks, type PersonalTask } from "./personalTasks";
import { createTestSubtask, deleteTestSubtask, loadTestSubtasks, updateTestSubtask, type TestSubtask } from "./testSubtasks";

const semesterMonths = ["2026-09", "2026-10", "2026-11", "2026-12"];

type SubtasksByTest = Record<string, TestSubtask[]>;

export function TestSchedulePage({ onBack }: { onBack: () => void }) {
  const [calendarTasks, setCalendarTasks] = useState<PersonalTask[]>([]);
  const [subtasks, setSubtasks] = useState<SubtasksByTest>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [addingForTest, setAddingForTest] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const monthlyTasks = await Promise.all(semesterMonths.map((month) => loadCalendarTasks(month)));
        const uniqueTasks = new Map<string, PersonalTask>();
        monthlyTasks.flat().forEach((task) => {
          if (!task.isPriority && getPersonalTaskCategory(task) === "test") uniqueTasks.set(task.id, task);
        });
        const tests = [...uniqueTasks.values()].sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
        const loadedSubtasks = await Promise.all(tests.map(async (test) => [test.id, await loadTestSubtasks(test.id)] as const));
        if (cancelled) return;
        setCalendarTasks(tests);
        setSubtasks(Object.fromEntries(loadedSubtasks));
      } catch {
        if (!cancelled) setError("Test Schedule could not be loaded. Please try again.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const pendingCount = useMemo(() => calendarTasks.reduce((count, task) => count + (task.completed ? 0 : 1), 0), [calendarTasks]);

  async function submitSubtask(testTaskId: string) {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    setIsSaving(true);
    setError("");
    try {
      const saved = await createTestSubtask(testTaskId, title);
      setSubtasks((current) => ({ ...current, [testTaskId]: [...(current[testTaskId] ?? []), saved] }));
      setNewSubtaskTitle("");
      setAddingForTest(null);
    } catch {
      setError("The subtask could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSubtask(testTaskId: string, subtask: TestSubtask) {
    const previous = subtasks[testTaskId] ?? [];
    const next = { ...subtask, completed: !subtask.completed };
    setSubtasks((current) => ({ ...current, [testTaskId]: previous.map((item) => item.id === subtask.id ? next : item) }));
    try {
      const saved = await updateTestSubtask(subtask.id, { completed: next.completed });
      setSubtasks((current) => ({ ...current, [testTaskId]: (current[testTaskId] ?? []).map((item) => item.id === saved.id ? saved : item) }));
    } catch {
      setSubtasks((current) => ({ ...current, [testTaskId]: previous }));
      setError("The subtask completion could not be updated.");
    }
  }

  async function removeSubtask(testTaskId: string, subtask: TestSubtask) {
    const previous = subtasks[testTaskId] ?? [];
    setSubtasks((current) => ({ ...current, [testTaskId]: previous.filter((item) => item.id !== subtask.id) }));
    try {
      await deleteTestSubtask(subtask.id);
    } catch {
      setSubtasks((current) => ({ ...current, [testTaskId]: previous }));
      setError("The subtask could not be deleted.");
    }
  }

  return <main className="test-schedule-shell">
    <header className="test-schedule-header">
      <button type="button" className="portal-return-button" onClick={onBack}><ArrowLeft size={16} />Back to Personal Workspace</button>
      <div><span>Personal Test Planner</span><h1>Test Schedule</h1><p>Fall 2026 · {pendingCount} test{pendingCount === 1 ? "" : "s"} to review</p></div>
    </header>
    {error ? <p className="personal-workspace-error">{error}</p> : null}
    {isLoading ? <p className="personal-workspace-loading">Loading Test Schedule...</p> : null}
    {!isLoading && calendarTasks.length === 0 ? <section className="test-schedule-empty"><h2>No Test tasks yet</h2><p>Add a calendar task with category Test to see it here.</p></section> : null}
    <section className="test-schedule-list">
      {calendarTasks.map((testTask) => <article key={testTask.id} className={`test-schedule-card${testTask.completed ? " is-complete" : ""}`}>
        <div className="test-schedule-card-heading">
          <div><span className="test-schedule-category">Test</span><h2>{testTask.title}</h2><time>{testTask.date}</time></div>
          <span className="test-schedule-status">{testTask.completed ? "Completed" : "Upcoming"}</span>
        </div>
        {testTask.description ? <p className="test-schedule-description">{testTask.description}</p> : null}
        <div className="test-subtask-list">
          {(subtasks[testTask.id] ?? []).map((subtask) => <div key={subtask.id} className={`test-subtask-row${subtask.completed ? " is-complete" : ""}`}>
            <button type="button" className="test-subtask-check" onClick={() => void toggleSubtask(testTask.id, subtask)} aria-label={`${subtask.completed ? "Mark incomplete" : "Mark complete"}: ${subtask.title}`}>{subtask.completed ? <Check size={15} /> : null}</button>
            <span>{subtask.title}</span>
            <button type="button" className="test-subtask-delete" onClick={() => void removeSubtask(testTask.id, subtask)} aria-label={`Delete subtask ${subtask.title}`}><Trash2 size={14} /></button>
          </div>)}
        </div>
        {addingForTest === testTask.id ? <div className="test-subtask-add-form">
          <input autoFocus value={newSubtaskTitle} placeholder="Add a preparation task" onChange={(event) => setNewSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitSubtask(testTask.id); } }} />
          <button type="button" className="submit-button test-subtask-save" onClick={() => void submitSubtask(testTask.id)} disabled={isSaving || !newSubtaskTitle.trim()}>Save</button>
          <button type="button" className="test-subtask-cancel" onClick={() => { setAddingForTest(null); setNewSubtaskTitle(""); }} aria-label="Cancel add subtask"><X size={16} /></button>
        </div> : <button type="button" className="test-subtask-add-button" onClick={() => { setAddingForTest(testTask.id); setNewSubtaskTitle(""); }}><Plus size={15} />Add subtask</button>}
      </article>)}
    </section>
  </main>;
}
