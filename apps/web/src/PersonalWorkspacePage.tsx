import { ArrowLeft, CalendarDays, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PersonalCalendarPlanner } from "./PersonalCalendarPlanner";
import { PersonalTaskEditor } from "./PersonalTaskEditor";
import { PriorityTodoPanel } from "./PriorityTodoPanel";
import { TestSchedulePage } from "./TestSchedulePage";
import { createPersonalTask, deletePersonalTask, getMonthKey, getPersonalTaskCategory, loadCalendarTasks, loadPriorityTasks, shiftMonth, updatePersonalTask, type PersonalTask, type PersonalTaskDraft, type PersonalTaskCategory } from "./personalTasks";

const categoryLabels: Record<PersonalTaskCategory, string> = {
  class: "Class",
  homework: "Homework",
  test: "Test",
  extracurricular: "Extracurricular"
};

export function PersonalWorkspacePage({ onExit }: { onExit: () => void }) {
  const isTestScheduleView = new URLSearchParams(window.location.search).get("view") === "test-schedule";
  const [month, setMonth] = useState(getMonthKey());
  const [calendarTasks, setCalendarTasks] = useState<PersonalTask[]>([]);
  const [priorityTasks, setPriorityTasks] = useState<PersonalTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PersonalTask | null>(null);
  const [dayDetailsDate, setDayDetailsDate] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<PersonalTask | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);

  const refresh = useCallback(async (nextMonth: string) => {
    setIsLoading(true);
    setError("");
    try {
      const [nextCalendarTasks, nextPriorityTasks] = await Promise.all([loadCalendarTasks(nextMonth), loadPriorityTasks()]);
      setCalendarTasks(nextCalendarTasks);
      setPriorityTasks(nextPriorityTasks);
    } catch {
      setError("Personal tasks could not be loaded. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(month); }, [month, refresh]);

  function openCreate(date: string, isPriority = false) { setEditingTask(null); setEditorDate(date); setEditorIsPriority(isPriority); setIsEditorOpen(true); }
  function openEdit(task: PersonalTask) { setEditingTask(task); setEditorDate(task.date); setEditorIsPriority(task.isPriority); setIsEditorOpen(true); }
  const [editorIsPriority, setEditorIsPriority] = useState(false);
  function closeEditor() { setEditorDate(null); setEditingTask(null); setEditorIsPriority(false); setIsEditorOpen(false); }

  async function saveTask(draft: PersonalTaskDraft) {
    setIsSaving(true);
    setError("");
    try {
      if (editingTask) {
        const previous = editingTask.isPriority ? priorityTasks : calendarTasks;
        const optimistic = { ...editingTask, ...draft, updatedAt: new Date().toISOString() };
        const setCurrentTasks = editingTask.isPriority ? setPriorityTasks : setCalendarTasks;
        setCurrentTasks((current) => current.map((task) => task.id === optimistic.id ? optimistic : task));
        try {
          const saved = await updatePersonalTask(editingTask.id, draft);
          setCurrentTasks((current) => current.map((task) => task.id === saved.id ? saved : task));
        } catch (saveError) {
          setCurrentTasks(previous);
          throw saveError;
        }
      } else {
        const saved = await createPersonalTask(draft);
        (saved.isPriority ? setPriorityTasks : setCalendarTasks)((current) => [...current, saved]);
      }
      closeEditor();
    } catch {
      setError("Personal task could not be saved. No changes were kept.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleTask(task: PersonalTask) {
    const setCurrentTasks = task.isPriority ? setPriorityTasks : setCalendarTasks;
    const previous = task.isPriority ? priorityTasks : calendarTasks;
    const optimistic = { ...task, completed: !task.completed, updatedAt: new Date().toISOString() };
    setCurrentTasks((current) => current.map((item) => item.id === task.id ? optimistic : item));
    try {
      const saved = await updatePersonalTask(task.id, { completed: optimistic.completed });
      setCurrentTasks((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch {
      setCurrentTasks(previous);
      setError("Task completion could not be updated. The previous state was restored.");
    }
  }

  function requestDelete(task: PersonalTask) {
    setDeleteCandidate(task);
  }

  async function confirmDelete() {
    if (!deleteCandidate) return;
    const task = deleteCandidate;
    const setCurrentTasks = task.isPriority ? setPriorityTasks : setCalendarTasks;
    const previous = task.isPriority ? priorityTasks : calendarTasks;
    setIsDeletingTask(true);
    setCurrentTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      await deletePersonalTask(task.id);
      setDeleteCandidate(null);
    } catch {
      setCurrentTasks(previous);
      setError("Personal task could not be deleted. The previous state was restored.");
    } finally {
      setIsDeletingTask(false);
    }
  }

  if (isTestScheduleView) return <TestSchedulePage onBack={() => { window.location.href = "?personal=1"; }} />;

  return <main className="personal-workspace-shell">
    <header className="personal-workspace-header">
      <button type="button" className="portal-return-button" onClick={onExit}><ArrowLeft size={16} />Back to dashboard</button>
      <div className="personal-workspace-title-group"><div><span>Private QLEDA Workspace</span><h1>Personal workspace</h1></div><button type="button" className="personal-test-schedule-button" onClick={() => { window.location.href = "?personal=1&view=test-schedule" }}>Test Schedule</button></div>
      <button type="button" className="personal-refresh-button" onClick={() => void refresh(month)} disabled={isLoading} aria-label="点击以刷新 Task" title="点击以刷新 Task">
        <span>点击以刷新 Task</span>
        <CalendarDays size={24} />
        {isLoading ? <RefreshCw className="personal-refresh-spinner" size={14} aria-hidden="true" /> : null}
      </button>
    </header>
    {error ? <p className="personal-workspace-error">{error}</p> : null}
    <div className="personal-workspace-grid">
      <PersonalCalendarPlanner month={month} tasks={calendarTasks} onCreateForDate={openCreate} onViewDate={setDayDetailsDate} onEditTask={openEdit} onDeleteTask={requestDelete} onMonthChange={(direction) => setMonth(direction === "today" ? getMonthKey() : shiftMonth(month, direction))} />
      <PriorityTodoPanel tasks={priorityTasks} onToggle={(task) => void toggleTask(task)} onEdit={openEdit} onDelete={requestDelete} onCreateTask={() => openCreate("", true)} />
    </div>
    {isLoading ? <p className="personal-workspace-loading">Loading personal tasks...</p> : null}
    {isEditorOpen ? <PersonalTaskEditor key={editingTask?.id ?? editorDate ?? "undated"} task={editingTask} date={editorDate ?? ""} isPriority={editorIsPriority} isSaving={isSaving} onClose={closeEditor} onSave={saveTask} /> : null}
    {dayDetailsDate ? <div className="modal-backdrop" role="presentation" onClick={() => setDayDetailsDate(null)}>
      <div className="personal-day-details" role="dialog" aria-modal="true" aria-labelledby="personal-day-details-title" onClick={(event) => event.stopPropagation()}>
        <div className="form-header">
          <div><p className="eyebrow">Calendar Tasks</p><h2 id="personal-day-details-title">{dayDetailsDate}</h2></div>
          <button type="button" className="icon-button" onClick={() => setDayDetailsDate(null)} aria-label="Close day details"><X size={18} /></button>
        </div>
        {calendarTasks.filter((task) => task.date === dayDetailsDate && !task.isPriority).length === 0 ? <p className="personal-day-details-empty">这一天没有日历任务。</p> : <div className="personal-day-details-list">
          {calendarTasks.filter((task) => task.date === dayDetailsDate && !task.isPriority).map((task) => <article key={task.id} className={`personal-day-details-item category-${getPersonalTaskCategory(task)}`}>
            <div className="personal-day-details-item-heading"><div><h3>{task.title}</h3><span>{categoryLabels[getPersonalTaskCategory(task)]} · {task.completed ? "Completed" : "Pending"} · {task.priority}</span></div><button type="button" className="ghost-action" onClick={() => { setDayDetailsDate(null); openEdit(task); }}>Edit</button></div>
            <p>{task.description || "No additional description."}</p>
          </article>)}
        </div>}
      </div>
    </div> : null}
    {deleteCandidate ? <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-delete-title">
        <div className="form-header">
          <div><p className="eyebrow">Delete Personal Task</p><h2 id="personal-delete-title">确认删除这个任务？</h2></div>
          <button type="button" className="icon-button" onClick={() => setDeleteCandidate(null)} aria-label="Close delete confirmation"><X size={18} /></button>
        </div>
        <p>“{deleteCandidate.title}”删除后将从当前列表和云端数据库中移除，此操作不能撤销。</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="confirm-actions">
          <button className="ghost-action" type="button" onClick={() => setDeleteCandidate(null)} disabled={isDeletingTask}>取消</button>
          <button className="danger-action" type="button" onClick={() => void confirmDelete()} disabled={isDeletingTask}>{isDeletingTask ? "删除中..." : "确认删除"}</button>
        </div>
      </div>
    </div> : null}
  </main>;
}
