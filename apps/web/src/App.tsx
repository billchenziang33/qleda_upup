import { type DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  Camera,
  CheckCircle2,
  ClipboardList,
  Download,
  Files,
  GripVertical,
  GraduationCap,
  ImageDown,
  Loader2,
  LockKeyhole,
  Plus,
  Printer,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import {
  createPrintJob,
  createSharedFile,
  createStudent,
  createTeacher,
  deleteTeacherGroup,
  deletePrintJob,
  deleteSharedFile,
  createTask,
  deleteStudent,
  deleteTask,
  deleteTaskFile,
  downloadDailyFeedbackPdf,
  getDashboard,
  getDashboardVersion,
  moveTeacherGroup,
  resolveApiUrl,
  renameTeacherGroup,
  updateTeacherName,
  updatePrintJob,
  updateStudent,
  updateTask,
  uploadTaskFile
} from "./api";
import type { CreateStudentInput, CreateTaskInput, DashboardData, SharedFile, Student, Task, TaskFile, TaskStatus, User } from "./types";

const statusLabels: Record<TaskStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  submitted: "已提交",
  reviewed: "已批改",
  completed: "已结束"
};

const printStatusLabels: Record<string, string> = {
  pending: "待打印",
  printed: "已打印",
  cancelled: "已取消"
};

const emptyStudentForm: CreateStudentInput = {
  name: "",
  group: "",
  teacherName: ""
};

const dashboardSyncIntervalMs = 60000;
const dashboardIdlePauseMs = 5 * 60 * 1000;
const dashboardInitialRetryDelaysMs = [0, 1500, 3000, 6000, 10000];
const teacherGuideStorageKey = "qleda-teacher-guide-seen-v2";
const teacherOnboardingSteps = [
  {
    title: "先建立学生档案",
    text: "从左侧添加老师或学生，也可以搜索学生姓名快速定位。"
  },
  {
    title: "给学生创建任务",
    text: "选择学生后点击新建任务，任务会进入右侧任务队列。"
  },
  {
    title: "上传批改或加入打印",
    text: "在任务卡片上传批改文件；已结束任务可从待批改列表移除。"
  }
];

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

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

