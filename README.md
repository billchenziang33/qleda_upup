# qleda_upup

QLEDA UpUp 是一个面向雅思机构的教学任务管理系统，采用前后端分离架构。

- `apps/web`: React + TypeScript + Vite 前端工作台
- `apps/api`: Express + TypeScript 后端 API
- `apps/api/data/qleda.sqlite`: 本地 SQLite 数据库文件，首次启动时自动创建
- `apps/api/data/uploads`: 本地上传文件目录，保存学生作业和助教批改文件

## 当前 MVP

- 老师/助教工作台概览
- 学生档案与任务列表
- 添加学生并写入真实数据库
- 新建任务并写入真实数据库
- 助教上传批改文件，并将任务标记为已批改
- 任务按置顶、完成状态、优先级、截止日期排序
- 家长反馈导出记录的 API 雏形
- 开发环境使用 SQLite，国内生产环境可迁移到阿里云 RDS MySQL / 腾讯云 TencentDB MySQL

## 本地启动

```bash
npm install
npm run db:setup -w apps/api
npm run dev
```

如果只启动了前端，页面会提示后端不可用；请在项目根目录运行 `npm run dev`，不要只运行 `npm run dev:web`。

启动后访问：

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:4000/health

如果提示 5173 端口被占用，先关闭之前启动的旧开发服务，再重新运行 `npm run dev`。

## 下一步建议

1. 上线前迁移到 MySQL，并把 SQLite 表结构转换为 MySQL migration。
2. 增加登录与 RBAC 权限：管理员、老师、助教、学生、家长。
3. 接入 OSS/COS 文件存储。
4. 实现批改反馈长图生成服务。
5. 增加学生端提交作业入口。
