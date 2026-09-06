import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { getLocalDateKey, getMonthGrid, getMonthLabel, getPersonalTaskCategory, type PersonalTask } from "./personalTasks";

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PersonalCalendarPlanner({ month, tasks, onMonthChange, onCreateForDate, onViewDate, onEditTask, onDeleteTask }: {
  month: string;
  tasks: PersonalTask[];
  onMonthChange: (direction: -1 | 1 | "today") => void;
  onCreateForDate: (date: string) => void;
  onViewDate: (date: string) => void;
  onEditTask: (task: PersonalTask) => void;
  onDeleteTask: (task: PersonalTask) => void;
}) {
  const tasksByDate = new Map<string, PersonalTask[]>();
  tasks.forEach((task) => tasksByDate.set(task.date, [...(tasksByDate.get(task.date) ?? []), task]));
  const today = getLocalDateKey();

  return <section className="personal-calendar-card">
    <div className="personal-section-heading"><div><span>Personal Planner</span><h1>{getMonthLabel(month)}</h1></div><div className="personal-calendar-controls">
      <button className="icon-button" type="button" onClick={() => onMonthChange(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
      <button className="personal-today-button" type="button" onClick={() => onMonthChange("today")}>Today</button>
      <button className="icon-button" type="button" onClick={() => onMonthChange(1)} aria-label="Next month"><ChevronRight size={18} /></button>
    </div></div>
    <div className="personal-calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
    <div className="personal-calendar-grid">{getMonthGrid(month).map((date, index) => {
      if (!date) return <div key={`empty-${index}`} className="personal-calendar-blank" />;
      const dayTasks = tasksByDate.get(date) ?? [];
      return <section key={date} className={`personal-calendar-day${date === today ? " is-today" : ""}`} onDoubleClick={() => onViewDate(date)} title="Double-click to view this day's tasks">
        <div className="personal-calendar-date" onDoubleClick={() => onViewDate(date)} title="Double-click the date to view this day's tasks"><span>{Number(date.slice(-2))}</span><button className="personal-calendar-add" type="button" onClick={(event) => { event.stopPropagation(); onCreateForDate(date); }} aria-label={`Create a task for ${date}`}><Plus size={14} /></button></div>
        <div className="personal-calendar-task-list">{dayTasks.slice(0, 2).map((task) => <div key={task.id} className="personal-calendar-task-row">
          <button type="button" className={`personal-calendar-task category-${getPersonalTaskCategory(task)} ${task.completed ? "is-complete" : ""}`} onClick={(event) => { event.stopPropagation(); onEditTask(task); }}>{task.title}</button>
          <button type="button" className="personal-calendar-delete" onClick={(event) => { event.stopPropagation(); onDeleteTask(task); }} aria-label={`Delete ${task.title}`} title="Delete task"><Trash2 size={12} /></button>
        </div>)}{dayTasks.length > 2 ? <span className="personal-calendar-more">+{dayTasks.length - 2}</span> : null}</div>
      </section>;
    })}</div>
  </section>;
}
