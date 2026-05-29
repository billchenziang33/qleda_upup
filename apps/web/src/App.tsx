import { FormEvent, useEffect, useRef, useState } from "react";
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
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import {
  createChatMessage,
  createPrintJob,
  createStudent,
  deleteChatMessage,
  deletePrintJob,
  createTask,
  deleteStudent,
  deleteTask,
  deleteTaskFile,
  getDashboard,
  resolveApiUrl,
  updatePrintJob,
  updateTask,
  uploadTaskFile
} from "./api";
import type { ChatMessage, CreateStudentInput, CreateTaskInput, DashboardData, Priority, Student, Task, TaskFile, TaskStatus, TaskType } from "./types";

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

const printStatusLabels: Record<string, string> = {
  pending: "待打印",
  printed: "已打印",
  cancelled: "已取消"
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

const ieltsScores = Array.from({ length: 19 }, (_, index) => (index * 0.5).toFixed(1).replace(".0", ""));
const dashboardSyncIntervalMs = 4000;

const studentGroupCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});

function sortStudentsByGroup(students: Student[]) {
  return [...students].sort((left, right) => {
    const groupCompare = studentGroupCollator.compare(left.group || "", right.group || "");
    if (groupCompare !== 0) return groupCompare;
    return studentGroupCollator.compare(left.name, right.name);
  });
}

const emptyTaskForm: CreateTaskInput = {
  studentId: "",
  title: "",
  type: "reading",
  priority: "medium",
  dueDate: new Date().toISOString().slice(0, 10),
  description: "",
  pinned: false
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

type PortalMode = "landing" | "teacher-login" | "teacher" | "student";

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let currentLine = "";

  for (const char of text) {
    const testLine = currentLine + char;
    if (context.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (src.startsWith("http://") || src.startsWith("https://")) {
      image.crossOrigin = "anonymous";
    }
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = src;
  });
}

