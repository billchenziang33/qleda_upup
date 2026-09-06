import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { sortPersonalTasks, type PersonalTask } from "./personalTasks";

const priorityLabels = { high: "High", medium: "Medium", low: "Low" };

export function PriorityTodoPanel({ tasks, onToggle, onEdit, onDelete, onCreateTask }: {
  tasks: PersonalTask[];
  onToggle: (task: PersonalTask) => void;
  onEdit: (task: PersonalTask) => void;
  onDelete: (task: PersonalTask) => void;
  onCreateTask: () => void;
}) {
  const sortedTasks = sortPersonalTasks(tasks);
  return <aside className="priority-todo-panel">
    <div className="personal-section-heading"><div><span>Personal Todo</span><h1>Priority tasks</h1></div><button className="personal-add-task-button" type="button" onClick={onCreateTask}><Plus size={16} />Add task</button></div>
    {sortedTasks.length === 0 ? <p className="personal-empty">No priority tasks yet.</p> : null}
    <div className="priority-todo-list">
      {sortedTasks.map((task) => <article key={task.id} className={`priority-todo-item priority-${task.priority}${task.completed ? " is-complete" : ""}`}>
        <button className="priority-check" type="button" onClick={() => onToggle(task)} aria-label={`Mark ${task.title} ${task.completed ? "incomplete" : "complete"}`}>{task.completed ? <Check size={16} /> : null}</button>
        <button className="priority-task-copy" type="button" onClick={() => onEdit(task)}><span>{task.title}</span><small>{task.date}{task.description ? ` - ${task.description}` : ""}</small></button>
        <span className="priority-chip">{priorityLabels[task.priority]}</span>
        <button className="priority-action" type="button" onClick={() => onEdit(task)} aria-label={`Edit ${task.title}`}><Pencil size={15} /></button>
        <button className="priority-action danger" type="button" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`}><Trash2 size={15} /></button>
      </article>)}
    </div>
  </aside>;
}
