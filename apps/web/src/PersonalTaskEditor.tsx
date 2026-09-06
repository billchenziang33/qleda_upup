import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { getPersonalTaskCategory, type PersonalTask, type PersonalTaskCategory, type PersonalTaskDraft, type PersonalTaskPriority } from "./personalTasks";

const priorityOptions: Array<{ value: PersonalTaskPriority; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];

const categoryOptions: Array<{ value: PersonalTaskCategory; label: string }> = [
  { value: "class", label: "Class — Lecture / Tutorial" },
  { value: "homework", label: "Homework — 作业 / Due time" },
  { value: "test", label: "Test — Midterm / Quiz / Final" },
  { value: "extracurricular", label: "Extracurricular — 课外活动" }
];

export function PersonalTaskEditor({ task, date, isPriority, isSaving, onClose, onSave }: {
  task: PersonalTask | null;
  date: string;
  isPriority: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: PersonalTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PersonalTaskDraft>(() => ({ title: task?.title ?? "", description: task?.description ?? "", date: task?.date ?? date, priority: task?.priority ?? "medium", category: task ? getPersonalTaskCategory(task) : "homework", isPriority: task?.isPriority ?? isPriority }));
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim()) { setError("Add a task title before saving."); return; }
    setError("");
    await onSave({ ...draft, title: draft.title.trim(), description: draft.description.trim() });
  }

  return <div className="modal-backdrop personal-task-editor-backdrop" role="presentation">
    <form className="student-form personal-task-editor" onSubmit={(event) => void submit(event)}>
      <div className="form-header"><div><span className="eyebrow">Personal Task</span><h2>{task ? "Edit task" : "New task"}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close task editor"><X size={20} /></button></div>
      <label>Task title<input autoFocus value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
      <label>Date<input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label>
      <label>Priority<select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as PersonalTaskPriority }))}>{priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Category<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as PersonalTaskCategory }))}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Description (optional)<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="submit-button" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save task"}</button>
    </form>
  </div>;
}