async function runWithConcurrency<TInput>(
  items: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<void>
) {
  let currentIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function downloadParentFeedbackPng(input: {
  task: Task;
  student?: Student;
  correctionImages: TaskFile[];
}) {
  const correctionImages = await Promise.all(input.correctionImages.map((file) => loadImage(resolveApiUrl(file.url))));
  const width = 900;
  const padding = 64;
  const contentWidth = width - padding * 2;
  const imageMaxHeight = 720;
  const exportScale = 2;
  const imageLayouts = correctionImages.map((image) => {
    const imageRatio = Math.min(contentWidth / image.naturalWidth, imageMaxHeight / image.naturalHeight);
    return {
      image,
      width: Math.round(image.naturalWidth * imageRatio),
      height: Math.round(image.naturalHeight * imageRatio)
    };
  });
  const imageSectionHeight = imageLayouts.reduce((total, image) => total + image.height, 0) + Math.max(0, imageLayouts.length - 1) * 34;

  const measuringCanvas = document.createElement("canvas");
  const measuringContext = measuringCanvas.getContext("2d");
  if (!measuringContext) throw new Error("Canvas is not available");

  const comment = input.task.teacherComment || input.task.assistantNote || "老师暂未留下文字评语，请以批改图片为准。";
  measuringContext.font = '600 25px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  const commentLines = wrapCanvasText(measuringContext, comment, contentWidth - 44);
  const height = 930 + imageSectionHeight + commentLines.length * 36;

  const canvas = document.createElement("canvas");
  canvas.width = width * exportScale;
  canvas.height = height * exportScale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.scale(exportScale, exportScale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fff8e8");
  gradient.addColorStop(0.52, "#edf6eb");
  gradient.addColorStop(1, "#eadcc5");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(15, 118, 94, 0.11)";
  context.beginPath();
  context.arc(124, 86, 190, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(214, 154, 45, 0.15)";
  context.beginPath();
  context.arc(760, 42, 215, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#073f34";
  context.font = "900 62px Arial, sans-serif";
  context.fillText("QLEDA", padding, 112);
  context.fillStyle = "#0f765e";
  context.font = "800 17px Arial, sans-serif";
  context.fillText("PARENT FEEDBACK", padding + 2, 150);

  context.fillStyle = "#fffaf0";
  drawRoundRect(context, 48, 190, 804, 202, 32);
  context.fill();
  context.fillStyle = "#17211d";
  context.font = '900 32px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  context.fillText(input.student?.name ?? "学生", 86, 252);
  context.fillStyle = "#69736c";
  context.font = '700 22px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  wrapCanvasText(context, input.task.title, 720).slice(0, 2).forEach((line, index) => {
    context.fillText(line, 86, 300 + index * 32);
  });
  context.fillStyle = "#0f765e";
  context.font = '800 18px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  context.fillText(`截止日期 ${input.task.dueDate} · ${input.task.score ?? "暂无分数"}`, 86, 360);

  const imageCardTop = 430;
  context.fillStyle = "#fffaf0";
  drawRoundRect(context, 48, imageCardTop, 804, imageSectionHeight + 122, 32);
  context.fill();
  context.fillStyle = "#073f34";
  context.font = '900 27px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  context.fillText("批改后的作业", 86, imageCardTop + 54);
  let nextImageY = imageCardTop + 82;
  imageLayouts.forEach((layout) => {
    const drawnImageX = 86 + Math.round((contentWidth - layout.width) / 2);
    context.fillStyle = "#ffffff";
    context.fillRect(drawnImageX, nextImageY, layout.width, layout.height);
    context.drawImage(layout.image, drawnImageX, nextImageY, layout.width, layout.height);
    nextImageY += layout.height + 34;
  });

  const commentCardTop = imageCardTop + imageSectionHeight + 168;
  context.fillStyle = "#fffaf0";
  drawRoundRect(context, 48, commentCardTop, 804, 116 + commentLines.length * 36, 32);
  context.fill();
  context.fillStyle = "#073f34";
  context.font = '900 27px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  context.fillText("老师评语", 86, commentCardTop + 56);
  context.fillStyle = "#17211d";
  context.font = '600 25px "Microsoft YaHei UI", "PingFang SC", sans-serif';
  commentLines.forEach((line, index) => {
    context.fillText(line, 86, commentCardTop + 106 + index * 36);
  });

  context.fillStyle = "#69736c";
  context.font = "600 16px Arial, sans-serif";
  context.fillText("Generated by QLEDA Teaching Operations", 86, height - 54);

  const link = document.createElement("a");
  const safeStudentName = (input.student?.name ?? "student").replace(/[\\/:*?"<>|]+/g, "_");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Image export failed");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `${safeStudentName}-${input.task.title.slice(0, 24).replace(/[\\/:*?"<>|]+/g, "_")}-家长反馈.png`;
  link.download = `${safeStudentName}-${input.task.title.slice(0, 24).replace(/[\\/:*?"<>|]+/g, "_")}-parent-feedback.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

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
  const [studentScores, setStudentScores] = useState({
    listening: "5.5",
    reading: "5.5",
    writing: "5.5",
    speaking: "5.5"
  });
  const [studentFormError, setStudentFormError] = useState("");
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<CreateTaskInput>(emptyTaskForm);
  const [taskFormError, setTaskFormError] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [assignmentTaskId, setAssignmentTaskId] = useState<string | null>(null);
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);
  const [assignmentError, setAssignmentError] = useState("");
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [correctionTaskId, setCorrectionTaskId] = useState<string | null>(null);
  const [correctionFiles, setCorrectionFiles] = useState<File[]>([]);
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [deleteStudentId, setDeleteStudentId] = useState<string | null>(null);
  const [deleteStudentError, setDeleteStudentError] = useState("");
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [isPrintQueueOpen, setIsPrintQueueOpen] = useState(false);
  const [printFile, setPrintFile] = useState<File | null>(null);
  const [printRequester, setPrintRequester] = useState("");
  const [printCopies, setPrintCopies] = useState(1);
  const [printNote, setPrintNote] = useState("");
  const [printError, setPrintError] = useState("");
  const [isSavingPrintJob, setIsSavingPrintJob] = useState(false);
  const [deletingPrintJobId, setDeletingPrintJobId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<TaskFile | { name: string; url: string; fileType: string } | null>(null);
  const [isAuditExpanded, setIsAuditExpanded] = useState(false);
  const [chatRole, setChatRole] = useState<"teacher" | "assistant">("teacher");
  const [chatText, setChatText] = useState("");
  const [chatError, setChatError] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [deletingChatMessageId, setDeletingChatMessageId] = useState<string | null>(null);
  const dashboardRef = useRef<DashboardData | null>(null);
  const isLoadingDashboardRef = useRef(false);

  async function loadDashboard(options: { silent?: boolean } = {}) {
    if (isLoadingDashboardRef.current) return;
    isLoadingDashboardRef.current = true;
    try {
      if (!options.silent) setError("");
      const nextDashboard = await getDashboard();
      dashboardRef.current = nextDashboard;
      setDashboard(nextDashboard);
    } catch {
      setError("后端服务暂时不可用，请确认 API 已经启动。");
    } finally {
      isLoadingDashboardRef.current = false;
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const syncDashboard = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard({ silent: true });
      }
    };

    const timer = window.setInterval(syncDashboard, dashboardSyncIntervalMs);
    document.addEventListener("visibilitychange", syncDashboard);
    window.addEventListener("focus", syncDashboard);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncDashboard);
      window.removeEventListener("focus", syncDashboard);
    };
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
    const tasksWithCorrection = new Set(
      dashboard?.taskFiles
        .filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"))
        .map((file) => file.taskId)
    );
    const task = dashboard?.tasks.find((item) => item.status !== "completed" && !tasksWithCorrection.has(item.id));
    if (!task) return;
    locateTask(task.id, task.studentId);
  }

  async function handleExport(taskId: string) {
    setBusyTaskId(taskId);
    try {
      const task = dashboard?.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Task not found");
      const student = dashboard?.students.find((item) => item.id === task.studentId);
      const correctionImages = dashboard?.taskFiles
        .filter((file) => file.taskId === taskId && file.fileType.startsWith("image/"))
        .slice(-9);
      if (!correctionImages?.length) throw new Error("No correction image");
      await downloadParentFeedbackPng({ task, student, correctionImages });
    } catch {
      window.alert("导出失败：请先上传图片格式的批改后文件。");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudentFormError("");
    setIsSavingStudent(true);

    try {
      const student = await createStudent({
        ...studentForm,
        targetScore: Number(studentForm.targetScore),
        currentLevel: `Listening ${studentScores.listening} / Reading ${studentScores.reading} / Writing ${studentScores.writing} / Speaking ${studentScores.speaking}`,
        teacherId: "u-teacher-lin",
        assistantId: "u-assistant-chen"
      });
      await loadDashboard();
      setSelectedStudentId(student.id);
      setLocatedTaskId(null);
      setStudentForm(emptyStudentForm);
      setStudentScores({
        listening: "5.5",
        reading: "5.5",
        writing: "5.5",
        speaking: "5.5"
      });
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

  async function handleUploadAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentTaskId || !assignmentFile) {
      setAssignmentError("请先选择要上传的作业文件。");
      return;
    }

    const task = dashboard?.tasks.find((item) => item.id === assignmentTaskId);
    setAssignmentError("");
    setIsSavingAssignment(true);

    try {
      await uploadTaskFile(assignmentTaskId, {
        file: assignmentFile,
        uploaderId: task?.studentId ?? "student",
        uploaderRole: "student",
        compressImage: assignmentFile.type.startsWith("image/")
          ? {
              maxSide: 1600,
              quality: 0.78,
              minBytes: 180 * 1024
            }
          : false
      });
      await updateTask(assignmentTaskId, {
        status: "submitted"
      });
      await loadDashboard();
      if (task) locateTask(task.id, task.studentId);
      setAssignmentTaskId(null);
      setAssignmentFile(null);
    } catch {
      setAssignmentError("作业上传失败，请确认文件和后端服务正常。");
    } finally {
      setIsSavingAssignment(false);
    }
  }

  async function handleUploadCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correctionTaskId || correctionFiles.length === 0) {
      setCorrectionError("请先选择批改后的作业照片。");
      return;
    }

    if (correctionFiles.length > 9) {
      setCorrectionError("一次最多只能上传 9 张批改照片。");
      return;
    }

    const task = dashboard?.tasks.find((item) => item.id === correctionTaskId);
    setCorrectionError("");
    setIsSavingCorrection(true);

    try {
      await runWithConcurrency(
        correctionFiles,
        3,
        async (file) => {
          await uploadTaskFile(correctionTaskId, {
            file,
            uploaderId: "u-assistant-chen",
            uploaderRole: "assistant",
            compressImage: {
              maxSide: 2200,
              quality: 0.88,
              minBytes: 220 * 1024
            }
          });
        }
      );
      await updateTask(correctionTaskId, {
        status: "reviewed",
        teacherComment: correctionNote
      });
      await loadDashboard();
      if (task) locateTask(task.id, task.studentId);
      setCorrectionTaskId(null);
      setCorrectionFiles([]);
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

  async function handleDeleteFile(fileId: string) {
    if (!window.confirm("确认删除这个文件吗？删除后数据库记录也会同步移除。")) return;
    setDeletingFileId(fileId);

    try {
      await deleteTaskFile(fileId);
      await loadDashboard();
    } catch {
      window.alert("删除批改照片失败，请确认后端服务正常。");
    } finally {
      setDeletingFileId(null);
    }
  }

  async function handleCreatePrintJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printFile) {
      setPrintError("请先选择需要打印的文件。");
      return;
    }

    setPrintError("");
    setIsSavingPrintJob(true);

    try {
      await createPrintJob({
        file: printFile,
        requester: printRequester,
        copies: Number(printCopies),
        note: printNote
      });
      await loadDashboard();
      setPrintFile(null);
      setPrintRequester("");
      setPrintCopies(1);
      setPrintNote("");
    } catch {
      setPrintError("打印文件上传失败，请检查文件、份数和后端服务。");
    } finally {
      setIsSavingPrintJob(false);
    }
  }

  async function handleDeletePrintJob(jobId: string) {
    if (!window.confirm("确认从打印队列中删除这个文件吗？")) return;
    setDeletingPrintJobId(jobId);

    try {
      await deletePrintJob(jobId);
      await loadDashboard();
    } catch {
      window.alert("删除打印文件失败，请确认后端服务正常。");
    } finally {
      setDeletingPrintJobId(null);
    }
  }

  async function handleTaskStatusChange(taskId: string, status: TaskStatus) {
    try {
      await updateTask(taskId, { status });
      await loadDashboard();
    } catch {
      window.alert("任务状态更新失败，请确认后端服务正常。");
    }
  }

  async function handlePrintStatusChange(jobId: string, status: "pending" | "printed" | "cancelled") {
    try {
      await updatePrintJob(jobId, { status });
      await loadDashboard();
    } catch {
      window.alert("打印状态更新失败，请确认后端服务正常。");
    }
  }

  async function handleSendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatText.trim();
    if (!message) {
      setChatError("请输入沟通内容。");
      return;
    }

    setChatError("");
    setIsSendingChat(true);

    try {
      await createChatMessage({
        authorRole: chatRole,
        authorName: chatRole === "teacher" ? "老师" : "助教",
        message
      });
      setChatText("");
      await loadDashboard();
    } catch {
      setChatError("消息发送失败，请确认后端服务正常。");
    } finally {
      setIsSendingChat(false);
    }
  }

  async function handleDeleteChatMessage(messageId: string) {
    if (!window.confirm("确认删除这条沟通消息吗？删除后数据库记录也会同步移除。")) return;
    setDeletingChatMessageId(messageId);

    try {
      await deleteChatMessage(messageId);
      await loadDashboard();
    } catch {
      window.alert("删除沟通消息失败，请确认后端服务正常。");
    } finally {
      setDeletingChatMessageId(null);
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

  function openAssignmentForm(taskId: string) {
    setAssignmentTaskId(taskId);
    setAssignmentFile(null);
    setAssignmentError("");
  }

  function openCorrectionForm(taskId: string) {
    setCorrectionTaskId(taskId);
    setCorrectionFiles([]);
    setCorrectionNote("");
    setCorrectionError("");
  }

  function handleCorrectionFilesChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length > 9) {
      setCorrectionFiles([]);
      setCorrectionError("一次最多只能上传 9 张批改照片，请重新选择。");
      return;
    }
    setCorrectionError("");
    setCorrectionFiles(selectedFiles);
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

  const correctionTask = correctionTaskId ? dashboard.tasks.find((task) => task.id === correctionTaskId) : undefined;

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
      <>
        <StudentPortal
          dashboard={dashboard}
          selectedStudentId={studentPortalId}
          onStudentChange={setStudentPortalId}
          onPreview={setPreviewFile}
          onBack={() => setPortalMode("landing")}
        />
        {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
      </>
    );
  }

  const selectedStudentTasks =
    selectedStudentId === "all"
      ? dashboard.tasks
      : dashboard.tasks.filter((task) => task.studentId === selectedStudentId);
  const visibleAuditLogs = isAuditExpanded ? dashboard.auditLogs : dashboard.auditLogs.slice(0, 5);
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
      <section className="top-dashboard">
        <div className="top-dashboard-main">
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
              <span>{dashboard.summary.pendingReview} 个任务等待批改，{dashboard.summary.pendingPrintJobs} 个文件在打印队列中。</span>
            </div>
          </section>

          <div className="metric-grid">
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
            <Metric
              icon={<Camera />}
              label="需要打印的文件队列"
              value={dashboard.summary.pendingPrintJobs}
              helper="上传文件并备注份数/姓名或门牌号"
              onClick={() => setIsPrintQueueOpen(true)}
              tone="print"
            />
          </div>
        </div>
        <CommunicationPanel
          messages={dashboard.chatMessages}
          role={chatRole}
          text={chatText}
          error={chatError}
          isSending={isSendingChat}
          onRoleChange={setChatRole}
          onTextChange={setChatText}
          onSubmit={handleSendChatMessage}
          deletingMessageId={deletingChatMessageId}
          onDeleteMessage={(messageId) => void handleDeleteChatMessage(messageId)}
        />
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
          </button>
          {sortStudentsByGroup(dashboard.students).map((student) => (
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
                    {task.description && <p>{task.description}</p>}
                    <div className="task-meta">
                      <span>{student?.name}</span>
                      <span>{typeLabels[task.type]}</span>
                      <span>截止 {task.dueDate}</span>
                      {task.score && <span>{task.score}</span>}
                    </div>
                    <label className="inline-status-control">
                      任务状态
                      <select value={task.status} onChange={(event) => void handleTaskStatusChange(task.id, event.target.value as TaskStatus)}>
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TeacherNoteEditor task={task} onSave={loadDashboard} />
                  </div>

                  <div className="task-actions">
                    <TaskFileGallery
                      files={files}
                      deletingFileId={deletingFileId}
                      onDeleteFile={(fileId) => void handleDeleteFile(fileId)}
                      onPreview={setPreviewFile}
                    />
                    <button onClick={() => openAssignmentForm(task.id)} disabled={busyTaskId === task.id}>
                      <UploadCloud size={16} />
                      上传作业
                    </button>
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

      <section className="audit-panel">
        <div className="section-heading">
          <span>后台操作记录</span>
          <ShieldCheck size={18} />
        </div>
        <div className="audit-list">
          {dashboard.auditLogs.length ? (
            visibleAuditLogs.map((log) => (
              <article key={log.id} className="audit-item">
                <strong>{log.detail}</strong>
                <span>
                  {log.actor} · {new Date(log.createdAt).toLocaleString()}
                </span>
              </article>
            ))
          ) : (
            <p className="muted-copy">暂无操作记录。</p>
          )}
        </div>
        {dashboard.auditLogs.length > 5 && (
          <button type="button" className="audit-toggle-button" onClick={() => setIsAuditExpanded((current) => !current)}>
            {isAuditExpanded ? "收起记录" : `展开更多（${dashboard.auditLogs.length - 5} 条）`}
          </button>
        )}
      </section>

      {previewFile && (
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}

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
              <div className="score-grid">
                <ScoreSelect
                  label="听力"
                  value={studentScores.listening}
                  onChange={(value) => setStudentScores({ ...studentScores, listening: value })}
                />
                <ScoreSelect
                  label="阅读"
                  value={studentScores.reading}
                  onChange={(value) => setStudentScores({ ...studentScores, reading: value })}
                />
                <ScoreSelect
                  label="写作"
                  value={studentScores.writing}
                  onChange={(value) => setStudentScores({ ...studentScores, writing: value })}
                />
                <ScoreSelect
                  label="口语"
                  value={studentScores.speaking}
                  onChange={(value) => setStudentScores({ ...studentScores, speaking: value })}
                />
              </div>
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

      {isPrintQueueOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="student-form print-queue-modal">
            <div className="form-header">
              <div>
                <p className="eyebrow">Print Queue</p>
                <h2>需要打印的文件队列</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsPrintQueueOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="print-job-form" onSubmit={(event) => void handleCreatePrintJob(event)}>
              <label>
                打印文件
                <input
                  required
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.ppt,.pptx"
                  onChange={(event) => setPrintFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                姓名 / 教室门牌号
                <input
                  required
                  value={printRequester}
                  onChange={(event) => setPrintRequester(event.target.value)}
                  placeholder="例如：Anna / A203"
                />
              </label>
              <label>
                打印份数
                <input
                  required
                  min="1"
                  max="200"
                  type="number"
                  value={printCopies}
                  onChange={(event) => setPrintCopies(Number(event.target.value))}
                />
              </label>
              <label>
                打印备注
                <textarea
                  value={printNote}
                  onChange={(event) => setPrintNote(event.target.value)}
                  placeholder="例如：双面打印 / 课前送到 301 / 彩印"
                />
              </label>

              {printError && <p className="form-error">{printError}</p>}

              <button className="submit-button" type="submit" disabled={isSavingPrintJob}>
                {isSavingPrintJob ? "加入队列中..." : "加入打印队列"}
              </button>
            </form>

            <div className="print-job-list">
              <strong>当前待打印</strong>
              {dashboard.printJobs.length ? (
                dashboard.printJobs.map((job) => (
                  <div key={job.id} className="print-job-row">
                    <button
                      type="button"
                      className="delete-print-job-button"
                      onClick={() => void handleDeletePrintJob(job.id)}
                      disabled={deletingPrintJobId === job.id}
                      aria-label={`删除打印文件 ${job.fileName}`}
                    >
                      <X size={13} />
                    </button>
                    <div className="print-job-item">
                      <span>{job.fileName}</span>
                      <em>{job.requester}</em>
                      <b>{job.copies} 份</b>
                      <select
                        value={job.status}
                        onChange={(event) => void handlePrintStatusChange(job.id, event.target.value as "pending" | "printed" | "cancelled")}
                      >
                        {Object.entries(printStatusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <a className="preview-print-button" href={resolveApiUrl(job.fileUrl)} download={job.fileName}>
                        Download
                      </a>
                      {job.note && <small>{job.note}</small>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted-copy">当前没有待打印文件。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {assignmentTaskId && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleUploadAssignment(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Assignment Upload</p>
                <h2>上传作业文件</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setAssignmentTaskId(null)}>
                <X size={18} />
              </button>
            </div>

            <label>
              作业文件
              <input
                required
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.mp3,.mp4"
                onChange={(event) => setAssignmentFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {assignmentError && <p className="form-error">{assignmentError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingAssignment}>
              {isSavingAssignment ? "上传中..." : "上传并标记为已提交"}
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
                multiple
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => handleCorrectionFilesChange(event.target.files)}
              />
            </label>
            {correctionFiles.length > 0 && <p className="form-context">已选择 {correctionFiles.length} 张批改照片</p>}
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
  onPreview,
  onBack
}: {
  dashboard: DashboardData;
  selectedStudentId: string;
  onStudentChange: (studentId: string) => void;
  onPreview: (file: TaskFile) => void;
  onBack: () => void;
}) {
  const sortedStudents = sortStudentsByGroup(dashboard.students);
  const selectedStudent = sortedStudents.find((student) => student.id === selectedStudentId) ?? sortedStudents[0];
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
          {sortedStudents.map((student) => (
            <button
              key={student.id}
              className={selectedStudent?.id === student.id ? "student-item active" : "student-item"}
              onClick={() => onStudentChange(student.id)}
            >
              <strong>{student.name}</strong>
              <small>{student.group || "No group"}</small>
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
                    {task.description && <p>{task.description}</p>}
                    <div className="task-meta">
                      <span>{typeLabels[task.type]}</span>
                      <span>截止 {task.dueDate}</span>
                      {task.score && <span>{task.score}</span>}
                    </div>
                    {task.teacherComment && (
                      <blockquote>
                        <strong>老师备注</strong>
                        <span>{task.teacherComment}</span>
                      </blockquote>
                    )}
                  </div>

                  <div className="task-actions read-only-files">
                    <TaskFileGallery files={files} readOnly onPreview={onPreview} />
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

function FilePreviewModal({
  file,
  onClose
}: {
  file: TaskFile | { name: string; url: string; fileType: string };
  onClose: () => void;
}) {
  const fileUrl = resolveApiUrl(file.url);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="file-preview-modal">
        <div className="form-header">
          <div>
            <p className="eyebrow">File Preview</p>
            <h2>{file.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {file.fileType.startsWith("image/") ? (
          <img src={fileUrl} alt={file.name} />
        ) : file.fileType === "application/pdf" ? (
          <iframe title={file.name} src={fileUrl} />
        ) : (
          <div className="preview-fallback">
            <p>当前文件类型不能直接内嵌预览，可以点击下方按钮打开或下载。</p>
            <a href={fileUrl} target="_blank" rel="noreferrer">
              打开文件
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function CommunicationPanel({
  messages,
  role,
  text,
  error,
  isSending,
  onRoleChange,
  onTextChange,
  onSubmit,
  deletingMessageId,
  onDeleteMessage
}: {
  messages: ChatMessage[];
  role: "teacher" | "assistant";
  text: string;
  error: string;
  isSending: boolean;
  onRoleChange: (role: "teacher" | "assistant") => void;
  onTextChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  deletingMessageId: string | null;
  onDeleteMessage: (messageId: string) => void;
}) {
  const latestMessages = messages.slice(-6);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [latestMessages.length, latestMessages.at(-1)?.id]);

  return (
    <aside className="communication-card">
      <div className="communication-heading">
        <div>
          <span>老师 / 助教沟通</span>
          <strong>需求对话框</strong>
        </div>
        <MessageCircle size={22} />
      </div>

      <div className="chat-thread" ref={threadRef}>
        {latestMessages.length ? (
          latestMessages.map((message) => (
            <article key={message.id} className={`chat-message ${message.authorRole}`}>
              <button
                type="button"
                className="delete-chat-message-button"
                onClick={() => onDeleteMessage(message.id)}
                disabled={deletingMessageId === message.id}
                aria-label="删除沟通消息"
              >
                {deletingMessageId === message.id ? <Loader2 className="spin" size={12} /> : <X size={12} />}
              </button>
              <div className="chat-message-meta">
                <strong>{message.authorName}</strong>
                <time>{formatDateTime(message.createdAt)}</time>
              </div>
              <p>{message.message}</p>
            </article>
          ))
        ) : (
          <p className="chat-empty">还没有沟通记录，可以在这里同步批改、打印或课程安排需求。</p>
        )}
      </div>

      <form className="chat-form" onSubmit={onSubmit}>
        <div className="chat-role-toggle" aria-label="选择发送身份">
          <button type="button" className={role === "teacher" ? "active" : ""} onClick={() => onRoleChange("teacher")}>
            老师
          </button>
          <button type="button" className={role === "assistant" ? "active" : ""} onClick={() => onRoleChange("assistant")}>
            助教
          </button>
        </div>
        <textarea value={text} onChange={(event) => onTextChange(event.target.value)} />
        {error && <p className="form-error">{error}</p>}
        <button className="chat-send-button" type="submit" disabled={isSending}>
          {isSending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          发送
        </button>
      </form>
    </aside>
  );
}

function ScoreSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="score-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {ieltsScores.map((score) => (
          <option key={score} value={score}>
            {score}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({
  icon,
  label,
  value,
  helper,
  onClick,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper?: string;
  onClick?: () => void;
  tone?: "print";
}) {
  const Element = onClick ? "button" : "article";
  return (
    <Element className={tone ? `metric-card ${tone}` : "metric-card"} onClick={onClick}>
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
        <small>{student.group || "No group"}</small>
      </button>
      <button className="delete-student-button" onClick={onDelete} aria-label={`删除学生 ${student.name}`}>
        <X size={14} />
      </button>
    </div>
  );
}

function TeacherNoteEditor({ task, onSave }: { task: Task; onSave: () => Promise<void> }) {
  const [note, setNote] = useState(task.teacherComment ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setNote(task.teacherComment ?? "");
  }, [task.id, task.teacherComment]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await updateTask(task.id, { teacherComment: note });
      await onSave();
    } catch {
      window.alert("老师备注保存失败，请确认后端服务正常。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="teacher-note-editor">
      <label>
        老师备注
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="在这里添加给学生或家长看的备注..." />
      </label>
      <button type="button" onClick={() => void handleSave()} disabled={isSaving}>
        {isSaving ? "保存中..." : "保存备注"}
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

function TaskFileGallery({
  files,
  readOnly = false,
  deletingFileId,
  onDeleteFile,
  onPreview
}: {
  files: TaskFile[];
  readOnly?: boolean;
  deletingFileId?: string | null;
  onDeleteFile?: (fileId: string) => void;
  onPreview?: (file: TaskFile) => void;
}) {
  const correctionFiles = files.filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"));
  const assignmentFiles = files.filter((file) => !correctionFiles.some((correction) => correction.id === file.id));

  return (
    <div className="file-sections">
      <FileSection
        title="作业 / 附件"
        tone="assignment"
        files={assignmentFiles}
        emptyText={readOnly ? "暂未上传作业" : "暂无作业文件"}
        deletingFileId={deletingFileId}
        onDelete={readOnly ? undefined : onDeleteFile}
        onPreview={onPreview}
      />
      <FileSection
        title="批改照片"
        tone="correction"
        files={correctionFiles}
        emptyText={readOnly ? "暂未上传批改" : "暂无批改照片"}
        deletingFileId={deletingFileId}
        onDelete={readOnly ? undefined : onDeleteFile}
        onPreview={onPreview}
      />
    </div>
  );
}

function FileSection({
  tone,
  title,
  files,
  emptyText,
  deletingFileId,
  onDelete,
  onPreview
}: {
  tone: "assignment" | "correction";
  title: string;
  files: TaskFile[];
  emptyText: string;
  deletingFileId?: string | null;
  onDelete?: (fileId: string) => void;
  onPreview?: (file: TaskFile) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewFile = files.find((file) => file.fileType.startsWith("image/")) ?? files[0];
  const imageCount = files.filter((file) => file.fileType.startsWith("image/")).length;
  const bundleLabel = imageCount === files.length ? `${files.length} 张照片` : `${files.length} 个文件`;

  return (
    <div className={`file-section ${tone}`}>
      <strong>{title}</strong>
      <div className="file-stack">
        {files.length ? (
          <>
            <button type="button" className="file-bundle-button" onClick={() => setExpanded((current) => !current)}>
              {previewFile?.fileType.startsWith("image/") && (
                <img className="file-bundle-preview" src={resolveApiUrl(previewFile.url)} alt={previewFile.name} />
              )}
              <span>
                <b>{title}</b>
                <em>{bundleLabel}</em>
              </span>
              <small>{expanded ? "收起" : "查看"}</small>
            </button>
            {expanded && (
              <div className="file-bundle-detail">
                {files.map((file) => (
                  <div key={file.id} className="file-chip-wrap">
                    {onDelete && (
                      <button
                        type="button"
                        className="delete-file-button"
                        onClick={() => onDelete(file.id)}
                        disabled={deletingFileId === file.id}
                        aria-label={`删除批改照片 ${file.name}`}
                      >
                        <X size={13} />
                      </button>
                    )}
                    <button type="button" className="file-preview-button" onClick={() => onPreview?.(file)}>
                      {file.fileType.startsWith("image/") && <img className="file-preview" src={resolveApiUrl(file.url)} alt={file.name} />}
                      <span>{file.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <span>{emptyText}</span>
        )}
      </div>
    </div>
  );
}

export default App;
