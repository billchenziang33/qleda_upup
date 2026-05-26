import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  Camera,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  ImageDown,
  Loader2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import {
  createParentExport,
  createStudent,
  createTask,
  deleteStudent,
  deleteTask,
  getDashboard,
  updateTask,
  uploadTaskFile
} from "./api";
import type { CreateStudentInput, CreateTaskInput, DashboardData, Priority, Student, TaskStatus, TaskType } from "./types";

const priorityLabels: Record<Priority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const statusLabels: Record<TaskStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  submitted: "已提交",
  reviewed: "已批改",
  completed: "已完成"
};

const typeLabels: Record<TaskType, string> = {
  reading: "阅读",
  listening: "听力",
  writing: "写作",
  speaking: "口语",
  vocabulary: "单词",
  grammar: "语法"
};

const emptyStudentForm: CreateStudentInput = {
  name: "",
  grade: "",
  targetScore: 6.5,
  currentLevel: "",
  group: ""
};

const emptyTaskForm: CreateTaskInput = {
  studentId: "",
  title: "",
  type: "reading",
  priority: "medium",
  dueDate: new Date().toISOString().slice(0, 10),
  description: "",
  pinned: false
};

type PortalMode = "landing" | "teacher-login" | "teacher" | "student";

function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [portalMode, setPortalMode] = useState<PortalMode>("landing");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherLoginError, setTeacherLoginError] = useState("");
  const [studentPortalId, setStudentPortalId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [locatedTaskId, setLocatedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isStudentFormOpen, setIsStudentFormOpen] = useState(false);
  const [studentForm, setStudentForm] = useState<CreateStudentInput>(emptyStudentForm);
  const [studentFormError, setStudentFormError] = useState("");
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<CreateTaskInput>(emptyTaskForm);
  const [taskFormError, setTaskFormError] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [correctionTaskId, setCorrectionTaskId] = useState<string | null>(null);
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [deleteStudentId, setDeleteStudentId] = useState<string | null>(null);
  const [deleteStudentError, setDeleteStudentError] = useState("");
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);

  async function loadDashboard() {
    try {
      setError("");
      setDashboard(await getDashboard());
    } catch {
      setError("后端服务暂时不可用，请确认 API 已经启动。");
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!locatedTaskId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`task-${locatedTaskId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [locatedTaskId, selectedStudentId]);

  function locateTask(taskId: string, studentId: string) {
    setSelectedStudentId(studentId);
    setLocatedTaskId(taskId);
  }

  function locatePendingReviewTask() {
    const task = dashboard?.tasks.find((item) => item.status === "submitted");
    if (!task) return;
    locateTask(task.id, task.studentId);
  }

  async function handleExport(taskId: string) {
    setBusyTaskId(taskId);
    const exportRecord = await createParentExport(taskId);
    await loadDashboard();
    const downloadLink = document.createElement("a");
    downloadLink.href = exportRecord.imageUrl;
    downloadLink.download = exportRecord.title;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    setBusyTaskId(null);
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudentFormError("");
    setIsSavingStudent(true);

    try {
      const student = await createStudent({
        ...studentForm,
        targetScore: Number(studentForm.targetScore),
        teacherId: "u-teacher-lin",
        assistantId: "u-assistant-chen"
      });
      await loadDashboard();
      setSelectedStudentId(student.id);
      setLocatedTaskId(null);
      setStudentForm(emptyStudentForm);
      setIsStudentFormOpen(false);
    } catch {
      setStudentFormError("学生信息保存失败，请检查后端服务和表单内容。");
    } finally {
      setIsSavingStudent(false);
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTaskFormError("");
    setIsSavingTask(true);

    try {
      const task = await createTask(taskForm);
      await loadDashboard();
      setSelectedStudentId(task.studentId);
      setLocatedTaskId(task.id);
      setTaskForm({
        ...emptyTaskForm,
        studentId: taskForm.studentId,
        dueDate: new Date().toISOString().slice(0, 10)
      });
      setIsTaskFormOpen(false);
    } catch {
      setTaskFormError("任务保存失败，请检查学生、标题和截止日期。");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function handleUploadCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correctionTaskId || !correctionFile) {
      setCorrectionError("请先选择批改后的作业文件。");
      return;
    }

    const task = dashboard?.tasks.find((item) => item.id === correctionTaskId);
    setCorrectionError("");
    setIsSavingCorrection(true);

    try {
      await uploadTaskFile(correctionTaskId, {
        file: correctionFile,
        uploaderId: "u-assistant-chen",
        uploaderRole: "assistant"
      });
      await updateTask(correctionTaskId, {
        status: "reviewed",
        assistantNote: correctionNote || "助教已上传批改结果。"
      });
      await loadDashboard();
      if (task) locateTask(task.id, task.studentId);
      setCorrectionTaskId(null);
      setCorrectionFile(null);
      setCorrectionNote("");
    } catch {
      setCorrectionError("批改上传失败，请确认文件和后端服务正常。");
    } finally {
      setIsSavingCorrection(false);
    }
  }

  async function handleDeleteTask() {
    if (!deleteTaskId) return;
    setDeleteError("");
    setIsDeletingTask(true);

    try {
      await deleteTask(deleteTaskId);
      await loadDashboard();
      if (locatedTaskId === deleteTaskId) setLocatedTaskId(null);
      setDeleteTaskId(null);
    } catch {
      setDeleteError("删除任务失败，请确认后端服务正常。");
    } finally {
      setIsDeletingTask(false);
    }
  }

  async function handleDeleteStudent() {
    if (!deleteStudentId) return;
    setDeleteStudentError("");
    setIsDeletingStudent(true);

    try {
      await deleteStudent(deleteStudentId);
      await loadDashboard();
      if (selectedStudentId === deleteStudentId) {
        setSelectedStudentId("all");
        setLocatedTaskId(null);
      }
      setDeleteStudentId(null);
    } catch {
      setDeleteStudentError("删除学生失败，请确认后端服务正常。");
    } finally {
      setIsDeletingStudent(false);
    }
  }

  function openTaskForm() {
    const fallbackStudentId = dashboard?.students[0]?.id ?? "";
    setTaskForm({
      ...emptyTaskForm,
      studentId: selectedStudentId === "all" ? fallbackStudentId : selectedStudentId
    });
    setTaskFormError("");
    setIsTaskFormOpen(true);
  }

  function openCorrectionForm(taskId: string) {
    setCorrectionTaskId(taskId);
    setCorrectionFile(null);
    setCorrectionNote("");
    setCorrectionError("");
  }

  function handleTeacherLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (teacherPassword === "qleda123456") {
      setTeacherLoginError("");
      setTeacherPassword("");
      setPortalMode("teacher");
      return;
    }
    setTeacherLoginError("密码不正确，请重新输入。");
  }

  if (!dashboard) {
    return (
      <main className="boot-screen">
        <Loader2 className="spin" size={34} />
        <p>{error || "正在连接 QLEDA 教学任务中心..."}</p>
      </main>
    );
  }

  if (portalMode === "landing") {
    return <LandingPortal onTeacher={() => setPortalMode("teacher-login")} onStudent={() => setPortalMode("student")} />;
  }

  if (portalMode === "teacher-login") {
    return (
      <TeacherLoginPortal
        password={teacherPassword}
        error={teacherLoginError}
        onPasswordChange={setTeacherPassword}
        onSubmit={handleTeacherLogin}
        onBack={() => {
          setTeacherLoginError("");
          setTeacherPassword("");
          setPortalMode("landing");
        }}
      />
    );
  }

  if (portalMode === "student") {
    return (
      <StudentPortal
        dashboard={dashboard}
        selectedStudentId={studentPortalId}
        onStudentChange={setStudentPortalId}
        onBack={() => setPortalMode("landing")}
      />
    );
  }

  const selectedStudentTasks =
    selectedStudentId === "all"
      ? dashboard.tasks
      : dashboard.tasks.filter((task) => task.studentId === selectedStudentId);
  const correctionTask = correctionTaskId ? dashboard.tasks.find((task) => task.id === correctionTaskId) : undefined;

  return (
    <main className="app-shell">
      <button
        type="button"
        className="portal-return-button"
        onClick={() => {
          setPortalMode("landing");
          setTeacherLoginError("");
          setTeacherPassword("");
        }}
      >
        <ArrowLeft size={16} />
        返回主界面
      </button>
      <section className="hero-card">
        <div className="brand-title-wrap" aria-label="QLEDA">
          <p className="brand-kicker">IELTS Teaching Operations</p>
          <h1 className="brand-title">
            <span>Q</span>
            <span>L</span>
            <span>E</span>
            <span>D</span>
            <span>A</span>
          </h1>
          <p className="brand-subtitle">Teaching task flow</p>
        </div>
        <div className="hero-panel">
          <Sparkles size={28} />
          <strong>今日重点</strong>
          <span>{dashboard.summary.pendingReview} 个任务等待批改，已上传 {dashboard.taskFiles.length} 个任务文件。</span>
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={<GraduationCap />} label="学生数量" value={dashboard.summary.studentCount} />
        <Metric
          icon={<ClipboardList />}
          label="进行中任务"
          value={dashboard.summary.activeTasks}
          helper="查看全部学生任务"
          onClick={() => {
            setSelectedStudentId("all");
            setLocatedTaskId(null);
          }}
        />
        <Metric
          icon={<BookOpenCheck />}
          label="待批改"
          value={dashboard.summary.pendingReview}
          helper="跳转到对应学生任务"
          onClick={locatePendingReviewTask}
        />
        <Metric icon={<Camera />} label="已上传文件" value={dashboard.taskFiles.length} helper="包含作业和批改文件" />
      </section>

      <section className="workspace">
        <aside className="side-card">
          <div className="section-heading">
            <span>学生档案</span>
            <ShieldCheck size={18} />
          </div>
          <button className="add-student-button" onClick={() => setIsStudentFormOpen(true)}>
            <Plus size={17} />
            添加学生
          </button>
          <button
            className={selectedStudentId === "all" ? "student-item active" : "student-item"}
            onClick={() => {
              setSelectedStudentId("all");
              setLocatedTaskId(null);
            }}
          >
            <strong>全部学生</strong>
            <small>查看机构任务池</small>
          </button>
          {dashboard.students.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              active={student.id === selectedStudentId}
              onSelect={() => {
                setSelectedStudentId(student.id);
                setLocatedTaskId(null);
              }}
              onDelete={() => setDeleteStudentId(student.id)}
            />
          ))}
        </aside>

        <section className="task-board">
          <div className="board-header">
            <div>
              <p className="eyebrow">Priority Queue</p>
              <h2>任务优先级队列</h2>
              <p className="board-hint">助教可以在任务卡片中上传批改后的作业，并把任务状态更新为已批改。</p>
            </div>
            <button className="primary-action" onClick={openTaskForm}>
              <UploadCloud size={18} />
              新建任务
            </button>
          </div>

          <div className="task-list">
            {selectedStudentTasks.length === 0 && (
              <div className="empty-state">
                <strong>当前学生还没有任务</strong>
                <span>可以新建任务，或者选择其他学生档案查看。</span>
              </div>
            )}
            {selectedStudentTasks.map((task) => {
              const student = dashboard.students.find((item) => item.id === task.studentId);
              const files = dashboard.taskFiles.filter((file) => file.taskId === task.id);
              return (
                <article
                  id={`task-${task.id}`}
                  key={task.id}
                  className={locatedTaskId === task.id ? "task-card located" : "task-card"}
                >
                  <button className="delete-task-button" onClick={() => setDeleteTaskId(task.id)} aria-label="删除任务">
                    <X size={16} />
                  </button>
                  <div className="task-main">
                    <div className="task-title-row">
                      <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
                      {task.pinned && <span className="pin">老师置顶</span>}
                      <span className="status">{statusLabels[task.status]}</span>
                      {locatedTaskId === task.id && <span className="located-badge">已定位</span>}
                    </div>
                    <h3>{task.title}</h3>
                    <p>{task.description}</p>
                    <div className="task-meta">
                      <span>{student?.name}</span>
                      <span>{typeLabels[task.type]}</span>
                      <span>截止 {task.dueDate}</span>
                      {task.score && <span>{task.score}</span>}
                    </div>
                    {task.teacherComment && <blockquote>{task.teacherComment}</blockquote>}
                    {task.assistantNote && <blockquote>{task.assistantNote}</blockquote>}
                  </div>

                  <div className="task-actions">
                    <div className="file-stack">
                      {files.length ? (
                        files.map((file) => (
                          <a key={file.id} href={file.url} target="_blank" rel="noreferrer">
                            {file.fileType.startsWith("image/") && (
                              <img className="file-preview" src={file.url} alt={file.name} />
                            )}
                            <span>{file.name}</span>
                          </a>
                        ))
                      ) : (
                        <span>暂无附件</span>
                      )}
                    </div>
                    <button onClick={() => openCorrectionForm(task.id)} disabled={busyTaskId === task.id}>
                      <Camera size={16} />
                      上传批改
                    </button>
                    <button onClick={() => void handleExport(task.id)} disabled={busyTaskId === task.id}>
                      <ImageDown size={16} />
                      导出给家长
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section className="flow-grid">
        <FlowCard icon={<UploadCloud />} title="老师布置任务" text="上传讲义、说明要求，设置优先级和截止日期。" />
        <FlowCard icon={<Camera />} title="助教上传批改" text="助教拍照或上传批改后的作业，并填写批改备注。" />
        <FlowCard icon={<CheckCircle2 />} title="任务状态流转" text="提交后等待批改，上传批改后自动进入已批改状态。" />
        <FlowCard icon={<ImageDown />} title="家长反馈长图" text="后续可把批改图片、评语和下一步建议合成 PNG/JPG。" />
      </section>

      {isStudentFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleCreateStudent(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Student Profile</p>
                <h2>添加学生档案</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsStudentFormOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <label>
              学生姓名
              <input
                required
                value={studentForm.name}
                onChange={(event) => setStudentForm({ ...studentForm, name: event.target.value })}
                placeholder="例如：Luna Wang"
              />
            </label>
            <label>
              年级
              <input
                required
                value={studentForm.grade}
                onChange={(event) => setStudentForm({ ...studentForm, grade: event.target.value })}
                placeholder="例如：高二 / 大一"
              />
            </label>
            <label>
              雅思目标分
              <input
                required
                min="0"
                max="9"
                step="0.5"
                type="number"
                value={studentForm.targetScore}
                onChange={(event) => setStudentForm({ ...studentForm, targetScore: Number(event.target.value) })}
              />
            </label>
            <label>
              当前水平
              <input
                required
                value={studentForm.currentLevel}
                onChange={(event) => setStudentForm({ ...studentForm, currentLevel: event.target.value })}
                placeholder="例如：阅读 5.5 / 写作 5.0"
              />
            </label>
            <label>
              分组
              <input
                required
                value={studentForm.group}
                onChange={(event) => setStudentForm({ ...studentForm, group: event.target.value })}
                placeholder="例如：VIP 一对一 / 写作班"
              />
            </label>

            {studentFormError && <p className="form-error">{studentFormError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingStudent}>
              {isSavingStudent ? "保存中..." : "保存到学生档案"}
            </button>
          </form>
        </div>
      )}

      {isTaskFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleCreateTask(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Task Setup</p>
                <h2>新建学生任务</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsTaskFormOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <label>
              选择学生
              <select
                required
                value={taskForm.studentId}
                onChange={(event) => setTaskForm({ ...taskForm, studentId: event.target.value })}
              >
                {dashboard.students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              任务标题
              <input
                required
                value={taskForm.title}
                onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                placeholder="例如：Cambridge 18 Test 3 Reading Passage 2"
              />
            </label>
            <label>
              任务类型
              <select
                value={taskForm.type}
                onChange={(event) => setTaskForm({ ...taskForm, type: event.target.value as TaskType })}
              >
                <option value="reading">阅读</option>
                <option value="listening">听力</option>
                <option value="writing">写作</option>
                <option value="speaking">口语</option>
                <option value="vocabulary">单词</option>
                <option value="grammar">语法</option>
              </select>
            </label>
            <label>
              优先级
              <select
                value={taskForm.priority}
                onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value as Priority })}
              >
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
            </label>
            <label>
              截止日期
              <input
                required
                type="date"
                value={taskForm.dueDate}
                onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })}
              />
            </label>
            <label>
              任务说明
              <textarea
                required
                value={taskForm.description}
                onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })}
                placeholder="例如：先完成题目，再订正错题并标注定位句。"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={taskForm.pinned}
                onChange={(event) => setTaskForm({ ...taskForm, pinned: event.target.checked })}
              />
              老师置顶
            </label>

            {taskFormError && <p className="form-error">{taskFormError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingTask || !dashboard.students.length}>
              {isSavingTask ? "保存中..." : "保存到任务列表"}
            </button>
          </form>
        </div>
      )}

      {correctionTask && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleUploadCorrection(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Correction Upload</p>
                <h2>上传批改结果</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setCorrectionTaskId(null)}>
                <X size={18} />
              </button>
            </div>

            <p className="form-context">{correctionTask.title}</p>
            <label>
              批改文件
              <input
                required
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(event) => setCorrectionFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              批改备注
              <textarea
                value={correctionNote}
                onChange={(event) => setCorrectionNote(event.target.value)}
                placeholder="例如：语法问题较多，第二段需要重写。"
              />
            </label>

            {correctionError && <p className="form-error">{correctionError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingCorrection}>
              {isSavingCorrection ? "上传中..." : "上传并标记已批改"}
            </button>
          </form>
        </div>
      )}

      {deleteTaskId && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog">
            <div className="form-header">
              <div>
                <p className="eyebrow">Delete Task</p>
                <h2>确认删除任务？</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setDeleteTaskId(null)}>
                <X size={18} />
              </button>
            </div>
            <p>
              删除后，这个任务会从数据库中移除；该任务下的附件记录和家长导出记录也会一起删除。这个操作不能撤销。
            </p>
            {deleteError && <p className="form-error">{deleteError}</p>}
            <div className="confirm-actions">
              <button className="ghost-action" type="button" onClick={() => setDeleteTaskId(null)}>
                取消
              </button>
              <button className="danger-action" type="button" onClick={() => void handleDeleteTask()} disabled={isDeletingTask}>
                {isDeletingTask ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteStudentId && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog">
            <div className="form-header">
              <div>
                <p className="eyebrow">Delete Student</p>
                <h2>确认删除学生？</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setDeleteStudentId(null)}>
                <X size={18} />
              </button>
            </div>
            <p>
              删除后，这个学生会从学生档案中移除；该学生的所有任务、附件记录和家长导出记录也会一起删除。这个操作不能撤销。
            </p>
            {deleteStudentError && <p className="form-error">{deleteStudentError}</p>}
            <div className="confirm-actions">
              <button className="ghost-action" type="button" onClick={() => setDeleteStudentId(null)}>
                取消
              </button>
              <button
                className="danger-action"
                type="button"
                onClick={() => void handleDeleteStudent()}
                disabled={isDeletingStudent}
              >
                {isDeletingStudent ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function BrandWord() {
  return (
    <div className="brand-title-wrap" aria-label="QLEDA">
      <p className="brand-kicker">IELTS Teaching Operations</p>
      <h1 className="brand-title">
        <span>Q</span>
        <span>L</span>
        <span>E</span>
        <span>D</span>
        <span>A</span>
      </h1>
      <p className="brand-subtitle">Teaching task flow</p>
    </div>
  );
}

function LandingPortal({ onTeacher, onStudent }: { onTeacher: () => void; onStudent: () => void }) {
  return (
    <main className="app-shell portal-shell">
      <section className="portal-hero">
        <BrandWord />
        <div className="portal-choice-panel">
          <p className="eyebrow">Choose Entrance</p>
          <h2>请选择进入身份</h2>
          <p>老师进入完整教学后台；学生进入自己的档案与任务队列。</p>
          <div className="portal-actions">
            <button className="portal-action-card teacher" onClick={onTeacher}>
              <LockKeyhole size={26} />
              <strong>老师入口</strong>
              <span>需要输入管理密码</span>
            </button>
            <button className="portal-action-card student" onClick={onStudent}>
              <UserRound size={26} />
              <strong>学生入口</strong>
              <span>查看学生档案和任务</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function TeacherLoginPortal({
  password,
  error,
  onPasswordChange,
  onSubmit,
  onBack
}: {
  password: string;
  error: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  return (
    <main className="app-shell portal-shell">
      <section className="portal-hero login-hero">
        <BrandWord />
        <form className="portal-login-card" onSubmit={onSubmit}>
          <button type="button" className="back-link" onClick={onBack}>
            <ArrowLeft size={16} />
            返回入口
          </button>
          <div className="login-icon">
            <LockKeyhole size={30} />
          </div>
          <p className="eyebrow">Teacher Access</p>
          <h2>老师后台密码</h2>
          <p>输入密码后进入完整任务管理界面。</p>
          <label>
            密码
            <input
              required
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="请输入老师密码"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="submit-button" type="submit">
            进入老师后台
          </button>
        </form>
      </section>
    </main>
  );
}

function StudentPortal({
  dashboard,
  selectedStudentId,
  onStudentChange,
  onBack
}: {
  dashboard: DashboardData;
  selectedStudentId: string;
  onStudentChange: (studentId: string) => void;
  onBack: () => void;
}) {
  const selectedStudent = dashboard.students.find((student) => student.id === selectedStudentId) ?? dashboard.students[0];
  const selectedTasks = selectedStudent ? dashboard.tasks.filter((task) => task.studentId === selectedStudent.id) : [];

  return (
    <main className="app-shell student-portal-shell">
      <button type="button" className="portal-return-button" onClick={onBack}>
        <ArrowLeft size={16} />
        返回主界面
      </button>
      <section className="hero-card student-portal-hero">
        <BrandWord />
        <div className="hero-panel">
          <UsersRound size={28} />
          <strong>学生任务中心</strong>
          <span>选择自己的档案后，只查看对应的学习任务队列。</span>
        </div>
      </section>

      <section className="student-portal-grid">
        <aside className="side-card student-only-card">
          <div className="section-heading">
            <span>学生档案</span>
            <ShieldCheck size={18} />
          </div>
          {dashboard.students.length === 0 && <p className="muted-copy">还没有学生档案，请先由老师添加。</p>}
          {dashboard.students.map((student) => (
            <button
              key={student.id}
              className={selectedStudent?.id === student.id ? "student-item active" : "student-item"}
              onClick={() => onStudentChange(student.id)}
            >
              <strong>{student.name}</strong>
              <small>
                {student.group} / 目标 {student.targetScore}
              </small>
              <em>{student.currentLevel}</em>
            </button>
          ))}
        </aside>

        <section className="task-board student-task-board">
          <div className="board-header">
            <div>
              <p className="eyebrow">Student Queue</p>
              <h2>{selectedStudent ? `${selectedStudent.name} 的任务队列` : "请选择学生档案"}</h2>
              <p className="board-hint">按老师设置的优先级、截止日期和置顶状态查看任务。</p>
            </div>
          </div>

          <div className="task-list">
            {selectedStudent && (
              <article className="profile-summary-card">
                <div>
                  <span>年级</span>
                  <strong>{selectedStudent.grade}</strong>
                </div>
                <div>
                  <span>目标分</span>
                  <strong>{selectedStudent.targetScore}</strong>
                </div>
                <div>
                  <span>当前水平</span>
                  <strong>{selectedStudent.currentLevel}</strong>
                </div>
              </article>
            )}
            {selectedTasks.length === 0 && (
              <div className="empty-state">
                <strong>当前还没有任务</strong>
                <span>老师布置任务后，会自动出现在这里。</span>
              </div>
            )}
            {selectedTasks.map((task) => {
              const files = dashboard.taskFiles.filter((file) => file.taskId === task.id);
              return (
                <article id={`student-task-${task.id}`} key={task.id} className="task-card student-task-card">
                  <div className="task-main">
                    <div className="task-title-row">
                      <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
                      {task.pinned && <span className="pin">老师置顶</span>}
                      <span className="status">{statusLabels[task.status]}</span>
                    </div>
                    <h3>{task.title}</h3>
                    <p>{task.description}</p>
                    <div className="task-meta">
                      <span>{typeLabels[task.type]}</span>
                      <span>截止 {task.dueDate}</span>
                      {task.score && <span>{task.score}</span>}
                    </div>
                    {task.teacherComment && <blockquote>{task.teacherComment}</blockquote>}
                    {task.assistantNote && <blockquote>{task.assistantNote}</blockquote>}
                  </div>

                  <div className="task-actions read-only-files">
                    <div className="file-stack">
                      {files.length ? (
                        files.map((file) => (
                          <a key={file.id} href={file.url} target="_blank" rel="noreferrer">
                            {file.fileType.startsWith("image/") && (
                              <img className="file-preview" src={file.url} alt={file.name} />
                            )}
                            <span>{file.name}</span>
                          </a>
                        ))
                      ) : (
                        <span>暂无附件</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  helper,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper?: string;
  onClick?: () => void;
}) {
  const Element = onClick ? "button" : "article";
  return (
    <Element className="metric-card" onClick={onClick}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <em>{helper}</em>}
    </Element>
  );
}

function StudentCard({
  student,
  active,
  onSelect,
  onDelete
}: {
  student: Student;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={active ? "student-item-wrap active" : "student-item-wrap"}>
      <button className="student-item" onClick={onSelect}>
        <strong>{student.name}</strong>
        <small>
          {student.group} / 目标 {student.targetScore}
        </small>
        <em>{student.currentLevel}</em>
      </button>
      <button className="delete-student-button" onClick={onDelete} aria-label={`删除学生 ${student.name}`}>
        <X size={14} />
      </button>
    </div>
  );
}

function FlowCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="flow-card">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

export default App;