function sortTasksByLatest(tasks: Task[]) {
  return [...tasks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

type StudentArchiveDragPayload =
  | { type: "student"; studentId: string }
  | { type: "group"; teacherId: string; groupName: string };

const studentArchiveDragMime = "application/x-qleda-student-archive";

function groupStudentsByTeacher(students: Student[], users: User[] = []) {
  const teachers = new Map<string, { teacherId: string; teacherName: string; groups: Map<string, Student[]> }>();
  users
    .filter((user) => user.role === "teacher")
    .sort((left, right) => studentGroupCollator.compare(left.name, right.name))
    .forEach((teacher) => {
      teachers.set(teacher.id, {
        teacherId: teacher.id,
        teacherName: teacher.name,
        groups: new Map<string, Student[]>()
      });
    });

  [...students]
    .sort((left, right) => {
      const teacherCompare = studentGroupCollator.compare(left.teacherName || "", right.teacherName || "");
      if (teacherCompare !== 0) return teacherCompare;
      const groupCompare = studentGroupCollator.compare(left.group || "", right.group || "");
      if (groupCompare !== 0) return groupCompare;
      return studentGroupCollator.compare(left.name, right.name);
    })
    .forEach((student) => {
      const teacherId = student.teacherId;
      const teacherName = student.teacherName?.trim() || "未分配老师";
      const groupName = student.group?.trim() || "未分班";
      const teacherEntry = teachers.get(teacherId) ?? {
        teacherId,
        teacherName,
        groups: new Map<string, Student[]>()
      };
      teacherEntry.groups.set(groupName, [...(teacherEntry.groups.get(groupName) ?? []), student]);
      teachers.set(teacherId, teacherEntry);
    });

  return Array.from(teachers.values()).map((teacher) => ({
    teacherId: teacher.teacherId,
    teacherName: teacher.teacherName,
    groups: Array.from(teacher.groups, ([groupName, groupStudents]) => ({
      groupName,
      students: groupStudents
    }))
  }));
}

const emptyTaskForm: CreateTaskInput = {
  studentId: "",
  title: "",
  description: "",
  dueDate: "",
  pinned: false
};

type SelectedTeacherGroup = {
  teacherId: string;
  teacherName: string;
  groupName: string;
};

function getDefaultTaskDueDate() {
  const dueDate = new Date();
  dueDate.setHours(20, 0, 0, 0);
  const timezoneOffsetMs = dueDate.getTimezoneOffset() * 60 * 1000;
  return new Date(dueDate.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTaskDueDate(value: string) {
  if (!value) return "未设置 DDL";
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T20:00` : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getTaskDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function getTodayDateInputValue() {
  const today = new Date();
  return new Date(today.getTime() - today.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
}

function sanitizeDownloadFileName(value: string, fallback: string) {
  const clean = value.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
  return clean || fallback;
}

type PortalMode = "landing" | "teacher" | "student";

type ApiLoadProgress = {
  percent: number;
  label: string;
  detail: string;
  attempt: number;
  totalAttempts: number;
  failed: boolean;
};

const initialApiLoadProgress: ApiLoadProgress = {
  percent: 8,
  label: "正在连接后端 API",
  detail: "正在建立安全连接...",
  attempt: 0,
  totalAttempts: dashboardInitialRetryDelaysMs.length,
  failed: false
};

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
  context.fillText("QULEDA", padding, 112);
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
  context.fillText(input.task.score ?? "暂无分数", 86, 360);

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
  context.fillText("Generated by QULEDA Teaching Operations", 86, height - 54);

  const link = document.createElement("a");
  const safeStudentName = sanitizeDownloadFileName(input.student?.name ?? "", "学生");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Image export failed");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  const safeTaskTitle = sanitizeDownloadFileName(input.task.title.slice(0, 24), "任务");
  link.download = `${safeStudentName}-${safeTaskTitle}-家长反馈长图.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [portalMode, setPortalMode] = useState<PortalMode>("landing");
  const [studentPortalId, setStudentPortalId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [selectedTeacherGroup, setSelectedTeacherGroup] = useState<SelectedTeacherGroup | null>(null);
  const [isPendingReviewListOpen, setIsPendingReviewListOpen] = useState(false);
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [locatedTaskId, setLocatedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [apiLoadProgress, setApiLoadProgress] = useState<ApiLoadProgress>(initialApiLoadProgress);
  const [isStudentFormOpen, setIsStudentFormOpen] = useState(false);
  const [studentForm, setStudentForm] = useState<CreateStudentInput>(emptyStudentForm);
  const [studentFormError, setStudentFormError] = useState("");
  const [isSavingStudent, setIsSavingStudent] = useState(false);
  const [isTeacherFormOpen, setIsTeacherFormOpen] = useState(false);
  const [teacherFormName, setTeacherFormName] = useState("");
  const [teacherFormError, setTeacherFormError] = useState("");
  const [isSavingTeacher, setIsSavingTeacher] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [taskFormMode, setTaskFormMode] = useState<"student" | "group">("student");
  const [taskForm, setTaskForm] = useState<CreateTaskInput>(emptyTaskForm);
  const [taskFormError, setTaskFormError] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [assignmentTaskId, setAssignmentTaskId] = useState<string | null>(null);
  const [assignmentFiles, setAssignmentFiles] = useState<File[]>([]);
  const [assignmentError, setAssignmentError] = useState("");
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [correctionTaskId, setCorrectionTaskId] = useState<string | null>(null);
  const [correctionFiles, setCorrectionFiles] = useState<File[]>([]);
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [updatingTaskStatusId, setUpdatingTaskStatusId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [deleteStudentId, setDeleteStudentId] = useState<string | null>(null);
  const [deleteStudentError, setDeleteStudentError] = useState("");
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [expandedTeachers, setExpandedTeachers] = useState<Set<string>>(() => new Set());
  const [expandedStudentGroups, setExpandedStudentGroups] = useState<Set<string>>(() => new Set());
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [deletingStudentGroup, setDeletingStudentGroup] = useState("");
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [printFile, setPrintFile] = useState<File | null>(null);
  const [printCopies, setPrintCopies] = useState(1);
  const [printNote, setPrintNote] = useState("");
  const [printError, setPrintError] = useState("");
  const [isPrintFormOpen, setIsPrintFormOpen] = useState(false);
  const [isSavingPrintJob, setIsSavingPrintJob] = useState(false);
  const [deletingPrintJobId, setDeletingPrintJobId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<TaskFile | { name: string; url: string; fileType: string } | null>(null);
  const [sharedFileUpload, setSharedFileUpload] = useState<File | null>(null);
  const [sharedFileSearchQuery, setSharedFileSearchQuery] = useState("");
  const [sharedFileError, setSharedFileError] = useState("");
  const [isSavingSharedFile, setIsSavingSharedFile] = useState(false);
  const [deletingSharedFileId, setDeletingSharedFileId] = useState<string | null>(null);
  const [printQueueSearchQuery, setPrintQueueSearchQuery] = useState("");
  const [isAuditExpanded, setIsAuditExpanded] = useState(false);
  const [isTaskListExpanded, setIsTaskListExpanded] = useState(false);
  const [isDailyFeedbackFormOpen, setIsDailyFeedbackFormOpen] = useState(false);
  const [dailyFeedbackDate, setDailyFeedbackDate] = useState(getTodayDateInputValue());
  const [dailyFeedbackError, setDailyFeedbackError] = useState("");
  const [isDownloadingDailyFeedback, setIsDownloadingDailyFeedback] = useState(false);
  const [isTeacherGuideOpen, setIsTeacherGuideOpen] = useState(false);
  const [isTeacherGuidePreviewOpen, setIsTeacherGuidePreviewOpen] = useState(false);
  const [teacherGuideStep, setTeacherGuideStep] = useState(0);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const dashboardRef = useRef<DashboardData | null>(null);
  const isLoadingDashboardRef = useRef(false);
  const latestDashboardVersionRef = useRef("");
  const lastActivityAtRef = useRef(Date.now());
  const lastDashboardVersionCheckAtRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  async function loadDashboard(options: { silent?: boolean; retryDelays?: number[]; force?: boolean } = {}) {
    if (isLoadingDashboardRef.current) {
      if (!options.force) return;
      for (let attempt = 0; attempt < 10 && isLoadingDashboardRef.current; attempt += 1) {
        await wait(120);
      }
      if (isLoadingDashboardRef.current) return;
    }
    isLoadingDashboardRef.current = true;
    const retryDelays = options.retryDelays ?? (options.silent ? [0] : dashboardInitialRetryDelaysMs);
    const totalAttempts = retryDelays.length;
    try {
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (!options.silent && !dashboardRef.current) {
          const attemptProgress = Math.min(88, 12 + Math.round((attempt / Math.max(1, totalAttempts)) * 72));
          setApiLoadProgress({
            percent: attemptProgress,
            label: attempt === 0 ? "正在连接后端 API" : "后端 API 正在启动",
            detail:
              attempt === 0
                ? "正在读取任务、学生和附件数据..."
                : `第 ${attempt + 1} 次尝试连接，请稍等...`,
            attempt,
            totalAttempts,
            failed: false
          });
        }

        if (retryDelays[attempt] > 0) {
          if (!options.silent && !dashboardRef.current) {
            setError(`后端 API 正在启动，正在重试... (${attempt}/${retryDelays.length - 1})`);
          }
          await wait(retryDelays[attempt]);
        } else if (!options.silent) {
          setError("");
        }

        try {
          const nextDashboard = await getDashboard();
          if (!options.silent && !dashboardRef.current) {
            setApiLoadProgress({
              percent: 100,
              label: "连接成功",
              detail: "正在进入 QULEDA 教学任务中心...",
              attempt,
              totalAttempts,
              failed: false
            });
          }
          dashboardRef.current = nextDashboard;
          latestDashboardVersionRef.current = nextDashboard.version;
          setDashboard(nextDashboard);
          setError("");
          return;
        } catch {
          if (attempt === retryDelays.length - 1) throw new Error("Dashboard load failed");
        }
      }
    } catch {
      if (!options.silent || !dashboardRef.current) {
        setApiLoadProgress({
          percent: 100,
          label: "API 暂时无法连接",
          detail: "请稍等片刻后刷新页面，或联系管理员检查后端服务。",
          attempt: totalAttempts,
          totalAttempts,
          failed: true
        });
        setError("API 暂时无法连接，请稍等片刻后刷新。");
      }
    } finally {
      isLoadingDashboardRef.current = false;
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const markActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    window.addEventListener("touchstart", markActivity);
    window.addEventListener("wheel", markActivity);

    return () => {
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("wheel", markActivity);
    };
  }, []);

  useEffect(() => {
    const syncDashboard = async (options: { forceVersionCheck?: boolean; markActive?: boolean } = {}) => {
      if (options.markActive) {
        lastActivityAtRef.current = Date.now();
      }
      if (portalMode !== "teacher") return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityAtRef.current > dashboardIdlePauseMs) return;

      const nowMs = Date.now();
      if (!options.forceVersionCheck && nowMs - lastDashboardVersionCheckAtRef.current < 15000) {
        return;
      }
      lastDashboardVersionCheckAtRef.current = nowMs;

      try {
        const { version } = await getDashboardVersion();
        if (!latestDashboardVersionRef.current || version !== latestDashboardVersionRef.current) {
          await loadDashboard({ silent: true });
        }
      } catch {
        await loadDashboard({ silent: true });
      }
    };

    const handleVisibilityChange = () => {
      void syncDashboard({ forceVersionCheck: true });
    };
    const handleFocus = () => {
      void syncDashboard({ forceVersionCheck: true, markActive: true });
    };
    const handleResume = () => {
      const wasIdle = Date.now() - lastActivityAtRef.current > dashboardIdlePauseMs;
      void syncDashboard({ forceVersionCheck: wasIdle, markActive: true });
    };

    const timer = window.setInterval(() => {
      void syncDashboard();
    }, dashboardSyncIntervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pointerdown", handleResume);
    window.addEventListener("keydown", handleResume);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pointerdown", handleResume);
      window.removeEventListener("keydown", handleResume);
    };
  }, [portalMode]);

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

  useEffect(() => {
    setIsTaskListExpanded(false);
  }, [selectedStudentId, selectedTeacherGroup, isPendingReviewListOpen]);

  useEffect(() => {
    if (portalMode !== "teacher") return;
    if (window.localStorage.getItem(teacherGuideStorageKey)) return;
    setTeacherGuideStep(0);
    setIsTeacherGuideOpen(true);
  }, [portalMode]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string, tone: "success" | "error" = "success") {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  }

  function closeTeacherGuide() {
    window.localStorage.setItem(teacherGuideStorageKey, "1");
    setIsTeacherGuideOpen(false);
  }

  function locateTask(taskId: string, studentId: string) {
    setIsPendingReviewListOpen(false);
    setSelectedStudentId(studentId);
    setSelectedTeacherGroup(null);
    setLocatedTaskId(taskId);
  }

  function locatePendingReviewTask() {
    setSelectedStudentId("all");
    setSelectedTeacherGroup(null);
    setLocatedTaskId(null);
    setIsTaskListExpanded(true);
    setIsPendingReviewListOpen(true);
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
      const student = await createStudent(studentForm);
      await loadDashboard();
      setExpandedTeachers((current) => new Set(current).add(student.teacherId));
      setExpandedStudentGroups((current) => new Set(current).add(`${student.teacherId}::${student.group || "未分班"}`));
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

  function mergeTaskIntoDashboard(updatedTask: Task) {
    const currentDashboard = dashboardRef.current;
    if (!currentDashboard) return;

    const nextTasks = currentDashboard.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task));
    const correctedTaskIds = new Set(
      currentDashboard.taskFiles
        .filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"))
        .map((file) => file.taskId)
    );
    const nextDashboard: DashboardData = {
      ...currentDashboard,
      tasks: nextTasks,
      summary: {
        ...currentDashboard.summary,
        activeTasks: nextTasks.filter((task) => task.status !== "completed").length,
        pendingReview: nextTasks.filter((task) => task.status !== "completed" && !correctedTaskIds.has(task.id)).length
      }
    };

    dashboardRef.current = nextDashboard;
    setDashboard(nextDashboard);
  }

  async function handleCreateTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teacherFormName.trim();
    if (!name) {
      setTeacherFormError("请输入老师名字。");
      return;
    }

    setTeacherFormError("");
    setIsSavingTeacher(true);

    try {
      const teacher = await createTeacher({ name });
      setExpandedTeachers((current) => new Set(current).add(teacher.id));
      setTeacherFormName("");
      setIsTeacherFormOpen(false);
      await loadDashboard({ force: true });
    } catch {
      setTeacherFormError("老师保存失败，请确认后端服务正常。");
    } finally {
      setIsSavingTeacher(false);
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTaskFormError("");
    setIsSavingTask(true);

    try {
      if (taskFormMode === "group") {
        const groupStudents =
          dashboardRef.current?.students.filter(
            (student) => selectedTeacherGroup && student.teacherId === selectedTeacherGroup.teacherId && student.group === selectedTeacherGroup.groupName
          ) ?? [];

        if (!selectedTeacherGroup || groupStudents.length === 0) {
          setTaskFormError("当前班级没有学生，无法创建班级任务。");
          return;
        }

        const createdTasks = await Promise.all(
          groupStudents.map((student) =>
            createTask({
              ...taskForm,
              studentId: student.id
            })
          )
        );
        await loadDashboard();
        setSelectedStudentId("all");
        setIsPendingReviewListOpen(false);
        setLocatedTaskId(createdTasks[0]?.id ?? null);
        showToast(`已给 ${selectedTeacherGroup.groupName} 的 ${groupStudents.length} 个学生创建班级任务`);
      } else {
        const task = await createTask(taskForm);
        await loadDashboard();
        setSelectedStudentId(task.studentId);
        setSelectedTeacherGroup(null);
        setIsPendingReviewListOpen(false);
        setLocatedTaskId(task.id);
      }
      setTaskForm({
        ...emptyTaskForm,
        studentId: taskForm.studentId,
        dueDate: getDefaultTaskDueDate()
      });
      setIsTaskFormOpen(false);
    } catch {
      setTaskFormError(taskFormMode === "group" ? "班级任务保存失败，请确认后端服务正常。" : "任务保存失败，请检查学生和标题。");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function handleUploadAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentTaskId || assignmentFiles.length === 0) {
      setAssignmentError("请先选择要上传的作业/答案文件。");
      return;
    }

    const task = dashboard?.tasks.find((item) => item.id === assignmentTaskId);
    setAssignmentError("");
    setIsSavingAssignment(true);

    try {
      await runWithConcurrency(
        assignmentFiles,
        3,
        async (file) => {
          await uploadTaskFile(assignmentTaskId, {
            file,
            uploaderId: task?.studentId ?? "student",
            uploaderRole: "student",
            compressImage: file.type.startsWith("image/")
              ? {
                  maxSide: 1600,
                  quality: 0.78,
                  minBytes: 180 * 1024
                }
              : false
          });
        }
      );
      await updateTask(assignmentTaskId, {
        status: "submitted"
      });
      await loadDashboard();
      if (isPendingReviewListOpen) {
        setLocatedTaskId(null);
      } else if (task) {
        locateTask(task.id, task.studentId);
      }
      setAssignmentTaskId(null);
      setAssignmentFiles([]);
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
        status: "completed",
        teacherComment: correctionNote
      });
      await loadDashboard();
      if (isPendingReviewListOpen) {
        setLocatedTaskId(null);
      } else if (task) {
        locateTask(task.id, task.studentId);
      }
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
        setIsPendingReviewListOpen(false);
        setLocatedTaskId(null);
      }
      setDeleteStudentId(null);
    } catch {
      setDeleteStudentError("删除学生失败，请确认后端服务正常。");
    } finally {
      setIsDeletingStudent(false);
    }
  }

  function toggleStudentGroup(groupName: string) {
    setExpandedStudentGroups((current) => {
      const next = new Set(current);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }

  function toggleTeacher(teacherId: string) {
    setExpandedTeachers((current) => {
      const next = new Set(current);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  }

  function clearSelectedStudent() {
    setSelectedStudentId("all");
    setSelectedTeacherGroup(null);
    setIsPendingReviewListOpen(false);
    setLocatedTaskId(null);
  }

  async function handleUpdateStudentGroup(studentId: string, groupName: string) {
    try {
      const updatedStudent = await updateStudent(studentId, { group: groupName });
      setExpandedStudentGroups((current) => new Set(current).add(`${updatedStudent.teacherId}::${updatedStudent.group || "未分班"}`));
      setExpandedTeachers((current) => new Set(current).add(updatedStudent.teacherId));
      await loadDashboard();
    } catch {
      window.alert("修改学生班级失败，请确认后端服务正常。");
    }
  }

  function startStudentArchiveDrag(event: DragEvent<HTMLElement>, payload: StudentArchiveDragPayload) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(studentArchiveDragMime, JSON.stringify(payload));
  }

  function readStudentArchiveDrag(event: DragEvent<HTMLElement>) {
    try {
      const value = event.dataTransfer.getData(studentArchiveDragMime);
      if (!value) return null;
      return JSON.parse(value) as StudentArchiveDragPayload;
    } catch {
      return null;
    }
  }

  function handleStudentArchiveDragOver(event: DragEvent<HTMLElement>, targetKey: string) {
    if (!Array.from(event.dataTransfer.types).includes(studentArchiveDragMime)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetKey(targetKey);
  }

  function handleStudentArchiveDragLeave(event: DragEvent<HTMLElement>, targetKey: string) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragTargetKey((current) => (current === targetKey ? null : current));
  }

  function finishStudentArchiveDrag() {
    setDragTargetKey(null);
  }

  async function moveStudentToTarget(studentId: string, teacherName: string, groupName: string) {
    const student = dashboardRef.current?.students.find((item) => item.id === studentId);
    if (!student) return;
    const nextGroupName = groupName.trim() || student.group || "未分班";
    if (student.teacherName === teacherName && (student.group || "未分班") === nextGroupName) return;

    try {
      const updatedStudent = await updateStudent(studentId, { teacherName, group: nextGroupName });
      setExpandedTeachers((current) => new Set(current).add(updatedStudent.teacherId));
      setExpandedStudentGroups((current) => new Set(current).add(`${updatedStudent.teacherId}::${updatedStudent.group || "未分班"}`));
      await loadDashboard({ force: true });
      showToast(`${student.name} 已移动到 ${teacherName} / ${nextGroupName}`);
    } catch {
      showToast("移动学生失败：请确认目标老师或班级仍然存在，后端服务正常。", "error");
    }
  }

  async function moveGroupToTeacher(currentTeacherId: string, groupName: string, nextTeacherId: string, nextTeacherName: string) {
    if (currentTeacherId === nextTeacherId) return;

    try {
      const result = await moveTeacherGroup(currentTeacherId, { groupName, nextTeacherId });
      setExpandedTeachers((current) => new Set(current).add(result.teacherId));
      setExpandedStudentGroups((current) => new Set(current).add(`${result.teacherId}::${result.groupName}`));
      if (selectedTeacherGroup?.teacherId === currentTeacherId && selectedTeacherGroup.groupName === groupName) {
        setSelectedTeacherGroup({ teacherId: result.teacherId, teacherName: nextTeacherName, groupName: result.groupName });
      }
      await loadDashboard({ force: true });
      showToast(`${groupName} 班级已移动到 ${nextTeacherName}`);
    } catch {
      showToast("移动班级失败：请确认目标老师仍然存在，且该班级还有学生。", "error");
    }
  }

  async function handleDropOnTeacher(event: DragEvent<HTMLElement>, teacherId: string, teacherName: string) {
    event.preventDefault();
    const payload = readStudentArchiveDrag(event);
    finishStudentArchiveDrag();
    if (!payload) return;

    if (payload.type === "group") {
      await moveGroupToTeacher(payload.teacherId, payload.groupName, teacherId, teacherName);
      return;
    }

    const student = dashboardRef.current?.students.find((item) => item.id === payload.studentId);
    await moveStudentToTarget(payload.studentId, teacherName, student?.group || "未分班");
  }

  async function handleDropOnGroup(event: DragEvent<HTMLElement>, teacherId: string, teacherName: string, groupName: string) {
    event.preventDefault();
    const payload = readStudentArchiveDrag(event);
    finishStudentArchiveDrag();
    if (!payload) return;

    if (payload.type === "group") {
      await moveGroupToTeacher(payload.teacherId, payload.groupName, teacherId, teacherName);
      return;
    }

    await moveStudentToTarget(payload.studentId, teacherName, groupName);
  }

  async function handleRenameTeacher(teacherId: string, nextTeacherName: string) {
    try {
      await updateTeacherName(teacherId, { name: nextTeacherName });
      setExpandedTeachers((current) => new Set(current).add(teacherId));
      await loadDashboard();
    } catch {
      window.alert("修改老师名字失败，请确认后端服务正常。");
    }
  }

  async function handleRenameTeacherGroup(teacherId: string, currentGroupName: string, nextGroupName: string) {
    try {
      await renameTeacherGroup(teacherId, { currentGroupName, nextGroupName });
      setExpandedTeachers((current) => new Set(current).add(teacherId));
      setExpandedStudentGroups((current) => {
        const next = new Set(current);
        next.delete(`${teacherId}::${currentGroupName}`);
        next.add(`${teacherId}::${nextGroupName}`);
        return next;
      });
      if (selectedTeacherGroup?.teacherId === teacherId && selectedTeacherGroup.groupName === currentGroupName) {
        setSelectedTeacherGroup((current) => (current ? { ...current, groupName: nextGroupName } : current));
      }
      await loadDashboard();
    } catch {
      window.alert("修改班级名字失败，请确认后端服务正常。");
    }
  }

  async function handleRenameStudent(studentId: string, nextStudentName: string) {
    try {
      await updateStudent(studentId, { name: nextStudentName });
      await loadDashboard();
    } catch {
      window.alert("修改学生名字失败，请确认后端服务正常。");
    }
  }

  async function handleDeleteStudentGroup(teacherId: string, groupName: string, count: number) {
    if (!window.confirm(`确认删除「${groupName}」班级里的 ${count} 个学生吗？这些学生的任务、附件和家长导出记录也会一起删除。`)) return;
    setDeletingStudentGroup(`${teacherId}::${groupName}`);

    try {
      const selectedStudent = dashboardRef.current?.students.find((student) => student.id === selectedStudentId);
      await deleteTeacherGroup(teacherId, groupName);
      await loadDashboard();
      setExpandedStudentGroups((current) => {
        const next = new Set(current);
        next.delete(`${teacherId}::${groupName}`);
        return next;
      });
      if (selectedStudent?.teacherId === teacherId && selectedStudent.group === groupName) {
        setSelectedStudentId("all");
        setIsPendingReviewListOpen(false);
        setLocatedTaskId(null);
      }
      if (selectedTeacherGroup?.teacherId === teacherId && selectedTeacherGroup.groupName === groupName) {
        setSelectedTeacherGroup(null);
        setSelectedStudentId("all");
        setIsPendingReviewListOpen(false);
        setLocatedTaskId(null);
      }
    } catch {
      window.alert("删除班级学生失败，请确认后端服务正常。");
    } finally {
      setDeletingStudentGroup("");
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
        requester: "打印队列",
        copies: Number(printCopies),
        note: printNote
      });
      await loadDashboard();
      setPrintFile(null);
      setPrintCopies(1);
      setPrintNote("");
      setIsPrintFormOpen(false);
      openPrintQueue();
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

  async function handlePrintStatusChange(jobId: string, status: "pending" | "printed" | "cancelled") {
    try {
      await updatePrintJob(jobId, { status });
      await loadDashboard();
    } catch {
      window.alert("打印状态更新失败，请确认后端服务正常。");
    }
  }

  async function handleCreateSharedFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sharedFileUpload) {
      setSharedFileError("请先选择一个需要放进常用文件框的文件。");
      return;
    }

    setSharedFileError("");
    setIsSavingSharedFile(true);

    try {
      await createSharedFile({
        file: sharedFileUpload,
        uploaderId: "u-shared-file",
        uploaderRole: "teacher",
        uploaderName: "老师 / 助教",
        note: ""
      });
      setSharedFileUpload(null);
      await loadDashboard();
    } catch {
      setSharedFileError("常用文件上传失败，请确认文件和后端服务正常。");
    } finally {
      setIsSavingSharedFile(false);
    }
  }

  async function handleDeleteSharedFile(sharedFileId: string) {
    if (!window.confirm("确认删除这个常用文件吗？删除后其他助教将无法再下载或加入打印队列。")) return;
    setDeletingSharedFileId(sharedFileId);

    try {
      await deleteSharedFile(sharedFileId);
      await loadDashboard();
    } catch {
      window.alert("删除常用文件失败，请确认后端服务正常。");
    } finally {
      setDeletingSharedFileId(null);
    }
  }

  function openPrintQueue() {
    document.getElementById("print-queue-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function openTeacherDailyFeedbackForm() {
    const selectedTasks = dashboard?.tasks.filter((task) => task.studentId === selectedStudentId) ?? [];
    const availableDates = Array.from(new Set(selectedTasks.map((task) => getTaskDateKey(task.dueDate)).filter(Boolean))).sort().reverse();
    setDailyFeedbackDate(availableDates[0] ?? getTodayDateInputValue());
    setDailyFeedbackError("");
    setIsDailyFeedbackFormOpen(true);
  }

  async function handleTeacherDownloadDailyFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedStudentId === "all" || !selectedTeacherStudent || !dailyFeedbackDate) return;

    setIsDownloadingDailyFeedback(true);
    setDailyFeedbackError("");
    try {
      const fallbackFileName = `${sanitizeDownloadFileName(selectedTeacherStudent.name, "学生")}-${dailyFeedbackDate}-当日全部作业反馈.pdf`;
      const { blob, fileName } = await downloadDailyFeedbackPdf(selectedStudentId, dailyFeedbackDate, fallbackFileName);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setIsDailyFeedbackFormOpen(false);
    } catch {
      setDailyFeedbackError("这一天没有可导出的任务，或后端 PDF 生成失败。");
    } finally {
      setIsDownloadingDailyFeedback(false);
    }
  }

  function openTaskForm() {
    const fallbackStudentId = dashboard?.students[0]?.id ?? "";
    setTaskFormMode("student");
    setTaskForm({
      ...emptyTaskForm,
      studentId: selectedStudentId === "all" ? fallbackStudentId : selectedStudentId,
      dueDate: getDefaultTaskDueDate()
    });
    setTaskFormError("");
    setIsTaskFormOpen(true);
  }

  function openGroupTaskForm() {
    const groupStudents =
      dashboard?.students.filter(
        (student) => selectedTeacherGroup && student.teacherId === selectedTeacherGroup.teacherId && student.group === selectedTeacherGroup.groupName
      ) ?? [];
    setTaskFormMode("group");
    setTaskForm({
      ...emptyTaskForm,
      studentId: groupStudents[0]?.id ?? "",
      dueDate: getDefaultTaskDueDate()
    });
    setTaskFormError("");
    setIsTaskFormOpen(true);
  }

  function openAssignmentForm(taskId: string) {
    setAssignmentTaskId(taskId);
    setAssignmentFiles([]);
    setAssignmentError("");
  }

  function handleAssignmentFilesChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;

    setAssignmentFiles((current) => {
      const nextFiles = [...current];
      selectedFiles.forEach((file) => {
        const duplicate = nextFiles.some(
          (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
        );
        if (!duplicate) nextFiles.push(file);
      });
      setAssignmentError("");
      return nextFiles;
    });
  }

  function removeAssignmentFile(index: number) {
    setAssignmentFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function openCorrectionForm(taskId: string) {
    setCorrectionTaskId(taskId);
    setCorrectionFiles([]);
    setCorrectionNote("");
    setCorrectionError("");
  }

  function handleCorrectionFilesChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;

    setCorrectionFiles((current) => {
      const nextFiles = [...current];
      selectedFiles.forEach((file) => {
        const duplicate = nextFiles.some(
          (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
        );
        if (!duplicate) nextFiles.push(file);
      });

      if (nextFiles.length > 9) {
        setCorrectionError("一次最多只能上传 9 张批改照片，请删减后再提交。");
        return nextFiles.slice(0, 9);
      }

      setCorrectionError("");
      return nextFiles;
    });
  }

  function removeCorrectionFile(index: number) {
    setCorrectionFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  if (!dashboard) {
    return (
      <main className="boot-screen">
        <section className="api-loading-panel" aria-live="polite" aria-busy={!apiLoadProgress.failed}>
          <div className="api-loading-icon">
            <Loader2 className="spin" size={30} />
          </div>
          <div className="api-loading-copy">
            <span>QULEDA API</span>
            <h1>{apiLoadProgress.label}</h1>
            <p>{apiLoadProgress.detail}</p>
          </div>
          <div className="api-progress-row">
            <div
              className={`api-progress-track${apiLoadProgress.failed ? " is-error" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={apiLoadProgress.percent}
              aria-label="API 加载进度"
            >
              <span style={{ width: `${apiLoadProgress.percent}%` }} />
            </div>
            <strong>{apiLoadProgress.percent}%</strong>
          </div>
          <small>
            {error ||
              `连接尝试 ${Math.min(apiLoadProgress.attempt + 1, apiLoadProgress.totalAttempts)} / ${apiLoadProgress.totalAttempts}`}
          </small>
        </section>
      </main>
    );
  }

  const correctionTask = correctionTaskId ? dashboard.tasks.find((task) => task.id === correctionTaskId) : undefined;

  if (portalMode === "landing") {
    return <LandingPortal onTeacher={() => setPortalMode("teacher")} onStudent={() => setPortalMode("student")} />;
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

  const selectedGroupStudents = selectedTeacherGroup
    ? dashboard.students.filter((student) => student.teacherId === selectedTeacherGroup.teacherId && student.group === selectedTeacherGroup.groupName)
    : [];
  const selectedGroupStudentIds = new Set(selectedGroupStudents.map((student) => student.id));
  const tasksWithCorrection = new Set(
    dashboard.taskFiles
      .filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"))
      .map((file) => file.taskId)
  );
  const selectedStudentTasks = isPendingReviewListOpen
    ? dashboard.tasks.filter((task) => task.status !== "completed" && !tasksWithCorrection.has(task.id))
    : selectedTeacherGroup
    ? dashboard.tasks.filter((task) => selectedGroupStudentIds.has(task.studentId))
    : selectedStudentId === "all"
      ? dashboard.tasks
      : dashboard.tasks.filter((task) => task.studentId === selectedStudentId);
  const orderedSelectedStudentTasks =
    selectedStudentId === "all" && !selectedTeacherGroup && !isPendingReviewListOpen ? selectedStudentTasks : sortTasksByLatest(selectedStudentTasks);
  const isDefaultTaskOverview = selectedStudentId === "all" && !selectedTeacherGroup && !isPendingReviewListOpen;
  const taskPreviewLimit = isDefaultTaskOverview ? 5 : 3;
  const visibleSelectedStudentTasks =
    isPendingReviewListOpen || isTaskListExpanded
      ? orderedSelectedStudentTasks
      : orderedSelectedStudentTasks.slice(0, taskPreviewLimit);
  const selectedTeacherStudent = selectedStudentId === "all" ? undefined : dashboard.students.find((student) => student.id === selectedStudentId);
  const teacherFeedbackDates = Array.from(new Set(selectedStudentTasks.map((task) => getTaskDateKey(task.dueDate)).filter(Boolean))).sort().reverse();
  const teacherGroups = groupStudentsByTeacher(dashboard.students, dashboard.users);
  const normalizedStudentSearch = studentSearchQuery.trim().toLowerCase();
  const filteredTeacherGroups = normalizedStudentSearch
    ? teacherGroups
        .map((teacher) => ({
          ...teacher,
          groups: teacher.groups
            .map((group) => ({
              ...group,
              students: group.students.filter((student) => student.name.toLowerCase().includes(normalizedStudentSearch))
            }))
            .filter((group) => group.students.length > 0)
        }))
        .filter((teacher) => teacher.groups.length > 0)
    : teacherGroups;
  const visibleAuditLogs = isAuditExpanded ? dashboard.auditLogs : dashboard.auditLogs.slice(0, 5);
  return (
    <main className="app-shell">
      <button
        type="button"
        className="portal-return-button"
        onClick={() => {
          setPortalMode("landing");
        }}
      >
        <ArrowLeft size={16} />
        返回主界面
      </button>
      <button
        type="button"
        className="teacher-guide-button"
        onClick={() => setIsTeacherGuidePreviewOpen(true)}
      >
        <BookOpenCheck size={15} />
        使用说明
      </button>
      <section className="top-dashboard">
        <div className="top-dashboard-main">
          <section className="hero-card">
            <div className="brand-title-wrap" aria-label="QULEDA">
              <p className="brand-kicker">IELTS Teaching Operations</p>
              <h1 className="brand-title">
                <span>Q</span>
                  <span>U</span>
                <span>L</span>
                <span>E</span>
                <span>D</span>
                <span>A</span>
              </h1>
              <p className="brand-subtitle">Teaching task flow</p>
            </div>
            <div className="hero-panel teacher-hero-panel">
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
                setSelectedTeacherGroup(null);
                setIsPendingReviewListOpen(false);
                setLocatedTaskId(null);
              }}
            />
            <Metric
              icon={<BookOpenCheck />}
              label="待批改"
              value={dashboard.summary.pendingReview}
              helper="查看全部待批改任务"
              onClick={locatePendingReviewTask}
            />
            <Metric
              icon={<Printer />}
              label="打印队列"
              value={dashboard.summary.pendingPrintJobs}
              helper="添加打印文件"
              highlight={isTeacherGuideOpen && teacherGuideStep === 2}
              onClick={() => {
                setPrintError("");
                setIsPrintFormOpen(true);
              }}
            />
          </div>
        </div>
        <div className="top-dashboard-side">
          <SharedFilesPanel
            files={dashboard.sharedFiles}
            error={sharedFileError}
            uploadFile={sharedFileUpload}
            searchQuery={sharedFileSearchQuery}
            isSaving={isSavingSharedFile}
            deletingFileId={deletingSharedFileId}
            onFileChange={setSharedFileUpload}
            onSearchChange={setSharedFileSearchQuery}
            onSubmit={handleCreateSharedFile}
            onPreview={(file) => setPreviewFile({ name: file.fileName, url: file.fileUrl, fileType: file.fileType })}
            onDelete={(sharedFileId) => void handleDeleteSharedFile(sharedFileId)}
          />
          <PrintQueuePanel
            jobs={dashboard.printJobs}
            deletingPrintJobId={deletingPrintJobId}
            pendingCount={dashboard.summary.pendingPrintJobs}
            searchQuery={printQueueSearchQuery}
            onSearchChange={setPrintQueueSearchQuery}
            onStatusChange={(jobId, status) => void handlePrintStatusChange(jobId, status)}
            onDelete={(jobId) => void handleDeletePrintJob(jobId)}
          />
        </div>
      </section>

      <section className="workspace">
        <aside className="side-card">
          <div className="section-heading">
            <span>学生档案</span>
            <ShieldCheck size={18} />
          </div>
          <button
            className={isTeacherGuideOpen && teacherGuideStep === 0 ? "add-student-button guide-highlight" : "add-student-button"}
            onClick={() => setIsStudentFormOpen(true)}
          >
            <Plus size={17} />
            添加学生
          </button>
          <label className="student-search-box">
            <span>搜索学生</span>
            <input
              value={studentSearchQuery}
              onChange={(event) => setStudentSearchQuery(event.target.value)}
              placeholder="输入学生姓名"
              aria-label="搜索学生姓名"
            />
          </label>
          <button
            className={selectedStudentId === "all" && !selectedTeacherGroup && !isPendingReviewListOpen ? "student-item active" : "student-item"}
            onClick={() => {
              setSelectedStudentId("all");
              setSelectedTeacherGroup(null);
              setIsPendingReviewListOpen(false);
              setLocatedTaskId(null);
            }}
          >
            <strong>全部学生</strong>
          </button>
          <p className="archive-quick-tip">拖动学生或班级可移动到其他老师/班级；小齿轮可修改名称。</p>
          <div className="student-group-list">
            {filteredTeacherGroups.length === 0 && (
              <div className="student-search-empty">
                <strong>没有找到学生</strong>
                <span>换一个姓名关键词试试。</span>
              </div>
            )}
            {filteredTeacherGroups.map(({ teacherId, teacherName, groups }) => {
              const hasSelectedStudentInTeacher = groups.some(({ students }) => students.some((student) => student.id === selectedStudentId));
              const hasSelectedGroupInTeacher = selectedTeacherGroup?.teacherId === teacherId;
              const teacherExpanded = Boolean(normalizedStudentSearch) || expandedTeachers.has(teacherId) || hasSelectedStudentInTeacher || hasSelectedGroupInTeacher;
              return (
                <section key={teacherId} className="student-group teacher-group">
                  <TeacherFolderRow
                    teacherName={teacherName}
                    studentCount={groups.reduce((total, group) => total + group.students.length, 0)}
                    expanded={teacherExpanded}
                    onToggle={() => {
                      if (teacherExpanded) {
                        toggleTeacher(teacherId);
                        if (hasSelectedStudentInTeacher || hasSelectedGroupInTeacher) {
                          clearSelectedStudent();
                        }
                        return;
                      }
                      toggleTeacher(teacherId);
                    }}
                    onRename={(nextTeacherName) => void handleRenameTeacher(teacherId, nextTeacherName)}
                    dropActive={dragTargetKey === `teacher:${teacherId}`}
                    onDragOver={(event) => handleStudentArchiveDragOver(event, `teacher:${teacherId}`)}
                    onDragLeave={(event) => handleStudentArchiveDragLeave(event, `teacher:${teacherId}`)}
                    onDrop={(event) => void handleDropOnTeacher(event, teacherId, teacherName)}
                  />
                  {teacherExpanded && (
                    <div className="student-group-body teacher-group-body">
                      {groups.map(({ groupName, students }) => {
                        const groupKey = `${teacherId}::${groupName}`;
                        const isSelectedGroup =
                          selectedTeacherGroup?.teacherId === teacherId && selectedTeacherGroup.groupName === groupName;
                        const isExpanded =
                          Boolean(normalizedStudentSearch) ||
                          expandedStudentGroups.has(groupKey) ||
                          isSelectedGroup ||
                          students.some((student) => student.id === selectedStudentId);
                        return (
                          <section key={groupKey} className="student-group nested-group">
                            <div className="student-group-header">
                              <GroupFolderRow
                                groupName={groupName}
                                studentCount={students.length}
                                expanded={isExpanded}
                                onToggle={() => {
                                  const hasSelectedStudentInGroup = students.some((student) => student.id === selectedStudentId);
                                  if (isExpanded) {
                                    toggleStudentGroup(groupKey);
                                    if (hasSelectedStudentInGroup || isSelectedGroup) {
                                      clearSelectedStudent();
                                    }
                                    return;
                                  }
                                  setSelectedTeacherGroup({ teacherId, teacherName, groupName });
                                  setSelectedStudentId("all");
                                  setIsPendingReviewListOpen(false);
                                  setLocatedTaskId(null);
                                  toggleStudentGroup(groupKey);
                                }}
                                onRename={(nextGroupName) => void handleRenameTeacherGroup(teacherId, groupName, nextGroupName)}
                                draggable
                                selected={isSelectedGroup}
                                dropActive={dragTargetKey === `group:${groupKey}`}
                                onDragStart={(event) => startStudentArchiveDrag(event, { type: "group", teacherId, groupName })}
                                onDragEnd={finishStudentArchiveDrag}
                                onDragOver={(event) => handleStudentArchiveDragOver(event, `group:${groupKey}`)}
                                onDragLeave={(event) => handleStudentArchiveDragLeave(event, `group:${groupKey}`)}
                                onDrop={(event) => void handleDropOnGroup(event, teacherId, teacherName, groupName)}
                              />
                              <button
                                type="button"
                                className="delete-student-button group-delete-button"
                                onClick={() => void handleDeleteStudentGroup(teacherId, groupName, students.length)}
                                disabled={deletingStudentGroup === groupKey}
                                aria-label={`删除 ${groupName} 班级所有学生`}
                              >
                                <X size={15} />
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="student-group-body">
                                {students.map((student) => (
                                  <StudentCard
                                    key={student.id}
                                    student={student}
                                    active={student.id === selectedStudentId}
                                    groupOptions={groups.map((group) => group.groupName)}
                                    onSelect={() => {
                                      if (selectedStudentId === student.id) {
                                        clearSelectedStudent();
                                        return;
                                      }
                                      setSelectedStudentId(student.id);
                                      setSelectedTeacherGroup(null);
                                      setIsPendingReviewListOpen(false);
                                      setLocatedTaskId(null);
                                    }}
                                    onDelete={() => setDeleteStudentId(student.id)}
                                    onUpdateGroup={(groupName) => void handleUpdateStudentGroup(student.id, groupName)}
                                    onRename={(nextStudentName) => void handleRenameStudent(student.id, nextStudentName)}
                                    draggable
                                    onDragStart={(event) => startStudentArchiveDrag(event, { type: "student", studentId: student.id })}
                                    onDragEnd={finishStudentArchiveDrag}
                                  />
                                ))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            <button
              className={isTeacherGuideOpen && teacherGuideStep === 0 ? "add-teacher-button guide-highlight" : "add-teacher-button"}
              onClick={() => {
                setTeacherFormError("");
                setIsTeacherFormOpen(true);
              }}
            >
              <Plus size={15} />
              添加老师
            </button>
          </div>
        </aside>

        <section className="task-board">
          <div className="board-header">
            <div>
              <p className="eyebrow">Task Queue</p>
              <div className="student-task-title-row">
                <h2>
                  {selectedTeacherGroup
                    ? `任务队列-${selectedTeacherGroup.groupName}`
                    : isPendingReviewListOpen
                      ? "任务队列-待批改"
                      : selectedStudentId === "all"
                        ? "任务队列"
                        : `任务队列--${selectedTeacherStudent?.name ?? ""}`}
                </h2>
                {selectedTeacherStudent && (
                  <button type="button" className="daily-feedback-button" onClick={openTeacherDailyFeedbackForm}>
                    <Download size={16} />
                    导出当日反馈
                  </button>
                )}
              </div>
              <p className="board-hint">助教可以在任务卡片中上传批改后的作业，并把任务状态更新为已批改。</p>
            </div>
            <div className="board-header-actions">
              {selectedTeacherGroup && (
                <button className="secondary-action" onClick={openGroupTaskForm}>
                  <ClipboardList size={18} />
                  创建班级任务
                </button>
              )}
              <button className={isTeacherGuideOpen && teacherGuideStep === 1 ? "primary-action guide-highlight" : "primary-action"} onClick={openTaskForm}>
                <UploadCloud size={18} />
                新建任务
              </button>
            </div>
          </div>

          <div className="task-list">
            {selectedStudentTasks.length === 0 && (
              <div className="empty-state">
                <strong>{isPendingReviewListOpen ? "当前没有待批改任务" : selectedTeacherGroup ? "当前班级还没有任务" : "当前学生还没有任务"}</strong>
                <span>
                  {isPendingReviewListOpen
                    ? "所有未完成且还没有助教批改图片的任务，都会出现在这里。"
                    : selectedTeacherGroup
                      ? "可以创建班级任务，或选择其他班级查看。"
                      : "可以新建任务，或者选择其他学生档案查看。"}
                </span>
              </div>
            )}
            {visibleSelectedStudentTasks.map((task) => {
              const files = dashboard.taskFiles.filter((file) => file.taskId === task.id);
              const taskStudent = dashboard.students.find((student) => student.id === task.studentId);
              return (
                <article
                  id={`task-${task.id}`}
                  key={task.id}
                  className={locatedTaskId === task.id ? "task-card located" : "task-card"}
                >
                  <button className="delete-task-button" onClick={() => setDeleteTaskId(task.id)} aria-label="删除任务">
                    <X size={16} />
                  </button>
                  <TaskCompletionToggle
                    task={task}
                    disabled={updatingTaskStatusId === task.id}
                    onChange={async (status) => {
                      const previousTask = task;
                      mergeTaskIntoDashboard({ ...task, status });
                      setUpdatingTaskStatusId(task.id);
                      try {
                        const savedTask = await updateTask(task.id, { status });
                        mergeTaskIntoDashboard(savedTask);
                        window.setTimeout(() => {
                          void loadDashboard({ silent: true });
                        }, 1200);
                      } catch {
                        mergeTaskIntoDashboard(previousTask);
                        showToast("任务状态更新失败，请确认后端服务正常。", "error");
                      } finally {
                        setUpdatingTaskStatusId(null);
                      }
                    }}
                  />
                  <div className="task-card-body">
                    <div className="task-main">
                      <TaskTitleEditor task={task} onSave={mergeTaskIntoDashboard} />
                      <div className="task-meta">
                        {taskStudent && <span>学生 {taskStudent.name}</span>}
                        <span>DDL {formatTaskDueDate(task.dueDate)}</span>
                      </div>
                      {task.description && <p>{task.description}</p>}
                      <TaskFileGallery
                        files={files}
                        section="assignment"
                        deletingFileId={deletingFileId}
                        onDeleteFile={(fileId) => void handleDeleteFile(fileId)}
                        onPreview={setPreviewFile}
                      />
                    </div>

                    <div className="task-review-column">
                      <TaskFileGallery
                        files={files}
                        section="correction"
                        deletingFileId={deletingFileId}
                        onDeleteFile={(fileId) => void handleDeleteFile(fileId)}
                        onPreview={setPreviewFile}
                      />
                      <TeacherNoteEditor task={task} onSave={mergeTaskIntoDashboard} />
                    </div>
                  </div>

                  <div className="task-action-bar">
                    <button onClick={() => openAssignmentForm(task.id)} disabled={busyTaskId === task.id}>
                      <BookOpenCheck size={16} />
                      参考答案
                    </button>
                    <button onClick={() => openAssignmentForm(task.id)} disabled={busyTaskId === task.id}>
                      <UploadCloud size={16} />
                      上传作业
                    </button>
                    <button
                      className={isTeacherGuideOpen && teacherGuideStep === 2 ? "guide-highlight" : undefined}
                      onClick={() => openCorrectionForm(task.id)}
                      disabled={busyTaskId === task.id}
                    >
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
          {!isPendingReviewListOpen && orderedSelectedStudentTasks.length > taskPreviewLimit && (
            <button type="button" className="audit-toggle-button" onClick={() => setIsTaskListExpanded((current) => !current)}>
              {isTaskListExpanded ? "收起任务" : `展开更多（${orderedSelectedStudentTasks.length - taskPreviewLimit} 条）`}
            </button>
          )}
        </section>
      </section>

      <section className="flow-grid">
        <FlowCard icon={<UploadCloud />} title="老师布置任务" text="上传讲义、说明要求，并跟进学生提交情况。" />
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

      {isTeacherGuideOpen && (
        <aside className="teacher-onboarding-card" aria-live="polite">
          <div>
            <p className="eyebrow">Quick Start</p>
            <h2>{teacherOnboardingSteps[teacherGuideStep].title}</h2>
            <span>{teacherOnboardingSteps[teacherGuideStep].text}</span>
          </div>
          <div className="teacher-onboarding-progress">
            {teacherOnboardingSteps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                className={index === teacherGuideStep ? "active" : ""}
                onClick={() => setTeacherGuideStep(index)}
                aria-label={`查看第 ${index + 1} 步`}
              />
            ))}
          </div>
          <div className="teacher-onboarding-actions">
            <button
              type="button"
              className="ghost-guide-action"
              onClick={() => setIsTeacherGuidePreviewOpen(true)}
            >
              预览说明书
            </button>
            {teacherGuideStep < teacherOnboardingSteps.length - 1 ? (
              <button type="button" className="solid-guide-action" onClick={() => setTeacherGuideStep((current) => current + 1)}>
                下一步
              </button>
            ) : (
              <button type="button" className="solid-guide-action" onClick={closeTeacherGuide}>
                开始使用
              </button>
            )}
          </div>
          <button type="button" className="teacher-onboarding-close" onClick={closeTeacherGuide} aria-label="关闭首次引导">
            <X size={15} />
          </button>
        </aside>
      )}

      {toast && <div className={`toast-message ${toast.tone}`}>{toast.message}</div>}

      {isTeacherGuidePreviewOpen && <GuidePreviewModal onClose={() => setIsTeacherGuidePreviewOpen(false)} />}

      {previewFile && (
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}

      {isDailyFeedbackFormOpen && selectedTeacherStudent && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form compact-export-form" onSubmit={(event) => void handleTeacherDownloadDailyFeedback(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Daily PDF</p>
                <h3>导出 {selectedTeacherStudent.name} 的全部作业反馈</h3>
              </div>
              <button type="button" onClick={() => setIsDailyFeedbackFormOpen(false)} aria-label="关闭导出弹窗">
                <X size={18} />
              </button>
            </div>
            <label>
              选择 DDL 日期
              <input
                required
                type="date"
                value={dailyFeedbackDate}
                list="teacher-daily-feedback-dates"
                onChange={(event) => setDailyFeedbackDate(event.target.value)}
              />
              <datalist id="teacher-daily-feedback-dates">
                {teacherFeedbackDates.map((date) => (
                  <option key={date} value={date} />
                ))}
              </datalist>
            </label>
            {teacherFeedbackDates.length > 0 && (
              <div className="feedback-date-chips">
                {teacherFeedbackDates.slice(0, 6).map((date) => (
                  <button
                    key={date}
                    type="button"
                    className={date === dailyFeedbackDate ? "is-selected" : undefined}
                    aria-pressed={date === dailyFeedbackDate}
                    onClick={() => setDailyFeedbackDate(date)}
                  >
                    {date}
                  </button>
                ))}
              </div>
            )}
            {dailyFeedbackError && <p className="form-error">{dailyFeedbackError}</p>}
            <button className="submit-button" type="submit" disabled={isDownloadingDailyFeedback || !dailyFeedbackDate}>
              {isDownloadingDailyFeedback ? "生成中..." : "生成并下载 PDF"}
            </button>
          </form>
        </div>
      )}

      {isPrintFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form print-job-form" onSubmit={(event) => void handleCreatePrintJob(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Print Queue</p>
                <h2>添加打印文件</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsPrintFormOpen(false)}>
                <X size={18} />
              </button>
            </div>

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
              <textarea value={printNote} onChange={(event) => setPrintNote(event.target.value)} placeholder="例如：双面打印 / 彩印 / 下课前拿走" />
            </label>

            {printError && <p className="form-error">{printError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingPrintJob}>
              {isSavingPrintJob ? "添加中..." : "加入打印队列"}
            </button>
          </form>
        </div>
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
              所在班级
              <input
                required
                value={studentForm.group}
                onChange={(event) => setStudentForm({ ...studentForm, group: event.target.value })}
                placeholder="例如：VIP 一对一 / 写作班"
              />
            </label>
            <label>
              所属老师
              <input
                required
                value={studentForm.teacherName}
                onChange={(event) => setStudentForm({ ...studentForm, teacherName: event.target.value })}
                placeholder="例如：Lily 老师"
              />
            </label>

            {studentFormError && <p className="form-error">{studentFormError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingStudent}>
              {isSavingStudent ? "保存中..." : "保存到学生档案"}
            </button>
          </form>
        </div>
      )}
      {isTeacherFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleCreateTeacher(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Teacher Profile</p>
                <h2>添加老师</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsTeacherFormOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <label>
              老师姓名
              <input
                required
                value={teacherFormName}
                onChange={(event) => setTeacherFormName(event.target.value)}
                placeholder="例如：Louise"
              />
            </label>

            {teacherFormError && <p className="form-error">{teacherFormError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingTeacher}>
              {isSavingTeacher ? "保存中..." : "保存到老师列表"}
            </button>
          </form>
        </div>
      )}
      {isTaskFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form task-setup-form" onSubmit={(event) => void handleCreateTask(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Task Setup</p>
                <h2>{taskFormMode === "group" && selectedTeacherGroup ? `创建 ${selectedTeacherGroup.groupName} 班级任务` : "新建学生任务"}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsTaskFormOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {taskFormMode === "student" ? (
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
            ) : (
              <div className="class-task-target">
                <span>目标班级</span>
                <strong>{selectedTeacherGroup?.groupName}</strong>
                <small>{selectedGroupStudents.length} 个学生会收到同一份任务</small>
              </div>
            )}
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
              DDL
              <input
                required
                type="datetime-local"
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

            <button className="submit-button" type="submit" disabled={isSavingTask || !dashboard.students.length || (taskFormMode === "group" && selectedGroupStudents.length === 0)}>
              {isSavingTask ? "保存中..." : taskFormMode === "group" ? "保存到班级所有学生" : "保存到任务列表"}
            </button>
          </form>
        </div>
      )}
      {assignmentTaskId && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form" onSubmit={(event) => void handleUploadAssignment(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Assignment Upload</p>
                <h2>上传作业/答案</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setAssignmentTaskId(null)}>
                <X size={18} />
              </button>
            </div>

            <label>
              作业/答案文件
              <input
                required
                multiple
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.mp3,.mp4"
                onChange={(event) => handleAssignmentFilesChange(event.target.files)}
              />
            </label>
            <p className="form-context">可以一次选择多份作业、答案或参考附件，也可以分几次补选，最后统一上传。</p>
            {assignmentFiles.length > 0 && (
              <>
                <p className="form-context">已选择 {assignmentFiles.length} 个作业/答案文件</p>
                <div className="selected-file-list">
                  {assignmentFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="selected-file-item">
                      <span title={file.name}>{file.name}</span>
                      <button type="button" className="selected-file-remove" onClick={() => removeAssignmentFile(index)}>
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {assignmentError && <p className="form-error">{assignmentError}</p>}

            <button className="submit-button" type="submit" disabled={isSavingAssignment}>
              {isSavingAssignment ? "上传中..." : "上传作业/答案并标记为已提交"}
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
            <p className="form-context">可以一次选择多张，也可以分几次补选，最后统一提交。最多 9 张。</p>
            {correctionFiles.length > 0 && (
              <>
                <p className="form-context">已选择 {correctionFiles.length} 张批改照片</p>
                <div className="selected-file-list">
                  {correctionFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="selected-file-item">
                      <span title={file.name}>{file.name}</span>
                      <button type="button" className="selected-file-remove" onClick={() => removeCorrectionFile(index)}>
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
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
    <div className="brand-title-wrap" aria-label="QULEDA">
      <p className="brand-kicker">IELTS Teaching Operations</p>
      <h1 className="brand-title">
        <span>Q</span>
          <span>U</span>
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
              <span>直接进入完整教学后台</span>
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
  const [isTaskListExpanded, setIsTaskListExpanded] = useState(false);
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [expandedTeachers, setExpandedTeachers] = useState<Set<string>>(() => new Set());
  const [expandedStudentGroups, setExpandedStudentGroups] = useState<Set<string>>(() => new Set());
  const [draggingArchiveItem, setDraggingArchiveItem] = useState<{ type: "student" | "group"; studentId?: string; teacherId?: string; groupName?: string } | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [isDailyFeedbackFormOpen, setIsDailyFeedbackFormOpen] = useState(false);
  const [dailyFeedbackDate, setDailyFeedbackDate] = useState(getTodayDateInputValue());
  const [dailyFeedbackError, setDailyFeedbackError] = useState("");
  const [isDownloadingDailyFeedback, setIsDownloadingDailyFeedback] = useState(false);
  const sortedStudents = sortStudentsByGroup(dashboard.students);
  const selectedStudent = sortedStudents.find((student) => student.id === selectedStudentId);
  const selectedTasks = selectedStudent ? sortTasksByLatest(dashboard.tasks.filter((task) => task.studentId === selectedStudent.id)) : [];
  const visibleSelectedTasks = isTaskListExpanded ? selectedTasks : selectedTasks.slice(0, 3);
  const availableFeedbackDates = Array.from(new Set(selectedTasks.map((task) => getTaskDateKey(task.dueDate)).filter(Boolean))).sort().reverse();
  const teacherGroups = groupStudentsByTeacher(dashboard.students, dashboard.users);
  const normalizedStudentSearch = studentSearchQuery.trim().toLowerCase();
  const filteredTeacherGroups = normalizedStudentSearch
    ? teacherGroups
        .map((teacher) => ({
          ...teacher,
          groups: teacher.groups
            .map((group) => ({
              ...group,
              students: group.students.filter((student) => student.name.toLowerCase().includes(normalizedStudentSearch))
            }))
            .filter((group) => group.students.length > 0)
        }))
        .filter((teacher) => teacher.groups.length > 0)
    : teacherGroups;

  useEffect(() => {
    setIsTaskListExpanded(false);
  }, [selectedStudentId]);

  function startStudentArchiveDrag(
    event: DragEvent<HTMLElement>,
    item: { type: "student" | "group"; studentId?: string; teacherId?: string; groupName?: string }
  ) {
    setDraggingArchiveItem(item);
    event.dataTransfer.effectAllowed = "move";
  }

  function finishStudentArchiveDrag() {
    setDraggingArchiveItem(null);
    setDragTargetKey(null);
  }

  function handleStudentArchiveDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (!draggingArchiveItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetKey(key);
  }

  function handleStudentArchiveDragLeave(event: DragEvent<HTMLElement>, key: string) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dragTargetKey === key) {
      setDragTargetKey(null);
    }
  }

  function completeReadonlyDrop() {
    finishStudentArchiveDrag();
  }

  function openDailyFeedbackForm() {
    setDailyFeedbackDate(availableFeedbackDates[0] ?? getTodayDateInputValue());
    setDailyFeedbackError("");
    setIsDailyFeedbackFormOpen(true);
  }

  async function handleDownloadDailyFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent || !dailyFeedbackDate) return;

    setIsDownloadingDailyFeedback(true);
    setDailyFeedbackError("");
    try {
      const fallbackFileName = `${sanitizeDownloadFileName(selectedStudent.name, "学生")}-${dailyFeedbackDate}-当日全部作业反馈.pdf`;
      const { blob, fileName } = await downloadDailyFeedbackPdf(selectedStudent.id, dailyFeedbackDate, fallbackFileName);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setIsDailyFeedbackFormOpen(false);
    } catch {
      setDailyFeedbackError("这一天没有可导出的任务，或后端 PDF 生成失败。");
    } finally {
      setIsDownloadingDailyFeedback(false);
    }
  }

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
          <label className="student-search-box">
            <span>搜索学生</span>
            <input
              value={studentSearchQuery}
              onChange={(event) => setStudentSearchQuery(event.target.value)}
              placeholder="输入学生姓名"
              aria-label="搜索学生姓名"
            />
          </label>
          <div className="student-group-list">
            {filteredTeacherGroups.length === 0 && (
              <div className="student-search-empty">
                <strong>没有找到学生</strong>
                <span>换一个姓名关键词试试。</span>
              </div>
            )}
            {filteredTeacherGroups.map(({ teacherId, teacherName, groups }) => {
              const hasSelectedStudentInTeacher = groups.some(({ students }) => students.some((student) => student.id === selectedStudent?.id));
              const teacherExpanded = Boolean(normalizedStudentSearch) || expandedTeachers.has(teacherId) || hasSelectedStudentInTeacher;
              return (
                <section key={teacherId} className="student-group teacher-group">
                  <TeacherFolderRow
                    teacherName={teacherName}
                    studentCount={groups.reduce((total, group) => total + group.students.length, 0)}
                    expanded={teacherExpanded}
                    onToggle={() => {
                      if (teacherExpanded) {
                        setExpandedTeachers((current) => {
                          const next = new Set(current);
                          next.delete(teacherId);
                          return next;
                        });
                        if (hasSelectedStudentInTeacher) {
                          onStudentChange("");
                        }
                        return;
                      }
                      setExpandedTeachers((current) => {
                        const next = new Set(current);
                        next.add(teacherId);
                        return next;
                      });
                    }}
                    dropActive={dragTargetKey === `teacher:${teacherId}`}
                    onDragOver={(event) => handleStudentArchiveDragOver(event, `teacher:${teacherId}`)}
                    onDragLeave={(event) => handleStudentArchiveDragLeave(event, `teacher:${teacherId}`)}
                    onDrop={completeReadonlyDrop}
                  />
                  {teacherExpanded && (
                    <div className="student-group-body teacher-group-body">
                      {groups.map(({ groupName, students }) => {
                        const groupKey = `${teacherId}::${groupName}`;
                        const hasSelectedStudentInGroup = students.some((student) => student.id === selectedStudent?.id);
                        const groupExpanded = Boolean(normalizedStudentSearch) || expandedStudentGroups.has(groupKey) || hasSelectedStudentInGroup;
                        return (
                          <section key={groupKey} className="student-group nested-group">
                            <div className="student-group-header">
                              <GroupFolderRow
                                groupName={groupName}
                                studentCount={students.length}
                                expanded={groupExpanded}
                                onToggle={() => {
                                  if (groupExpanded) {
                                    setExpandedStudentGroups((current) => {
                                      const next = new Set(current);
                                      next.delete(groupKey);
                                      return next;
                                    });
                                    if (hasSelectedStudentInGroup) {
                                      onStudentChange("");
                                    }
                                    return;
                                  }
                                  setExpandedStudentGroups((current) => {
                                    const next = new Set(current);
                                    next.add(groupKey);
                                    return next;
                                  });
                                }}
                                draggable
                                dropActive={dragTargetKey === `group:${groupKey}`}
                                onDragStart={(event) => startStudentArchiveDrag(event, { type: "group", teacherId, groupName })}
                                onDragEnd={finishStudentArchiveDrag}
                                onDragOver={(event) => handleStudentArchiveDragOver(event, `group:${groupKey}`)}
                                onDragLeave={(event) => handleStudentArchiveDragLeave(event, `group:${groupKey}`)}
                                onDrop={completeReadonlyDrop}
                              />
                            </div>
                            {groupExpanded && (
                              <div className="student-group-body">
                                {students.map((student) => (
                                  <StudentCard
                                    key={student.id}
                                    student={student}
                                    active={selectedStudent?.id === student.id}
                                    groupOptions={groups.map((group) => group.groupName)}
                                    onSelect={() => onStudentChange(selectedStudent?.id === student.id ? "" : student.id)}
                                    draggable
                                    onDragStart={(event) => startStudentArchiveDrag(event, { type: "student", studentId: student.id })}
                                    onDragEnd={finishStudentArchiveDrag}
                                  />
                                ))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </aside>

        <section className="task-board student-task-board">
          <div className="board-header">
            <div>
              <p className="eyebrow">Student Queue</p>
              <div className="student-task-title-row">
                <h2>{selectedStudent ? `${selectedStudent.name} 的任务队列` : "请选择学生档案"}</h2>
                {selectedStudent && (
                  <button type="button" className="daily-feedback-button" onClick={openDailyFeedbackForm}>
                    <Download size={16} />
                    导出当日反馈
                  </button>
                )}
              </div>
              <p className="board-hint">按任务状态和置顶情况查看任务。</p>
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
                <strong>{selectedStudent ? "当前还没有任务" : "请先选择学生档案"}</strong>
                <span>{selectedStudent ? "老师布置任务后，会自动出现在这里。" : "在左侧点击自己的姓名后，会显示对应任务队列。"}</span>
              </div>
            )}
            {visibleSelectedTasks.map((task) => {
              const files = dashboard.taskFiles.filter((file) => file.taskId === task.id);
              const taskStudent = dashboard.students.find((student) => student.id === task.studentId);
              return (
                <article id={`student-task-${task.id}`} key={task.id} className="task-card student-task-card">
                  <div className="task-main">
                    <div className="task-title-row">
                      {task.pinned && <span className="pin">老师置顶</span>}
                      <span className="status">{statusLabels[task.status]}</span>
                    </div>
                    <h3>{task.title}</h3>
                    {task.description && <p>{task.description}</p>}
                    <div className="task-meta">
                      {taskStudent && <span>学生 {taskStudent.name}</span>}
                      <span>DDL {formatTaskDueDate(task.dueDate)}</span>
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
          {selectedTasks.length > 3 && (
            <button type="button" className="audit-toggle-button" onClick={() => setIsTaskListExpanded((current) => !current)}>
              {isTaskListExpanded ? "收起任务" : `展开更多（${selectedTasks.length - 3} 条）`}
            </button>
          )}
        </section>
      </section>
      {isDailyFeedbackFormOpen && selectedStudent && (
        <div className="modal-backdrop" role="presentation">
          <form className="student-form compact-export-form" onSubmit={(event) => void handleDownloadDailyFeedback(event)}>
            <div className="form-header">
              <div>
                <p className="eyebrow">Daily PDF</p>
                <h3>导出 {selectedStudent.name} 的全部作业反馈</h3>
              </div>
              <button type="button" onClick={() => setIsDailyFeedbackFormOpen(false)} aria-label="关闭导出弹窗">
                <X size={18} />
              </button>
            </div>
            <label>
              选择 DDL 日期
              <input
                required
                type="date"
                value={dailyFeedbackDate}
                list="daily-feedback-dates"
                onChange={(event) => setDailyFeedbackDate(event.target.value)}
              />
              <datalist id="daily-feedback-dates">
                {availableFeedbackDates.map((date) => (
                  <option key={date} value={date} />
                ))}
              </datalist>
            </label>
            {availableFeedbackDates.length > 0 && (
              <div className="feedback-date-chips">
                {availableFeedbackDates.slice(0, 6).map((date) => (
                  <button
                    key={date}
                    type="button"
                    className={date === dailyFeedbackDate ? "is-selected" : undefined}
                    aria-pressed={date === dailyFeedbackDate}
                    onClick={() => setDailyFeedbackDate(date)}
                  >
                    {date}
                  </button>
                ))}
              </div>
            )}
            {dailyFeedbackError && <p className="form-error">{dailyFeedbackError}</p>}
            <button className="submit-button" type="submit" disabled={isDownloadingDailyFeedback || !dailyFeedbackDate}>
              {isDownloadingDailyFeedback ? "生成中..." : "生成并下载 PDF"}
            </button>
          </form>
        </div>
      )}
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

function GuidePreviewModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="guide-preview-modal">
        <div className="form-header">
          <div>
            <p className="eyebrow">Teacher Guide</p>
            <h2>QULEDA 老师端使用说明</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <section className="guide-preview-hero">
          <strong>最快上手路径</strong>
          <span>添加学生档案 → 新建任务 → 上传批改 / 标记结束 / 管理打印</span>
        </section>

        <div className="guide-preview-grid">
          <article>
            <b>1. 建立学生档案</b>
            <p>在左侧点击“添加老师”或“添加学生”。学生会归到对应老师和班级下。</p>
            <p>学生多的时候，可以用“搜索学生”直接按姓名定位。</p>
          </article>
          <article>
            <b>2. 创建任务</b>
            <p>选择学生后，点击右侧“新建任务”，填写任务名称和说明。</p>
            <p>任务会进入任务队列，每张卡片都会显示对应学生姓名。</p>
          </article>
          <article>
            <b>3. 上传批改或打印</b>
            <p>在任务卡片点击“上传批改”，上传批改图片或文件并填写备注。</p>
            <p>需要打印的资料可以加入打印队列，并在右侧更新打印状态。</p>
          </article>
          <article>
            <b>待批改列表</b>
            <p>点击顶部“待批改”，会显示全部还没有上传批改图片的任务。</p>
            <p>如果任务无需批改，可在卡片右上角切换为“已结束”，它就不会继续出现在待批改列表。</p>
          </article>
          <article>
            <b>常用文件框</b>
            <p>右侧“常用文件框”可以保存讲义、模板和打印材料。</p>
            <p>保存后老师和助教都能预览、下载或复用。</p>
          </article>
          <article>
            <b>隐藏但常用的操作</b>
            <p>小齿轮可以修改老师、班级、学生或任务名称。</p>
            <p>拖动学生可以移动到其他班级；拖动班级可以移动到其他老师。</p>
          </article>
          <article>
            <b>移动后的反馈</b>
            <p>移动成功后页面会自动刷新，并在底部出现成功提示。</p>
            <p>如果失败，会显示更明确的失败原因。</p>
          </article>
        </div>

        <div className="guide-preview-footer">
          <span>建议顺序：添加学生 → 新建任务 → 上传批改 → 打印 / 导出反馈。</span>
          <button type="button" className="submit-button" onClick={onClose}>
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskCompletionToggle({
  task,
  disabled,
  onChange
}: {
  task: Task;
  disabled?: boolean;
  onChange: (status: Extract<TaskStatus, "not_started" | "completed">) => Promise<void>;
}) {
  const isEnded = task.status === "completed";

  async function selectStatus(nextStatus: Extract<TaskStatus, "not_started" | "completed">) {
    if (disabled) return;
    if ((nextStatus === "completed") === isEnded) return;
    await onChange(nextStatus);
  }

  return (
    <div className="task-completion-toggle" aria-label="任务结束状态">
      <button
        type="button"
        className={!isEnded ? "active" : undefined}
        disabled={disabled}
        aria-pressed={!isEnded}
        onClick={() => void selectStatus("not_started")}
      >
        未开始
      </button>
      <button
        type="button"
        className={isEnded ? "active ended" : undefined}
        disabled={disabled}
        aria-pressed={isEnded}
        onClick={() => void selectStatus("completed")}
      >
        已结束
      </button>
    </div>
  );
}

function SharedFilesPanel({
  files,
  error,
  uploadFile,
  searchQuery,
  isSaving,
  deletingFileId,
  onFileChange,
  onSearchChange,
  onSubmit,
  onPreview,
  onDelete
}: {
  files: SharedFile[];
  error: string;
  uploadFile: File | null;
  searchQuery: string;
  isSaving: boolean;
  deletingFileId: string | null;
  onFileChange: (file: File | null) => void;
  onSearchChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreview: (file: SharedFile) => void;
  onDelete: (sharedFileId: string) => void;
}) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleFiles = normalizedSearch
    ? files.filter((file) =>
        [file.fileName, file.uploaderName, file.note, file.fileType].some((value) =>
          String(value ?? "").toLowerCase().includes(normalizedSearch)
        )
      )
    : files;

  return (
    <aside className="communication-card shared-files-panel">
      <div className="communication-heading">
        <div>
          <span>老师 / 助教共享</span>
          <strong>常用文件框</strong>
        </div>
        <Files size={22} />
      </div>

      <label className="panel-search-box">
        <span>搜索文件</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="输入文件关键字"
          aria-label="搜索常用文件"
        />
      </label>

      <div className="chat-thread shared-file-thread">
        {visibleFiles.length ? (
          visibleFiles.map((file) => (
            <article key={file.id} className={`shared-file-card ${file.uploaderRole}`}>
              <div className="shared-file-meta">
                <div>
                  <strong>{file.fileName}</strong>
                  <small>
                    {file.uploaderName} · {formatDateTime(file.createdAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="delete-chat-message-button"
                  onClick={() => onDelete(file.id)}
                  disabled={deletingFileId === file.id}
                  aria-label="删除常用文件"
                >
                  {deletingFileId === file.id ? <Loader2 className="spin" size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
              <div className="shared-file-actions">
                <button type="button" onClick={() => onPreview(file)}>
                  预览
                </button>
                <a href={resolveApiUrl(file.fileUrl)} target="_blank" rel="noreferrer">
                  <Download size={14} />
                  下载
                </a>
              </div>
            </article>
          ))
        ) : files.length ? (
          <p className="chat-empty">没有找到匹配的常用文件。</p>
        ) : (
          <p className="chat-empty">还没有常用文件，老师或助教可以把讲义、模板、打印材料先放进来。</p>
        )}
      </div>

      <form className="shared-file-upload-form" onSubmit={onSubmit} title="常用文件框可以存讲义、模板和打印材料，方便老师和助教复用。">
        <label className="shared-file-picker">
          <input type="file" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
          <span>{uploadFile ? uploadFile.name : "添加文件"}</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="chat-send-button" type="submit" disabled={isSaving} title="把当前文件存入常用文件框">
          {isSaving ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
          存入常用文件框
        </button>
      </form>
    </aside>
  );
}

function PrintQueuePanel({
  jobs,
  deletingPrintJobId,
  pendingCount,
  searchQuery,
  onSearchChange,
  onStatusChange,
  onDelete
}: {
  jobs: DashboardData["printJobs"];
  deletingPrintJobId: string | null;
  pendingCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (jobId: string, status: "pending" | "printed" | "cancelled") => void;
  onDelete: (jobId: string) => void;
}) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleJobs = normalizedSearch
    ? jobs.filter((job) =>
        [job.fileName, job.note, printStatusLabels[job.status] ?? job.status, String(job.copies)].some((value) =>
          String(value ?? "").toLowerCase().includes(normalizedSearch)
        )
      )
    : jobs;

  return (
    <aside id="print-queue-panel" className="communication-card print-queue-card">
      <div className="communication-heading">
        <div>
          <span>打印管理</span>
          <strong>需要打印的文件队列</strong>
        </div>
        <div className="panel-count-badge">{pendingCount}</div>
      </div>

      <label className="panel-search-box">
        <span>搜索打印文件</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="输入文件关键字"
          aria-label="搜索打印队列文件"
        />
      </label>

      <div className="chat-thread print-queue-thread">
        {visibleJobs.length ? (
          visibleJobs.map((job) => (
            <article key={job.id} className="shared-file-card print-job-card">
              <div className="shared-file-meta">
                <div>
                  <strong>{job.fileName}</strong>
                  <small>{formatDateTime(job.createdAt)}</small>
                </div>
                <button
                  type="button"
                  className="delete-chat-message-button"
                  onClick={() => onDelete(job.id)}
                  disabled={deletingPrintJobId === job.id}
                  aria-label={`删除打印文件 ${job.fileName}`}
                >
                  {deletingPrintJobId === job.id ? <Loader2 className="spin" size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
              <div className="print-job-detail-row">
                <b>{job.copies} 份</b>
                <select
                  value={job.status}
                  title="这里可以更新打印状态"
                  onChange={(event) => onStatusChange(job.id, event.target.value as "pending" | "printed" | "cancelled")}
                >
                  {Object.entries(printStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <a className="preview-print-button" href={resolveApiUrl(job.fileUrl)} download={job.fileName}>
                  下载
                </a>
              </div>
              {job.note && <p>{job.note}</p>}
            </article>
          ))
        ) : jobs.length ? (
          <p className="chat-empty">没有找到匹配的打印文件。</p>
        ) : (
          <p className="chat-empty">当前没有待打印文件。</p>
        )}
      </div>
    </aside>
  );
}

function Metric({
  icon,
  label,
  value,
  helper,
  onClick,
  tone,
  highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper?: string;
  onClick?: () => void;
  tone?: "print";
  highlight?: boolean;
}) {
  const Element = onClick ? "button" : "article";
  return (
    <Element className={`${tone ? `metric-card ${tone}` : "metric-card"}${highlight ? " guide-highlight" : ""}`} onClick={onClick}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <em>{helper}</em>}
    </Element>
  );
}

function TeacherFolderRow({
  teacherName,
  studentCount,
  expanded,
  onToggle,
  onRename,
  dropActive,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  teacherName: string;
  studentCount: number;
  expanded: boolean;
  onToggle: () => void;
  onRename?: (nextTeacherName: string) => void;
  dropActive?: boolean;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(teacherName);

  useEffect(() => {
    setDraft(teacherName);
  }, [teacherName]);

  return (
    <div
      className={dropActive ? "teacher-folder-row archive-drop-target is-active" : "teacher-folder-row archive-drop-target"}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button type="button" className="teacher-folder-button" onClick={onToggle} aria-expanded={expanded}>
        <strong>{teacherName}</strong>
        <small>{studentCount} 个学生</small>
      </button>
      {onRename && (
        <button
          type="button"
          className="settings-button"
          title="点击修改老师名称"
          onClick={() => setIsEditing((current) => !current)}
          aria-label={`修改 ${teacherName} 名字`}
        >
          <Settings size={14} />
        </button>
      )}
      {onRename && isEditing && (
        <div className="inline-edit-row">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`修改 ${teacherName} 名字`} />
          <button
            type="button"
            onClick={() => {
              const nextTeacherName = draft.trim();
              if (!nextTeacherName || nextTeacherName === teacherName) return;
              onRename(nextTeacherName);
              setIsEditing(false);
            }}
            disabled={!draft.trim() || draft.trim() === teacherName}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}

function GroupFolderRow({
  groupName,
  studentCount,
  expanded,
  onToggle,
  onRename,
  selected,
  draggable,
  dropActive,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  groupName: string;
  studentCount: number;
  expanded: boolean;
  onToggle: () => void;
  onRename?: (nextGroupName: string) => void;
  selected?: boolean;
  draggable?: boolean;
  dropActive?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(groupName);

  useEffect(() => {
    setDraft(groupName);
  }, [groupName]);

  return (
    <div
      className={`${dropActive ? "teacher-folder-row group-folder-row archive-drop-target is-active" : "teacher-folder-row group-folder-row archive-drop-target"}${draggable ? " has-drag-handle" : ""}${selected ? " selected-folder" : ""}`}
      draggable={draggable}
      title="拖动班级可移动到其他老师下面"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {draggable && (
        <span className="drag-handle" aria-hidden="true">
          <GripVertical size={15} />
        </span>
      )}
      <button type="button" className="teacher-folder-button" onClick={onToggle} aria-expanded={expanded}>
        <strong>{groupName}</strong>
        <small>{studentCount} 个学生</small>
      </button>
      {onRename && (
        <button
          type="button"
          className="settings-button"
          title="点击修改班级名称"
          onClick={() => setIsEditing((current) => !current)}
          aria-label={`修改 ${groupName} 班级名字`}
        >
          <Settings size={14} />
        </button>
      )}
      {onRename && isEditing && (
        <div className="inline-edit-row">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`修改 ${groupName} 班级名字`} />
          <button
            type="button"
            onClick={() => {
              const nextGroupName = draft.trim();
              if (!nextGroupName || nextGroupName === groupName) return;
              onRename(nextGroupName);
              setIsEditing(false);
            }}
            disabled={!draft.trim() || draft.trim() === groupName}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}

function StudentCard({
  student,
  active,
  groupOptions,
  onSelect,
  onDelete,
  onUpdateGroup,
  onRename,
  draggable,
  onDragStart,
  onDragEnd
}: {
  student: Student;
  active: boolean;
  groupOptions: string[];
  onSelect: () => void;
  onDelete?: () => void;
  onUpdateGroup?: (groupName: string) => void;
  onRename?: (nextStudentName: string) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [groupDraft, setGroupDraft] = useState(student.group || "");
  const [nameDraft, setNameDraft] = useState(student.name);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setGroupDraft(student.group || "");
    setNameDraft(student.name);
  }, [student.group, student.name]);

  const normalizedDraft = groupDraft.trim();
  const canSaveGroup = normalizedDraft.length > 0 && normalizedDraft !== student.group;

  return (
    <div
      className={active ? "student-item-wrap active" : "student-item-wrap"}
      draggable={draggable}
      title={draggable ? "拖动学生可移动到其他老师或班级下面" : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={draggable ? "teacher-folder-row student-folder-row has-drag-handle" : "teacher-folder-row student-folder-row"}>
        {draggable && (
          <span className="drag-handle" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        )}
        <button className="student-item" onClick={onSelect}>
          <strong>{student.name}</strong>
          <small>{student.group || "未分班"}</small>
        </button>
        {(onRename || onUpdateGroup) && (
          <button
            className="settings-button student-settings-button"
            type="button"
            title="点击修改学生名称或班级"
            onClick={() => setIsEditing((current) => !current)}
            aria-label={`修改学生 ${student.name} 信息`}
          >
            <Settings size={14} />
          </button>
        )}
      </div>
      {isEditing && (
        <>
          {onRename && (
            <div className="inline-edit-row student-name-edit">
              <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label={`修改学生 ${student.name} 名字`} />
              <button
                type="button"
                onClick={() => {
                  const nextStudentName = nameDraft.trim();
                  if (!nextStudentName || nextStudentName === student.name) return;
                  onRename(nextStudentName);
                  setIsEditing(false);
                }}
                disabled={!nameDraft.trim() || nameDraft.trim() === student.name}
              >
                保存姓名
              </button>
            </div>
          )}
          {onUpdateGroup && (
            <div className="student-group-editor">
              <input
                value={groupDraft}
                list={`student-groups-${student.id}`}
                onChange={(event) => setGroupDraft(event.target.value)}
                aria-label={`修改 ${student.name} 的班级`}
              />
              <datalist id={`student-groups-${student.id}`}>
                {groupOptions.map((groupName) => (
                  <option key={groupName} value={groupName} />
                ))}
              </datalist>
              <button type="button" onClick={() => onUpdateGroup(normalizedDraft)} disabled={!canSaveGroup}>
                保存班级
              </button>
            </div>
          )}
        </>
      )}
      {onDelete && (
        <button className="delete-student-button" onClick={onDelete} aria-label={`删除学生 ${student.name}`}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function TaskTitleEditor({ task, onSave }: { task: Task; onSave: (task: Task) => void | Promise<void> }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isSaving) setDraft(task.title);
  }, [isSaving, task.title]);

  async function handleSave() {
    const nextTitle = draft.trim();
    if (!nextTitle || nextTitle === task.title) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const savedTask = await updateTask(task.id, { title: nextTitle });
      await onSave(savedTask);
      setIsEditing(false);
    } catch {
      window.alert("任务名称保存失败，请确认后端服务正常。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="task-title-editor">
      <div className="task-title-display">
        <h3>{task.title}</h3>
        <button
          type="button"
          className="settings-button task-settings-button"
          title="点击修改任务名称"
          onClick={() => setIsEditing((current) => !current)}
          aria-label={`修改任务 ${task.title} 名称`}
        >
          <Settings size={14} />
        </button>
      </div>
      {isEditing && (
        <div className="inline-edit-row task-title-edit">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`修改任务 ${task.title} 名称`} />
          <button type="button" onClick={() => void handleSave()} disabled={isSaving || !draft.trim() || draft.trim() === task.title}>
            {isSaving ? "保存中" : "保存名称"}
          </button>
        </div>
      )}
    </div>
  );
}

function TeacherNoteEditor({ task, onSave }: { task: Task; onSave: (task: Task) => void | Promise<void> }) {
  const [note, setNote] = useState(task.teacherComment ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const initialSyncDoneRef = useRef(false);
  const lastSavedNoteRef = useRef(task.teacherComment ?? "");

  useEffect(() => {
    if (!isSaving) {
      setNote(task.teacherComment ?? "");
      lastSavedNoteRef.current = task.teacherComment ?? "";
      setSaveStatus("idle");
    }
    initialSyncDoneRef.current = true;
  }, [isSaving, task.id, task.teacherComment]);

  async function handleSave(nextNote: string) {
    setIsSaving(true);
    setSaveStatus("idle");
    try {
      const savedTask = await updateTask(task.id, { teacherComment: nextNote });
      const savedNote = savedTask.teacherComment ?? "";
      setNote(savedNote);
      lastSavedNoteRef.current = savedNote;
      await onSave(savedTask);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      window.alert("老师备注保存失败，请确认后端服务正常。");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!initialSyncDoneRef.current) return;
    if (note === lastSavedNoteRef.current) return;

    const timer = window.setTimeout(() => {
      void handleSave(note);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [note]);

  return (
    <div className="teacher-note-editor">
      <label>
        老师备注
        <textarea
          value={note}
          onChange={(event) => {
            setSaveStatus("idle");
            setNote(event.target.value);
          }}
          placeholder="在这里添加给学生或家长看的备注..."
        />
      </label>
      <div className="teacher-note-actions">
        {isSaving && <small>保存中...</small>}
        {saveStatus === "saved" && <small>已保存</small>}
        {saveStatus === "error" && <small className="error">保存失败</small>}
      </div>
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
  section = "all",
  readOnly = false,
  deletingFileId,
  onDeleteFile,
  onPreview
}: {
  files: TaskFile[];
  section?: "all" | "assignment" | "correction";
  readOnly?: boolean;
  deletingFileId?: string | null;
  onDeleteFile?: (fileId: string) => void;
  onPreview?: (file: TaskFile) => void;
}) {
  const correctionFiles = files.filter((file) => file.uploaderRole === "assistant" && file.fileType.startsWith("image/"));
  const assignmentFiles = files.filter((file) => !correctionFiles.some((correction) => correction.id === file.id));

  return (
    <div className="file-sections">
      {(section === "all" || section === "assignment") && (
        <FileSection
          title="作业/答案"
          tone="assignment"
          files={assignmentFiles}
          emptyText={readOnly ? "暂未上传作业/答案" : "暂无作业/答案文件"}
          deletingFileId={deletingFileId}
          onDelete={readOnly ? undefined : onDeleteFile}
          onPreview={onPreview}
        />
      )}
      {(section === "all" || section === "correction") && (
        <FileSection
          title="批改照片"
          tone="correction"
          files={correctionFiles}
          emptyText={readOnly ? "暂未上传批改" : "暂无批改照片"}
          deletingFileId={deletingFileId}
          onDelete={readOnly ? undefined : onDeleteFile}
          onPreview={onPreview}
        />
      )}
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
                <img className="file-bundle-preview" src={resolveApiUrl(previewFile.thumbnailUrl ?? previewFile.url)} alt={previewFile.name} />
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
                      {file.fileType.startsWith("image/") && (
                        <img className="file-preview" src={resolveApiUrl(file.thumbnailUrl ?? file.url)} alt={file.name} />
                      )}
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
