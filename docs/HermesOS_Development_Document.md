# HermesOS 完整开发文档

版本：Final Development Spec  
目标项目：HermesOS  
文档范围：从 0 开始，一直到最终完整项目版本  
重要说明：文档中的“最小闭环”只是第一阶段验收，不是最终目标。最终目标从第 47 节开始完整定义。

---

## 0. 这个项目最终要做成什么

HermesOS 的最终形态不是普通飞书机器人，而是一个通过飞书控制的 AI 项目管家。

最终你希望在飞书里直接说：

```text
今天项目怎么样？
同步一下真实状态
继续推进项目
这个任务回滚
这个改得太丑了，重做
没问题，提交
```

HermesOS 应该自动完成：

1. 读取飞书消息。
2. 理解你的真实意图。
3. 查询 MySQL 里的项目状态和任务状态。
4. 必要时同步本地 Git 真实状态。
5. 创建任务、继续任务、回滚任务或提交任务。
6. 触发 Codex 做规划。
7. 触发 Claude CLI 执行改代码。
8. 触发 Codex 审查 diff。
9. 把结果写入 MySQL。
10. 在飞书里向你汇报。

核心原则：

```text
飞书负责控制
DeepSeek 负责理解语言
n8n 负责调度
MySQL 负责记忆和状态
GitHub Actions self-hosted runner 负责连到本地机器
Codex 负责规划和审查
Claude CLI 负责执行代码修改
Git 负责真实文件状态和版本记录
```

最重要的一条：

```text
先让 HermesOS 变可靠，再让它变聪明。
```

所以本项目不要一开始就追求全自动改代码。第一阶段必须先解决：

```text
MySQL 状态 == 本地 Git 真实状态
```

---

## 1. 总架构

### 1.1 模块分工

```text
飞书
  用户入口、状态汇报、人工确认

n8n
  Webhook 接入、节点编排、调用 AI、写数据库、触发 GitHub Actions

DeepSeek
  把自然语言转换成标准 Action
  不直接执行危险动作

MySQL
  项目状态、任务状态、Job、事件、Artifact、Session 记忆

GitHub Actions self-hosted runner
  运行在你的 Windows 本地机器
  负责检查本地 Git、调用 Codex、调用 Claude、提交或回滚

Codex
  读取项目、规划任务、写 Claude prompt、审查 diff

Claude CLI
  按 Codex prompt 修改代码

GitHub
  保存代码、保存 workflow、记录 commit、提供安全边界
```

### 1.2 主流程

```text
飞书消息
  -> n8n Webhook
  -> Message Parser
  -> Load Project Context
  -> DeepSeek Action Extractor
  -> Parse Action
  -> State Validator
  -> Dispatcher
  -> MySQL / GitHub Actions / Feishu Reply
```

### 1.3 执行回调流程

```text
GitHub Actions self-hosted runner
  -> 检查或执行本地任务
  -> POST 回调 n8n
  -> n8n 更新 MySQL
  -> n8n 飞书汇报
```

---

## 2. 项目阶段总路线

不要跳阶段。每一阶段都有验收标准。

### Phase 0：准备环境

目标：

```text
账号、密钥、目录、数据库、n8n、飞书机器人都准备好。
```

完成标志：

```text
n8n 能打开
MySQL 能连接
飞书机器人能配置事件订阅
GitHub repo 里能运行 self-hosted runner
本地项目目录能 git status
```

### Phase 1：数据库状态层

目标：

```text
建好 HermesOS 的状态表。
MySQL 能记录项目、任务、Job、事件、Worker 状态。
```

完成标志：

```text
MySQL 里有 hermes_project_state
MySQL 里有 HermesOS 这个 project_key
可以手动插入事件和任务
```

### Phase 2：飞书入口

目标：

```text
飞书消息能进入 n8n。
n8n 能解析出 user_id、chat_id、message_id、text。
```

完成标志：

```text
你在飞书发“项目状态”
n8n 执行记录里能看到 text = 项目状态
```

### Phase 3：Action 协议

目标：

```text
DeepSeek 把自然语言转换成标准 Action JSON。
```

完成标志：

```text
“今天项目怎么样” -> project.status
“同步一下” -> project.sync
“继续推进” -> task.continue
“这个任务回滚” -> task.rollback
```

### Phase 4：项目状态查询

目标：

```text
/project status 或自然语言“今天项目怎么样”能读取 MySQL 并回复飞书。
```

完成标志：

```text
飞书能收到当前项目状态、当前任务、最近事件。
```

### Phase 5：真实状态同步

目标：

```text
project.sync 能触发 GitHub Actions self-hosted runner。
runner 在本地项目目录执行 git status。
结果回写 MySQL。
```

完成标志：

```text
本地干净 -> MySQL 显示 CLEAN / IDLE
本地有改动 -> MySQL 显示 DIRTY / REVIEW_REQUIRED
旧 REVIEW 不会永久卡住 pursue
```

### Phase 6：任务生命周期

目标：

```text
HermesOS 能创建任务、推进任务、取消任务、回滚任务、审核任务。
```

完成标志：

```text
每个任务有明确状态。
每个动作都有 hermes_events 记录。
```

### Phase 7：Codex Planning

目标：

```text
Codex 只做规划，不改代码。
输出开发计划、风险点、Claude prompt。
```

完成标志：

```text
飞书发“继续推进”
HermesOS 生成一份 Plan
MySQL 记录 plan artifact
飞书让你确认
```

### Phase 8：Claude 执行

目标：

```text
Claude CLI 根据 Codex prompt 修改代码。
```

完成标志：

```text
Claude 执行后产生 git diff。
HermesOS 状态进入 REVIEW_REQUIRED。
```

### Phase 9：Codex Review

目标：

```text
Codex 读取 git diff，判断 PASS / FAIL。
```

完成标志：

```text
PASS -> 飞书提示可以审核提交
FAIL -> 飞书提示风险和建议，必要时生成修复任务
```

### Phase 10：提交、回滚、闭环

目标：

```text
用户说“没问题提交”后 HermesOS 自动 commit / push。
用户说“回滚”后 HermesOS 安全清理当前任务改动。
```

完成标志：

```text
提交后 MySQL 记录 commit_hash。
回滚后 MySQL 记录 ROLLED_BACK。
项目状态回到 IDLE。
```

### Phase 11：长期 Session 记忆

目标：

```text
HermesOS 能理解“这个”“刚才那个”“上次失败的任务”。
```

完成标志：

```text
不用手动给 task_id，HermesOS 能根据最近上下文定位目标。
```

### Phase 12：最终完成

目标：

```text
HermesOS 可以稳定管理一个项目的完整开发循环。
```

最终验收：

```text
飞书一句话创建任务
Codex 规划
你确认
Claude 执行
Codex 审查
你审核
HermesOS commit / push
MySQL 全程记录
飞书全程汇报
```

---

## 3. 你需要准备的信息

后面所有步骤会用到这些变量。先建一个自己的记录表。

```text
PROJECT_KEY=HermesOS
PROJECT_NAME=HermesOS
LOCAL_PROJECT_DIR=C:\Users\AL\Documents\HermesOS
N8N_BASE_URL=https://你的-n8n-域名
N8N_FEISHU_WEBHOOK_PATH=/webhook/hermes/feishu
N8N_ACTIONS_CALLBACK_PATH=/webhook/hermes/actions-callback

MYSQL_HOST=你的 MySQL host
MYSQL_PORT=3306
MYSQL_DATABASE=hermes
MYSQL_USER=你的 MySQL 用户名
MYSQL_PASSWORD=你的 MySQL 密码

FEISHU_APP_ID=你的飞书 app_id
FEISHU_APP_SECRET=你的飞书 app_secret
FEISHU_VERIFICATION_TOKEN=你的飞书 verification token
FEISHU_ENCRYPT_KEY=如果你开启加密就填

DEEPSEEK_API_KEY=你的 DeepSeek API key
GITHUB_REPO=你的 GitHub repo，例如 AL/HermesOS
GITHUB_TOKEN=用于 n8n 触发 workflow 的 token

CODEX_COMMAND=你本机可用的 Codex CLI 命令
CLAUDE_COMMAND=你本机可用的 Claude CLI 命令
```

---

## 4. 数据库设计

### 4.1 建库

在 MySQL 执行：

```sql
CREATE DATABASE IF NOT EXISTS hermes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hermes;
```

### 4.2 projects 表

用途：记录 HermesOS 管理哪些项目。

```sql
CREATE TABLE IF NOT EXISTS hermes_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL UNIQUE,
  project_name VARCHAR(255) NOT NULL,
  repo_full_name VARCHAR(255) NULL,
  local_path VARCHAR(1024) NULL,
  default_branch VARCHAR(128) NOT NULL DEFAULT 'main',
  dev_branch_prefix VARCHAR(128) NOT NULL DEFAULT 'hermes/dev-',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化 HermesOS：

```sql
INSERT INTO hermes_projects (
  project_key,
  project_name,
  repo_full_name,
  local_path,
  default_branch,
  dev_branch_prefix,
  enabled
) VALUES (
  'HermesOS',
  'HermesOS',
  '你的GitHub用户名/HermesOS',
  'C:\\Users\\AL\\Documents\\HermesOS',
  'main',
  'hermes/dev-',
  1
)
ON DUPLICATE KEY UPDATE
  project_name = VALUES(project_name),
  repo_full_name = VALUES(repo_full_name),
  local_path = VALUES(local_path),
  enabled = VALUES(enabled);
```

你要改的地方：

```text
你的GitHub用户名/HermesOS
C:\\Users\\AL\\Documents\\HermesOS
```

### 4.3 project_state 表

用途：记录项目当前状态。  
这是 HermesOS 判断“能不能继续推进”的核心表。

```sql
CREATE TABLE IF NOT EXISTS hermes_project_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL UNIQUE,
  project_status ENUM(
    'IDLE',
    'RUNNING',
    'REVIEW_REQUIRED',
    'DIRTY',
    'BLOCKED',
    'ERROR'
  ) NOT NULL DEFAULT 'IDLE',
  git_state ENUM(
    'UNKNOWN',
    'CLEAN',
    'DIRTY'
  ) NOT NULL DEFAULT 'UNKNOWN',
  active_task_id BIGINT UNSIGNED NULL,
  active_job_id BIGINT UNSIGNED NULL,
  last_sync_at DATETIME NULL,
  last_message TEXT NULL,
  last_error TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_status),
  INDEX idx_git_state (git_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化状态：

```sql
INSERT INTO hermes_project_state (
  project_key,
  project_status,
  git_state,
  last_message
) VALUES (
  'HermesOS',
  'IDLE',
  'UNKNOWN',
  '项目已初始化，等待首次同步。'
)
ON DUPLICATE KEY UPDATE
  project_status = VALUES(project_status),
  git_state = VALUES(git_state),
  last_message = VALUES(last_message);
```

### 4.4 tasks 表

用途：记录用户真正想完成的开发任务。

任务状态机：

```text
CREATED
PLANNING
PLAN_READY
EXECUTING
REVIEW_REQUIRED
APPROVED
COMMITTED
ROLLED_BACK
FAILED
CANCELLED
```

建表：

```sql
CREATE TABLE IF NOT EXISTS hermes_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  user_request TEXT NOT NULL,
  status ENUM(
    'CREATED',
    'PLANNING',
    'PLAN_READY',
    'EXECUTING',
    'REVIEW_REQUIRED',
    'APPROVED',
    'COMMITTED',
    'ROLLED_BACK',
    'FAILED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'CREATED',
  priority ENUM('LOW', 'NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
  source VARCHAR(64) NOT NULL DEFAULT 'feishu',
  created_by VARCHAR(255) NULL,
  branch_name VARCHAR(255) NULL,
  commit_hash VARCHAR(128) NULL,
  plan_summary TEXT NULL,
  review_summary TEXT NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.5 jobs 表

用途：记录一次具体执行动作。  
一个 task 可以有多个 job。

例如：

```text
task 12：重做首页 UI
  job 101：sync
  job 102：plan
  job 103：dev
  job 104：review
  job 105：commit
```

建表：

```sql
CREATE TABLE IF NOT EXISTS hermes_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  job_type ENUM(
    'SYNC',
    'PLAN',
    'DEV',
    'REVIEW',
    'COMMIT',
    'ROLLBACK'
  ) NOT NULL,
  status ENUM(
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'QUEUED',
  input_json JSON NULL,
  output_json JSON NULL,
  github_run_id VARCHAR(128) NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_task (task_id),
  INDEX idx_job_type (job_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.6 events 表

用途：记录一切重要事情。  
以后飞书问“今天做了什么”，主要查这张表。

```sql
CREATE TABLE IF NOT EXISTS hermes_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL DEFAULT 'system',
  title VARCHAR(255) NOT NULL,
  details TEXT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_created (project_key, created_at),
  INDEX idx_task_created (task_id, created_at),
  INDEX idx_event_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.7 artifacts 表

用途：保存 Codex plan、Claude prompt、review report、diff summary 等长文本。

```sql
CREATE TABLE IF NOT EXISTS hermes_artifacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  artifact_type ENUM(
    'PLAN',
    'CLAUDE_PROMPT',
    'REVIEW_REPORT',
    'DIFF_SUMMARY',
    'LOG',
    'OTHER'
  ) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  content_format ENUM('text', 'markdown', 'json') NOT NULL DEFAULT 'markdown',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_type (project_key, artifact_type),
  INDEX idx_task_type (task_id, artifact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.8 worker_state 表

用途：记录本地执行器是否在线。

```sql
CREATE TABLE IF NOT EXISTS hermes_worker_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_key VARCHAR(128) NOT NULL UNIQUE,
  project_key VARCHAR(64) NOT NULL,
  worker_type ENUM('GITHUB_ACTIONS_SELF_HOSTED', 'LOCAL_NODE_WORKER') NOT NULL DEFAULT 'GITHUB_ACTIONS_SELF_HOSTED',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('ONLINE', 'OFFLINE', 'BUSY', 'ERROR') NOT NULL DEFAULT 'OFFLINE',
  last_seen_at DATETIME NULL,
  last_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化 worker：

```sql
INSERT INTO hermes_worker_state (
  worker_key,
  project_key,
  worker_type,
  enabled,
  status,
  last_message
) VALUES (
  'HermesOS-Windows-Local',
  'HermesOS',
  'GITHUB_ACTIONS_SELF_HOSTED',
  1,
  'OFFLINE',
  '等待 GitHub Actions self-hosted runner 首次回调。'
)
ON DUPLICATE KEY UPDATE
  enabled = VALUES(enabled),
  status = VALUES(status),
  last_message = VALUES(last_message);
```

### 4.9 sessions 表

用途：以后支持“这个”“刚才那个”“上一个任务”。

第一版可以先建表，但不需要马上用复杂逻辑。

```sql
CREATE TABLE IF NOT EXISTS hermes_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  feishu_chat_id VARCHAR(255) NULL,
  feishu_user_id VARCHAR(255) NULL,
  status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  latest_task_id BIGINT UNSIGNED NULL,
  latest_job_id BIGINT UNSIGNED NULL,
  latest_intent VARCHAR(128) NULL,
  summary TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_feishu_chat (feishu_chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.10 session_messages 表

```sql
CREATE TABLE IF NOT EXISTS hermes_session_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NULL,
  project_key VARCHAR(64) NOT NULL,
  role ENUM('USER', 'AI', 'SYSTEM', 'WORKER') NOT NULL,
  content TEXT NOT NULL,
  action_json JSON NULL,
  feishu_message_id VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_created (session_id, created_at),
  INDEX idx_project_created (project_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 5. Action 协议

### 5.1 第一版只支持这些 action

不要一开始做几十个。

```text
project.status
project.sync
task.create
task.continue
task.review
task.approve
task.rollback
worker.online
worker.offline
help
chat.reply
unknown
```

### 5.2 标准 JSON 格式

DeepSeek 必须只输出 JSON：

```json
{
  "action": "project.status",
  "project_key": "HermesOS",
  "target": "current_project",
  "task_id": null,
  "summary": "用户想查看项目当前状态",
  "user_message": "今天项目怎么样？",
  "confidence": 0.92,
  "needs_confirmation": false
}
```

字段说明：

```text
action
  标准动作名

project_key
  默认 HermesOS

target
  current_project
  latest_task
  latest_review
  explicit_task
  none

task_id
  用户明确指定任务 id 时填数字，否则 null

summary
  对用户意图的短摘要

user_message
  原始用户文本

confidence
  0 到 1

needs_confirmation
  危险动作是否需要确认
```

### 5.3 DeepSeek System Prompt

n8n 里创建一个 HTTP Request 节点，名字：

```text
DeepSeek Action Extractor
```

System Prompt 填：

```text
你是 HermesOS 的意图识别器。

你不能执行任务。
你不能编造状态。
你不能调用工具。
你只能把用户在飞书里的自然语言转换成 HermesOS 标准 Action JSON。

只允许输出 JSON。
不要输出 Markdown。
不要解释。
不要使用代码块。

可用 action：
- project.status：用户想查看项目状态、进度、当前做到哪了。
- project.sync：用户想同步真实状态、检查本地 git、刷新状态。
- task.create：用户提出了一个新的开发、修改、修复、优化需求。
- task.continue：用户想继续推进当前任务或项目。
- task.review：用户想检查、审查、review 当前任务。
- task.approve：用户表示没问题、通过、可以提交、确认继续。
- task.rollback：用户想回滚、撤销、不要这次修改。
- worker.online：用户想让本地 worker 上线、开始接任务。
- worker.offline：用户想让本地 worker 下线、暂停接任务。
- help：用户问你能做什么、帮助、命令列表。
- chat.reply：普通聊天或解释，不需要执行项目动作。
- unknown：无法判断。

判断规则：
- “今天项目怎么样 / 项目状态 / 进度如何 / 做到哪了” = project.status
- “同步一下 / 检查真实状态 / 检查 git / 刷新状态” = project.sync
- “继续推进 / 下一步 / 接着做 / 继续开发” = task.continue
- “这个太丑了 / 重做 / 优化 / 修一下 / 有 bug / 不对劲” = task.create
- “再检查一下 / review 一下 / 审查一下” = task.review
- “没问题 / 可以 / 通过 / 提交吧 / 确认提交” = task.approve
- “不要了 / 回滚 / 撤销 / 删掉这次修改” = task.rollback
- “本地上线 / worker 上线 / 开始接任务” = worker.online
- “本地下线 / 暂停接任务 / 不接任务” = worker.offline
- “帮助 / help / 能干啥” = help

上下文规则：
- 如果用户说“这个 / 这里 / 刚才那个 / 这次”，默认 target = latest_task。
- 如果用户说“当前审核 / 等待审核那个”，target = latest_review。
- 如果用户明确说任务 id，target = explicit_task，并填写 task_id。
- task.rollback 和 task.approve 默认 needs_confirmation = true。
- confidence 低于 0.6 时，action = unknown。

输出格式：
{
  "action": "project.status",
  "project_key": "HermesOS",
  "target": "current_project",
  "task_id": null,
  "summary": "一句话总结用户意图",
  "user_message": "原始用户消息",
  "confidence": 0.9,
  "needs_confirmation": false
}
```

User Message 填：

```text
项目上下文：
{{ JSON.stringify($json.context) }}

用户消息：
{{ $json.text }}
```

---

## 6. 飞书机器人配置

### 6.1 飞书后台要开启的权限

飞书开放平台里，机器人需要：

```text
接收消息事件
发送消息
读取群信息，如果你需要群聊
```

常用权限：

```text
im:message
im:message:send_as_bot
im:message.group_at_msg
im:message.p2p_msg
```

具体权限名称可能会随飞书后台版本变化，按后台提示补齐即可。

### 6.2 事件订阅 URL

n8n Webhook URL：

```text
https://你的-n8n-域名/webhook/hermes/feishu
```

飞书事件订阅里填这个 URL。

### 6.3 飞书 URL 验证

飞书第一次配置事件订阅时，会发：

```json
{
  "challenge": "xxxx"
}
```

n8n 必须返回：

```json
{
  "challenge": "xxxx"
}
```

---

## 7. n8n 主 Workflow

Workflow 名字：

```text
HermesOS - Feishu Main
```

### 7.1 节点 1：Webhook

节点名字：

```text
Feishu Inbound Webhook
```

设置：

```text
HTTP Method: POST
Path: hermes/feishu
Response Mode: Using Respond to Webhook Node
```

### 7.2 节点 2：Code

节点名字：

```text
Feishu Message Parser
```

代码：

```javascript
const body = $json.body ?? $json;

if (body.challenge) {
  return [
    {
      json: {
        event_type: 'feishu.challenge',
        challenge: body.challenge,
      },
    },
  ];
}

const header = body.header ?? {};
const event = body.event ?? {};
const message = event.message ?? {};
const sender = event.sender ?? {};

let content = {};
try {
  content = JSON.parse(message.content || '{}');
} catch (error) {
  content = {};
}

const text =
  content.text ??
  content.content ??
  message.content ??
  '';

return [
  {
    json: {
      event_type: header.event_type ?? body.type ?? 'unknown',
      event_id: header.event_id ?? null,
      create_time: header.create_time ?? null,
      tenant_key: header.tenant_key ?? null,

      message_id: message.message_id ?? null,
      root_id: message.root_id ?? null,
      parent_id: message.parent_id ?? null,
      chat_id: message.chat_id ?? null,
      chat_type: message.chat_type ?? null,
      message_type: message.message_type ?? null,

      user_id: sender.sender_id?.user_id ?? null,
      open_id: sender.sender_id?.open_id ?? null,
      union_id: sender.sender_id?.union_id ?? null,

      text: String(text).trim(),
      raw_body: body,
      project_key: 'HermesOS',
    },
  },
];
```

这个节点做什么：

```text
把飞书复杂 event 变成 HermesOS 能用的统一字段。
```

### 7.3 节点 3：Switch

节点名字：

```text
Is Feishu Challenge
```

判断：

```text
{{ $json.event_type }} equals feishu.challenge
```

如果是 challenge，接 Respond to Webhook。

### 7.4 节点 4：Respond to Webhook

节点名字：

```text
Respond Feishu Challenge
```

Response Body：

```json
{
  "challenge": "{{ $json.challenge }}"
}
```

### 7.5 节点 5：Respond to Webhook

节点名字：

```text
Respond Feishu OK
```

普通消息分支先立刻返回：

```json
{
  "code": 0,
  "msg": "ok"
}
```

原因：

```text
飞书要求 webhook 快速响应。
后续 AI、数据库、GitHub Actions 可以继续异步跑。
```

### 7.6 节点 6：MySQL

节点名字：

```text
Load Project Context
```

SQL：

```sql
SELECT
  p.project_key,
  p.project_name,
  p.repo_full_name,
  p.local_path,
  p.default_branch,
  p.dev_branch_prefix,
  s.project_status,
  s.git_state,
  s.active_task_id,
  s.active_job_id,
  s.last_sync_at,
  s.last_message,
  s.last_error,
  t.id AS latest_task_id,
  t.title AS latest_task_title,
  t.status AS latest_task_status,
  t.updated_at AS latest_task_updated_at
FROM hermes_projects p
LEFT JOIN hermes_project_state s
  ON s.project_key = p.project_key
LEFT JOIN hermes_tasks t
  ON t.id = s.active_task_id
WHERE p.project_key = 'HermesOS'
LIMIT 1;
```

### 7.7 节点 7：Code

节点名字：

```text
Build Action Input
```

代码：

```javascript
const message = $('Feishu Message Parser').first().json;
const context = $json;

return [
  {
    json: {
      project_key: 'HermesOS',
      text: message.text,
      feishu: {
        message_id: message.message_id,
        chat_id: message.chat_id,
        user_id: message.user_id,
        open_id: message.open_id,
      },
      context,
    },
  },
];
```

### 7.8 节点 8：HTTP Request

节点名字：

```text
DeepSeek Action Extractor
```

请求：

```text
Method: POST
URL: https://api.deepseek.com/chat/completions
```

Headers：

```text
Authorization: Bearer 你的_DEEPSEEK_API_KEY
Content-Type: application/json
```

Body：

```json
{
  "model": "deepseek-chat",
  "temperature": 0.1,
  "messages": [
    {
      "role": "system",
      "content": "这里粘贴第 5.3 节的 System Prompt"
    },
    {
      "role": "user",
      "content": "项目上下文：\n{{ JSON.stringify($json.context) }}\n\n用户消息：\n{{ $json.text }}"
    }
  ]
}
```

你要改的地方：

```text
Authorization 里的 API key
system.content 粘贴完整 prompt
```

### 7.9 节点 9：Code

节点名字：

```text
Parse Action JSON
```

代码：

```javascript
const original = $('Build Action Input').first().json;
const response = $json;

const raw =
  response.choices?.[0]?.message?.content ??
  response.data?.choices?.[0]?.message?.content ??
  response.text ??
  '';

function cleanJsonText(value) {
  return String(value)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

let action;
try {
  action = JSON.parse(cleanJsonText(raw));
} catch (error) {
  action = {
    action: 'unknown',
    project_key: 'HermesOS',
    target: 'none',
    task_id: null,
    summary: 'AI 输出不是合法 JSON',
    user_message: original.text,
    confidence: 0,
    needs_confirmation: false,
    parse_error: error.message,
    raw_output: raw,
  };
}

const allowed = new Set([
  'project.status',
  'project.sync',
  'task.create',
  'task.continue',
  'task.review',
  'task.approve',
  'task.rollback',
  'worker.online',
  'worker.offline',
  'help',
  'chat.reply',
  'unknown',
]);

if (!allowed.has(action.action)) {
  action.action = 'unknown';
}

if (!action.project_key) {
  action.project_key = 'HermesOS';
}

if (typeof action.confidence !== 'number') {
  action.confidence = 0;
}

if (action.confidence < 0.6 && action.action !== 'chat.reply') {
  action.action = 'unknown';
}

return [
  {
    json: {
      ...original,
      action,
    },
  },
];
```

### 7.10 节点 10：Code

节点名字：

```text
State Validator
```

代码：

```javascript
const item = $json;
const action = item.action;
const context = item.context ?? {};

let allowed = true;
let reason = '';
let next_action = action.action;

const projectStatus = context.project_status ?? 'IDLE';
const gitState = context.git_state ?? 'UNKNOWN';
const activeTaskId = context.active_task_id ?? null;

if (action.action === 'task.continue') {
  if (gitState === 'UNKNOWN') {
    allowed = false;
    reason = '项目真实 Git 状态未知，需要先执行 project.sync。';
    next_action = 'project.sync';
  }
  if (projectStatus === 'REVIEW_REQUIRED' || gitState === 'DIRTY') {
    allowed = false;
    reason = '当前存在待审核或未同步改动，不能直接继续开发。请先 review、approve、rollback 或 sync。';
  }
}

if (action.action === 'task.approve') {
  if (!activeTaskId) {
    allowed = false;
    reason = '当前没有 active_task_id，无法提交。';
  }
  if (projectStatus !== 'REVIEW_REQUIRED' && gitState !== 'DIRTY') {
    allowed = false;
    reason = '当前项目没有等待审核的改动，不能提交。';
  }
}

if (action.action === 'task.rollback') {
  if (!activeTaskId && gitState !== 'DIRTY') {
    allowed = false;
    reason = '当前没有可回滚的任务或本地改动。';
  }
}

return [
  {
    json: {
      ...item,
      validation: {
        allowed,
        reason,
        next_action,
        project_status: projectStatus,
        git_state: gitState,
        active_task_id: activeTaskId,
      },
    },
  },
];
```

这个节点做什么：

```text
防止 AI 直接执行危险动作。
例如本地状态未知时，不允许继续开发。
```

### 7.11 节点 11：Switch

节点名字：

```text
Dispatch by Action
```

判断字段：

```text
{{ $json.validation.next_action || $json.action.action }}
```

分支：

```text
project.status
project.sync
task.create
task.continue
task.review
task.approve
task.rollback
worker.online
worker.offline
help
chat.reply
unknown
```

第一版先只接这些：

```text
project.status
project.sync
task.create
task.continue
task.approve
task.rollback
help
unknown
```

---

## 8. 飞书回复节点

### 8.1 获取 tenant_access_token

节点名字：

```text
Feishu Tenant Token
```

HTTP Request：

```text
Method: POST
URL: https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
```

Body：

```json
{
  "app_id": "你的 FEISHU_APP_ID",
  "app_secret": "你的 FEISHU_APP_SECRET"
}
```

返回里会有：

```text
tenant_access_token
```

### 8.2 回复飞书消息

节点名字：

```text
Feishu Reply
```

HTTP Request：

```text
Method: POST
URL: https://open.feishu.cn/open-apis/im/v1/messages/{{ $('Feishu Message Parser').first().json.message_id }}/reply
```

Headers：

```text
Authorization: Bearer {{ $('Feishu Tenant Token').first().json.tenant_access_token }}
Content-Type: application/json
```

Body：

```json
{
  "msg_type": "text",
  "content": "{\"text\":\"{{ $json.reply_text }}\"}"
}
```

如果 n8n 表达式转义不好用，就先在前面加一个 Code 节点：

节点名字：

```text
Build Feishu Reply Body
```

代码：

```javascript
const text = $json.reply_text ?? 'HermesOS 已收到。';

return [
  {
    json: {
      msg_type: 'text',
      content: JSON.stringify({
        text,
      }),
    },
  },
];
```

然后 Feishu Reply 的 Body 直接用：

```json
{
  "msg_type": "{{ $json.msg_type }}",
  "content": "{{ $json.content }}"
}
```

---

## 9. project.status 分支

### 9.1 MySQL 节点

节点名字：

```text
Query Project Status
```

SQL：

```sql
SELECT
  p.project_key,
  p.project_name,
  s.project_status,
  s.git_state,
  s.active_task_id,
  s.active_job_id,
  s.last_sync_at,
  s.last_message,
  s.last_error,
  t.title AS active_task_title,
  t.status AS active_task_status
FROM hermes_projects p
LEFT JOIN hermes_project_state s ON s.project_key = p.project_key
LEFT JOIN hermes_tasks t ON t.id = s.active_task_id
WHERE p.project_key = 'HermesOS'
LIMIT 1;
```

### 9.2 MySQL 节点

节点名字：

```text
Query Recent Events
```

SQL：

```sql
SELECT
  event_type,
  title,
  details,
  created_at
FROM hermes_events
WHERE project_key = 'HermesOS'
ORDER BY created_at DESC
LIMIT 5;
```

### 9.3 Code 节点

节点名字：

```text
Format Project Status Reply
```

代码：

```javascript
const status = $('Query Project Status').first().json;
const events = $('Query Recent Events').all().map(item => item.json);

const lines = [];

lines.push('HermesOS 项目状态');
lines.push('');
lines.push(`项目：${status.project_name ?? status.project_key}`);
lines.push(`项目状态：${status.project_status ?? 'UNKNOWN'}`);
lines.push(`Git 状态：${status.git_state ?? 'UNKNOWN'}`);
lines.push(`最后同步：${status.last_sync_at ?? '暂无'}`);

if (status.active_task_id) {
  lines.push('');
  lines.push(`当前任务：#${status.active_task_id} ${status.active_task_title ?? ''}`);
  lines.push(`任务状态：${status.active_task_status ?? 'UNKNOWN'}`);
}

if (status.last_message) {
  lines.push('');
  lines.push(`备注：${status.last_message}`);
}

if (status.last_error) {
  lines.push('');
  lines.push(`最近错误：${status.last_error}`);
}

if (events.length > 0) {
  lines.push('');
  lines.push('最近事件：');
  for (const event of events) {
    lines.push(`- ${event.created_at} ${event.title}`);
  }
}

return [
  {
    json: {
      reply_text: lines.join('\n'),
    },
  },
];
```

### 9.4 最后连接

```text
Format Project Status Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply
```

---

## 10. project.sync 分支

这个分支最重要。  
它负责把 MySQL 状态和本地 Git 真实状态对齐。

### 10.1 MySQL：创建 SYNC job

节点名字：

```text
Create Sync Job
```

SQL：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  NULL,
  'SYNC',
  'QUEUED',
  JSON_OBJECT(
    'reason', 'user_requested_sync',
    'source', 'feishu'
  )
);
```

### 10.2 MySQL：记录事件

节点名字：

```text
Event Sync Requested
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  task_id,
  job_id,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  NULL,
  {{ $('Create Sync Job').first().json.insertId }},
  'PROJECT_SYNC_REQUESTED',
  'user',
  '用户请求同步项目真实状态',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
);
```

如果 n8n 不支持 `insertId` 这个字段名，就在 Create Sync Job 后看执行输出，改成实际字段。

### 10.3 HTTP Request：触发 GitHub Actions

节点名字：

```text
Trigger GitHub Actions Sync
```

请求：

```text
Method: POST
URL: https://api.github.com/repos/你的GitHub用户名/HermesOS/actions/workflows/hermes-dev.yml/dispatches
```

Headers：

```text
Authorization: Bearer 你的_GITHUB_TOKEN
Accept: application/vnd.github+json
Content-Type: application/json
```

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "sync",
    "project_key": "HermesOS",
    "task_id": "",
    "job_id": "{{ $('Create Sync Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

你要改的地方：

```text
你的GitHub用户名/HermesOS
GITHUB_TOKEN
ref，如果你的主分支不是 main 就改
```

### 10.4 回复飞书

Code 节点：

```text
Format Sync Started Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: '已开始同步 HermesOS 本地真实状态。我会检查本地 Git 状态，并把结果写回 MySQL。',
    },
  },
];
```

---

## 11. task.create 分支

用户说：

```text
这个页面太丑了，重做
修一下登录页 bug
给首页加一个任务面板
```

都走这里。

### 11.1 MySQL：创建 task

节点名字：

```text
Create Task
```

SQL：

```sql
INSERT INTO hermes_tasks (
  project_key,
  title,
  user_request,
  status,
  priority,
  source,
  created_by
) VALUES (
  'HermesOS',
  LEFT({{ JSON.stringify($('Parse Action JSON').first().json.action.summary) }}, 255),
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }},
  'CREATED',
  'NORMAL',
  'feishu',
  {{ JSON.stringify($('Feishu Message Parser').first().json.user_id) }}
);
```

### 11.2 MySQL：更新 project_state

节点名字：

```text
Set Active Task
```

SQL：

```sql
UPDATE hermes_project_state
SET
  active_task_id = {{ $('Create Task').first().json.insertId }},
  project_status = 'IDLE',
  last_message = '已创建新任务，等待规划或继续推进。'
WHERE project_key = 'HermesOS';
```

### 11.3 MySQL：记录事件

节点名字：

```text
Event Task Created
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  task_id,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  {{ $('Create Task').first().json.insertId }},
  'TASK_CREATED',
  'user',
  '用户创建了新开发任务',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
);
```

### 11.4 回复飞书

Code 节点：

```text
Format Task Created Reply
```

代码：

```javascript
const taskId = $('Create Task').first().json.insertId;
const action = $('Parse Action JSON').first().json.action;

return [
  {
    json: {
      reply_text: `已创建任务 #${taskId}\n\n任务：${action.summary}\n\n下一步你可以说：继续推进。`,
    },
  },
];
```

---

## 12. task.continue 分支

这是以后最核心的分支。  
第一版不要直接接 Claude。  
先做：

```text
task.continue -> sync 检查 -> Codex plan
```

### 12.1 如果状态未知，先 sync

State Validator 已经做了这件事：

```text
git_state = UNKNOWN -> next_action = project.sync
```

所以 task.continue 真正进入时，说明状态至少不是 UNKNOWN。

### 12.2 MySQL：创建 PLAN job

节点名字：

```text
Create Plan Job
```

SQL：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  'PLAN',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
  )
);
```

### 12.3 MySQL：更新任务为 PLANNING

节点名字：

```text
Set Task Planning
```

SQL：

```sql
UPDATE hermes_tasks
SET status = 'PLANNING'
WHERE id = {{ $('State Validator').first().json.validation.active_task_id }};
```

### 12.4 MySQL：更新项目状态

节点名字：

```text
Set Project Running Plan
```

SQL：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  active_job_id = {{ $('Create Plan Job').first().json.insertId }},
  last_message = 'Codex 正在生成开发计划。'
WHERE project_key = 'HermesOS';
```

### 12.5 HTTP：触发 GitHub Actions plan

节点名字：

```text
Trigger GitHub Actions Plan
```

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "plan",
    "project_key": "HermesOS",
    "task_id": "{{ $('State Validator').first().json.validation.active_task_id }}",
    "job_id": "{{ $('Create Plan Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

URL 和 headers 同第 10.3 节。

### 12.6 回复飞书

```javascript
return [
  {
    json: {
      reply_text: '已开始推进当前任务。第一步先让 Codex 生成开发计划，不会直接修改代码。',
    },
  },
];
```

---

## 13. task.approve 分支

用户说：

```text
没问题，提交
可以，提交吧
通过
```

走这里。

第一版必须有安全限制：

```text
只有 project_status = REVIEW_REQUIRED 或 git_state = DIRTY 才允许提交。
```

### 13.1 创建 COMMIT job

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  'COMMIT',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
  )
);
```

### 13.2 触发 GitHub Actions commit

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "commit",
    "project_key": "HermesOS",
    "task_id": "{{ $('State Validator').first().json.validation.active_task_id }}",
    "job_id": "{{ $('Create Commit Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

### 13.3 回复飞书

```javascript
return [
  {
    json: {
      reply_text: '收到确认。我会检查分支和 diff，安全通过后提交并推送。',
    },
  },
];
```

---

## 14. task.rollback 分支

用户说：

```text
回滚
不要了
撤销这次修改
```

走这里。

### 14.1 创建 ROLLBACK job

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  'ROLLBACK',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
  )
);
```

### 14.2 触发 GitHub Actions rollback

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "rollback",
    "project_key": "HermesOS",
    "task_id": "{{ $('State Validator').first().json.validation.active_task_id }}",
    "job_id": "{{ $('Create Rollback Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

### 14.3 回复飞书

```javascript
return [
  {
    json: {
      reply_text: '收到回滚请求。我会在本地安全分支上撤销当前任务改动，并把结果写回 MySQL。',
    },
  },
];
```

---

## 15. help 分支

Code 节点：

```text
Format Help Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: [
        'HermesOS 可以处理这些事情：',
        '',
        '1. 项目状态：今天项目怎么样？',
        '2. 同步状态：同步一下真实状态。',
        '3. 创建任务：这个页面太丑了，重做。',
        '4. 继续推进：继续推进项目。',
        '5. 审查任务：review 一下。',
        '6. 提交任务：没问题，提交。',
        '7. 回滚任务：这个任务不要了，回滚。',
        '',
        '建议先说：同步一下项目状态。'
      ].join('\n'),
    },
  },
];
```

---

## 16. unknown 分支

Code 节点：

```text
Format Unknown Reply
```

代码：

```javascript
const action = $('Parse Action JSON').first().json.action;

return [
  {
    json: {
      reply_text: [
        '我还没能把这句话理解成可执行动作。',
        '',
        `我理解到的内容：${action.summary ?? '无'}`,
        '',
        '你可以试试这样说：',
        '项目状态',
        '同步一下',
        '继续推进',
        '这个任务回滚',
        '没问题，提交'
      ].join('\n'),
    },
  },
];
```

---

## 17. GitHub self-hosted runner

### 17.1 为什么要用 self-hosted runner

因为 GitHub 云端 runner 访问不到你本地 Windows 项目目录。  
你要检查和修改：

```text
C:\Users\AL\Documents\HermesOS
```

就必须在你的本机运行 runner。

### 17.2 安装步骤

在 GitHub repo：

```text
Settings
  -> Actions
  -> Runners
  -> New self-hosted runner
  -> Windows
```

按 GitHub 页面命令安装。

建议给 runner 加 label：

```text
hermes
```

最终 workflow 里会写：

```yaml
runs-on: [self-hosted, Windows, hermes]
```

### 17.3 GitHub Secrets

在 repo 的 Settings -> Secrets and variables -> Actions 里添加：

```text
HERMES_PROJECT_DIR=C:\Users\AL\Documents\HermesOS
HERMES_CALLBACK_URL=https://你的-n8n-域名/webhook/hermes/actions-callback
```

如果要在 GitHub Actions 里调用外部 AI，也可以加：

```text
DEEPSEEK_API_KEY=...
```

Codex 和 Claude 更建议在本机环境变量里配置，不要放 GitHub secrets，除非你确认需要。

---

## 18. GitHub Actions workflow

在仓库里创建：

```text
.github/workflows/hermes-dev.yml
```

内容：

```yaml
name: HermesOS Dev Runner

on:
  workflow_dispatch:
    inputs:
      mode:
        description: "sync | plan | dev | review | commit | rollback"
        required: true
        type: choice
        options:
          - sync
          - plan
          - dev
          - review
          - commit
          - rollback
      project_key:
        description: "Hermes project key"
        required: true
        default: "HermesOS"
      task_id:
        description: "Hermes task id"
        required: false
        default: ""
      job_id:
        description: "Hermes job id"
        required: false
        default: ""
      user_message:
        description: "Original user request"
        required: false
        default: ""

jobs:
  hermes:
    runs-on: [self-hosted, Windows, hermes]
    timeout-minutes: 60

    env:
      HERMES_PROJECT_DIR: ${{ secrets.HERMES_PROJECT_DIR }}
      HERMES_CALLBACK_URL: ${{ secrets.HERMES_CALLBACK_URL }}
      MODE: ${{ inputs.mode }}
      PROJECT_KEY: ${{ inputs.project_key }}
      TASK_ID: ${{ inputs.task_id }}
      JOB_ID: ${{ inputs.job_id }}
      USER_MESSAGE: ${{ inputs.user_message }}

    steps:
      - name: Validate local project
        shell: pwsh
        run: |
          if ([string]::IsNullOrWhiteSpace($env:HERMES_PROJECT_DIR)) {
            throw "HERMES_PROJECT_DIR secret is empty."
          }
          if (-not (Test-Path $env:HERMES_PROJECT_DIR)) {
            throw "Project dir does not exist: $env:HERMES_PROJECT_DIR"
          }
          Set-Location $env:HERMES_PROJECT_DIR
          git rev-parse --show-toplevel

      - name: Mark job running
        shell: pwsh
        run: |
          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = $env:MODE
            status = "RUNNING"
            message = "Hermes self-hosted runner started."
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Sync git status
        if: ${{ inputs.mode == 'sync' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $branch = (git branch --show-current).Trim()
          $porcelain = git status --porcelain
          $statusText = git status --short

          if ([string]::IsNullOrWhiteSpace($porcelain)) {
            $gitState = "CLEAN"
            $projectStatus = "IDLE"
            $message = "本地 Git 工作区干净。"
          } else {
            $gitState = "DIRTY"
            $projectStatus = "DIRTY"
            $message = "本地 Git 工作区存在未提交改动。"
          }

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "sync"
            status = "SUCCEEDED"
            git_state = $gitState
            project_status = $projectStatus
            branch = $branch
            message = $message
            details = $statusText
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Codex plan
        if: ${{ inputs.mode == 'plan' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $promptPath = Join-Path $env:RUNNER_TEMP "hermes-codex-plan-prompt.md"
          $outputPath = Join-Path $env:RUNNER_TEMP "hermes-codex-plan-output.md"

          @"
          你是 HermesOS 的 Codex 规划器。

          这次不要修改任何文件。
          你只需要读取项目，输出开发计划。

          用户需求：
          $env:USER_MESSAGE

          输出内容必须包含：
          1. 你理解的任务目标
          2. 需要修改的文件
          3. 具体开发步骤
          4. 风险点
          5. 给 Claude CLI 的执行 prompt

          注意：
          - 不要提交 git
          - 不要 push
          - 不要做用户没要求的重构
          "@ | Set-Content -LiteralPath $promptPath -Encoding UTF8

          # 这里替换成你本机实际可用的 Codex CLI 命令。
          # 示例：
          # codex exec --cd $env:HERMES_PROJECT_DIR --input-file $promptPath | Tee-Object -FilePath $outputPath
          codex exec --cd $env:HERMES_PROJECT_DIR --input-file $promptPath | Tee-Object -FilePath $outputPath

          $plan = Get-Content -LiteralPath $outputPath -Raw

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "plan"
            status = "SUCCEEDED"
            artifact_type = "PLAN"
            message = "Codex 已生成开发计划。"
            content = $plan
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Claude dev
        if: ${{ inputs.mode == 'dev' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $promptPath = Join-Path $env:RUNNER_TEMP "hermes-claude-dev-prompt.md"
          $outputPath = Join-Path $env:RUNNER_TEMP "hermes-claude-dev-output.md"

          @"
          你是 HermesOS 的执行工人。

          只允许完成用户明确要求的修改。
          不要提交 git。
          不要 push。
          不要做顺手优化。
          不要升级架构。

          用户需求：
          $env:USER_MESSAGE

          完成后输出：
          1. 修改了哪些文件
          2. 实现了什么
          3. 有什么风险
          "@ | Set-Content -LiteralPath $promptPath -Encoding UTF8

          # 这里替换成你本机实际可用的 Claude CLI 命令。
          # 示例：
          # claude -p (Get-Content -LiteralPath $promptPath -Raw) | Tee-Object -FilePath $outputPath
          claude -p (Get-Content -LiteralPath $promptPath -Raw) | Tee-Object -FilePath $outputPath

          $shortStatus = git status --short
          $output = Get-Content -LiteralPath $outputPath -Raw

          if ([string]::IsNullOrWhiteSpace($shortStatus)) {
            $projectStatus = "IDLE"
            $gitState = "CLEAN"
            $message = "Claude 执行完成，但没有产生文件改动。"
          } else {
            $projectStatus = "REVIEW_REQUIRED"
            $gitState = "DIRTY"
            $message = "Claude 已完成修改，等待用户审核。"
          }

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "dev"
            status = "SUCCEEDED"
            project_status = $projectStatus
            git_state = $gitState
            message = $message
            details = $shortStatus
            content = $output
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Codex review
        if: ${{ inputs.mode == 'review' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $diffPath = Join-Path $env:RUNNER_TEMP "hermes-diff.patch"
          $promptPath = Join-Path $env:RUNNER_TEMP "hermes-codex-review-prompt.md"
          $outputPath = Join-Path $env:RUNNER_TEMP "hermes-codex-review-output.md"

          git diff | Set-Content -LiteralPath $diffPath -Encoding UTF8

          @"
          你是 HermesOS 的 Codex 审查器。

          请审查当前 git diff。
          重点找 bug、风险、回归、缺少测试。
          不要修改文件。

          输出格式：
          REVIEW_RESULT: PASS 或 FAIL

          然后给出：
          1. 主要发现
          2. 风险
          3. 建议

          Diff 文件：
          $diffPath
          "@ | Set-Content -LiteralPath $promptPath -Encoding UTF8

          codex exec --cd $env:HERMES_PROJECT_DIR --input-file $promptPath | Tee-Object -FilePath $outputPath

          $review = Get-Content -LiteralPath $outputPath -Raw

          if ($review -match "REVIEW_RESULT:\s*PASS") {
            $reviewResult = "PASS"
          } else {
            $reviewResult = "FAIL"
          }

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "review"
            status = "SUCCEEDED"
            review_result = $reviewResult
            project_status = "REVIEW_REQUIRED"
            git_state = "DIRTY"
            message = "Codex 已完成审查。"
            content = $review
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Commit changes
        if: ${{ inputs.mode == 'commit' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $branch = (git branch --show-current).Trim()
          if (-not ($branch -like "hermes/dev-*")) {
            throw "当前分支不是 hermes/dev-*，拒绝提交，防止误提交主分支。当前分支：$branch"
          }

          $shortStatus = git status --short
          if ([string]::IsNullOrWhiteSpace($shortStatus)) {
            $body = @{
              project_key = $env:PROJECT_KEY
              task_id = $env:TASK_ID
              job_id = $env:JOB_ID
              mode = "commit"
              status = "FAILED"
              message = "没有可提交改动。"
            } | ConvertTo-Json -Depth 8

            Invoke-RestMethod -Uri $env:HERMES_CALLBACK_URL -Method Post -ContentType "application/json" -Body $body
            exit 0
          }

          git add -A
          git commit -m "Hermes task $env:TASK_ID"
          git push origin $branch

          $commitHash = (git rev-parse HEAD).Trim()

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "commit"
            status = "SUCCEEDED"
            project_status = "IDLE"
            git_state = "CLEAN"
            branch = $branch
            commit_hash = $commitHash
            message = "已提交并推送当前 Hermes dev 分支。"
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

      - name: Rollback changes
        if: ${{ inputs.mode == 'rollback' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          $branch = (git branch --show-current).Trim()
          if (-not ($branch -like "hermes/dev-*")) {
            throw "当前分支不是 hermes/dev-*，拒绝回滚，防止误清理主分支。当前分支：$branch"
          }

          git reset --hard
          git clean -fd

          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = "rollback"
            status = "SUCCEEDED"
            project_status = "IDLE"
            git_state = "CLEAN"
            branch = $branch
            message = "已回滚当前 Hermes dev 分支的本地改动。"
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body
```

你要改的地方：

```text
codex exec 命令，如果你本机 Codex CLI 参数不同。
claude -p 命令，如果你本机 Claude CLI 参数不同。
runs-on labels，如果你的 self-hosted runner label 不叫 hermes。
```

重要限制：

```text
commit 和 rollback 只允许 hermes/dev-* 分支。
不要在 main 分支上自动提交或自动清理。
```

---

## 19. n8n Actions Callback Workflow

Workflow 名字：

```text
HermesOS - Actions Callback
```

### 19.1 Webhook 节点

节点名字：

```text
Actions Callback Webhook
```

设置：

```text
HTTP Method: POST
Path: hermes/actions-callback
Response Mode: Respond Immediately
```

### 19.2 Code 节点

节点名字：

```text
Parse Actions Callback
```

代码：

```javascript
const body = $json.body ?? $json;

return [
  {
    json: {
      project_key: body.project_key ?? 'HermesOS',
      task_id: body.task_id ? Number(body.task_id) : null,
      job_id: body.job_id ? Number(body.job_id) : null,
      mode: body.mode ?? 'unknown',
      status: body.status ?? 'UNKNOWN',
      project_status: body.project_status ?? null,
      git_state: body.git_state ?? null,
      branch: body.branch ?? null,
      commit_hash: body.commit_hash ?? null,
      review_result: body.review_result ?? null,
      artifact_type: body.artifact_type ?? null,
      message: body.message ?? '',
      details: body.details ?? '',
      content: body.content ?? '',
      raw_body: body,
    },
  },
];
```

### 19.3 MySQL：更新 job

节点名字：

```text
Update Job From Callback
```

SQL：

```sql
UPDATE hermes_jobs
SET
  status = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'RUNNING' THEN 'RUNNING'
    WHEN {{ JSON.stringify($json.status) }} = 'SUCCEEDED' THEN 'SUCCEEDED'
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED' THEN 'FAILED'
    ELSE status
  END,
  output_json = {{ JSON.stringify(JSON.stringify($json.raw_body)) }},
  started_at = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'RUNNING' THEN NOW()
    ELSE started_at
  END,
  finished_at = CASE
    WHEN {{ JSON.stringify($json.status) }} IN ('SUCCEEDED', 'FAILED') THEN NOW()
    ELSE finished_at
  END
WHERE id = {{ $json.job_id }};
```

如果你的 MySQL 节点 JSON 写入不接受双重 stringify，可以改成：

```sql
output_json = CAST({{ JSON.stringify(JSON.stringify($json.raw_body)) }} AS JSON)
```

### 19.4 MySQL：更新 project_state

节点名字：

```text
Update Project State From Callback
```

SQL：

```sql
UPDATE hermes_project_state
SET
  project_status = COALESCE({{ $json.project_status ? JSON.stringify($json.project_status) : 'NULL' }}, project_status),
  git_state = COALESCE({{ $json.git_state ? JSON.stringify($json.git_state) : 'NULL' }}, git_state),
  last_sync_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'sync'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE last_sync_at
  END,
  last_message = {{ JSON.stringify($json.message) }},
  last_error = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN {{ JSON.stringify($json.details || $json.message) }}
    ELSE NULL
  END,
  active_job_id = CASE
    WHEN {{ JSON.stringify($json.status) }} IN ('SUCCEEDED', 'FAILED')
    THEN NULL
    ELSE active_job_id
  END
WHERE project_key = {{ JSON.stringify($json.project_key) }};
```

### 19.5 MySQL：根据 mode 更新 task

节点名字：

```text
Update Task From Callback
```

SQL：

```sql
UPDATE hermes_tasks
SET
  status = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'PLAN_READY'

    WHEN {{ JSON.stringify($json.mode) }} = 'dev'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
      AND {{ JSON.stringify($json.git_state) }} = 'DIRTY'
    THEN 'REVIEW_REQUIRED'

    WHEN {{ JSON.stringify($json.mode) }} = 'commit'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'COMMITTED'

    WHEN {{ JSON.stringify($json.mode) }} = 'rollback'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'ROLLED_BACK'

    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN 'FAILED'

    ELSE status
  END,
  commit_hash = CASE
    WHEN {{ JSON.stringify($json.commit_hash ?? '') }} <> ''
    THEN {{ JSON.stringify($json.commit_hash ?? '') }}
    ELSE commit_hash
  END,
  plan_summary = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan'
    THEN LEFT({{ JSON.stringify($json.content ?? '') }}, 60000)
    ELSE plan_summary
  END,
  review_summary = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'review'
    THEN LEFT({{ JSON.stringify($json.content ?? '') }}, 60000)
    ELSE review_summary
  END,
  last_error = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN {{ JSON.stringify($json.details || $json.message) }}
    ELSE last_error
  END
WHERE id = {{ $json.task_id || 0 }};
```

### 19.6 MySQL：写 artifact

只有 plan、review、dev 有 content 时执行。

节点名字：

```text
Insert Callback Artifact
```

SQL：

```sql
INSERT INTO hermes_artifacts (
  project_key,
  task_id,
  job_id,
  artifact_type,
  title,
  content,
  content_format
) VALUES (
  {{ JSON.stringify($json.project_key) }},
  {{ $json.task_id || 'NULL' }},
  {{ $json.job_id || 'NULL' }},
  CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan' THEN 'PLAN'
    WHEN {{ JSON.stringify($json.mode) }} = 'review' THEN 'REVIEW_REPORT'
    WHEN {{ JSON.stringify($json.mode) }} = 'dev' THEN 'LOG'
    ELSE 'OTHER'
  END,
  {{ JSON.stringify('Callback artifact: ' + $json.mode) }},
  {{ JSON.stringify($json.content || $json.details || $json.message || '') }},
  'markdown'
);
```

### 19.7 MySQL：写 event

节点名字：

```text
Insert Callback Event
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  task_id,
  job_id,
  event_type,
  actor,
  title,
  details,
  payload_json
) VALUES (
  {{ JSON.stringify($json.project_key) }},
  {{ $json.task_id || 'NULL' }},
  {{ $json.job_id || 'NULL' }},
  CONCAT('ACTION_', UPPER({{ JSON.stringify($json.mode) }}), '_', UPPER({{ JSON.stringify($json.status) }})),
  'worker',
  {{ JSON.stringify($json.message || 'Worker callback received') }},
  {{ JSON.stringify($json.details || '') }},
  CAST({{ JSON.stringify(JSON.stringify($json.raw_body)) }} AS JSON)
);
```

### 19.8 飞书汇报 callback

第一版可以先不主动发飞书，只更新 MySQL。  
等确认 callback 稳定后，再加飞书汇报。

建议最终汇报文本：

```javascript
const mode = $json.mode;
const status = $json.status;
const message = $json.message;
const details = $json.details;

const lines = [];
lines.push(`HermesOS 回调：${mode} ${status}`);
lines.push('');
lines.push(message || '无消息');

if (details) {
  lines.push('');
  lines.push('详情：');
  lines.push(details.slice(0, 1500));
}

return [
  {
    json: {
      reply_text: lines.join('\n'),
    },
  },
];
```

---

## 20. 第一轮测试顺序

不要乱测。按这个顺序来。

### 20.1 测数据库

执行：

```sql
SELECT * FROM hermes_projects;
SELECT * FROM hermes_project_state;
SELECT * FROM hermes_worker_state;
```

应该看到：

```text
HermesOS 项目存在
project_status = IDLE
git_state = UNKNOWN
worker 存在
```

### 20.2 测飞书 Webhook

飞书发：

```text
项目状态
```

n8n 里看 `Feishu Message Parser` 输出：

```text
text = 项目状态
message_id 有值
chat_id 有值
```

### 20.3 测 DeepSeek Action

飞书发：

```text
今天项目怎么样
```

`Parse Action JSON` 输出应该是：

```json
{
  "action": "project.status"
}
```

再发：

```text
同步一下
```

应该是：

```json
{
  "action": "project.sync"
}
```

### 20.4 测 project.status

飞书发：

```text
项目状态
```

飞书应该回复：

```text
HermesOS 项目状态
项目状态：IDLE
Git 状态：UNKNOWN
```

### 20.5 测 project.sync

飞书发：

```text
同步一下
```

应该发生：

```text
n8n 创建 SYNC job
GitHub Actions 被触发
self-hosted runner 本地执行 git status
callback 回 n8n
MySQL project_state 被更新
```

检查：

```sql
SELECT * FROM hermes_jobs ORDER BY id DESC LIMIT 5;
SELECT * FROM hermes_project_state WHERE project_key = 'HermesOS';
SELECT * FROM hermes_events ORDER BY id DESC LIMIT 10;
```

### 20.6 测 task.create

飞书发：

```text
这个页面太丑了，重做
```

检查：

```sql
SELECT * FROM hermes_tasks ORDER BY id DESC LIMIT 5;
SELECT * FROM hermes_project_state WHERE project_key = 'HermesOS';
```

应该看到：

```text
新 task 创建
active_task_id 指向这个 task
```

### 20.7 测 task.continue

飞书发：

```text
继续推进
```

第一版应该：

```text
触发 Codex plan
不改代码
生成 PLAN artifact
```

---

## 21. 第二轮开发：从 Plan 到 Dev

当 Phase 1 到 Phase 7 都稳定后，再接 Claude。

### 21.1 新增 Action

可以新增：

```text
task.execute
```

但更简单是：

```text
如果 task.status = PLAN_READY
用户说“继续”
则触发 mode = dev
```

### 21.2 task.continue 的决策升级

逻辑：

```text
如果 git_state = UNKNOWN
  -> project.sync

如果 project_status = DIRTY 或 REVIEW_REQUIRED
  -> 提示先审核、提交或回滚

如果 active_task.status = CREATED
  -> 触发 plan

如果 active_task.status = PLAN_READY
  -> 触发 dev

如果 active_task.status = REVIEW_REQUIRED
  -> 提示 review / approve / rollback

如果没有 active_task
  -> 提示先创建任务
```

你可以把 State Validator 改成：

```javascript
const item = $json;
const action = item.action;
const context = item.context ?? {};

let allowed = true;
let reason = '';
let next_action = action.action;
let execution_mode = null;

const projectStatus = context.project_status ?? 'IDLE';
const gitState = context.git_state ?? 'UNKNOWN';
const activeTaskId = context.active_task_id ?? null;
const latestTaskStatus = context.latest_task_status ?? null;

if (action.action === 'task.continue') {
  if (!activeTaskId) {
    allowed = false;
    reason = '当前没有 active task，请先创建任务。';
  } else if (gitState === 'UNKNOWN') {
    allowed = true;
    next_action = 'project.sync';
    execution_mode = 'sync';
  } else if (projectStatus === 'DIRTY' || projectStatus === 'REVIEW_REQUIRED' || gitState === 'DIRTY') {
    allowed = false;
    reason = '当前存在未审核改动，请先 review、approve 或 rollback。';
  } else if (latestTaskStatus === 'CREATED') {
    execution_mode = 'plan';
  } else if (latestTaskStatus === 'PLAN_READY') {
    execution_mode = 'dev';
  } else if (latestTaskStatus === 'FAILED') {
    execution_mode = 'plan';
  } else {
    execution_mode = 'plan';
  }
}

return [
  {
    json: {
      ...item,
      validation: {
        allowed,
        reason,
        next_action,
        execution_mode,
        project_status: projectStatus,
        git_state: gitState,
        active_task_id: activeTaskId,
        latest_task_status: latestTaskStatus,
      },
    },
  },
];
```

然后 task.continue 分支里根据：

```text
validation.execution_mode
```

决定触发：

```text
plan
dev
```

---

## 22. 第三轮开发：Codex Review

当 Claude dev 稳定后，加 review。

用户发：

```text
review 一下
```

流程：

```text
task.review
  -> 创建 REVIEW job
  -> GitHub Actions mode=review
  -> Codex 审查 git diff
  -> callback 写 review artifact
  -> 飞书汇报 PASS / FAIL
```

MySQL 创建 REVIEW job：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  'REVIEW',
  'QUEUED',
  JSON_OBJECT('source', 'feishu')
);
```

触发 Actions：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "review",
    "project_key": "HermesOS",
    "task_id": "{{ $('State Validator').first().json.validation.active_task_id }}",
    "job_id": "{{ $('Create Review Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

---

## 23. 第四轮开发：Commit 和 Rollback

### 23.1 Commit 必须满足

```text
当前分支是 hermes/dev-*
git_state = DIRTY
task.status = REVIEW_REQUIRED
用户明确 approve
```

### 23.2 Rollback 必须满足

```text
当前分支是 hermes/dev-*
git_state = DIRTY 或 task.status = REVIEW_REQUIRED
用户明确 rollback
```

### 23.3 禁止

```text
禁止在 main 分支自动 commit
禁止在 main 分支 git reset --hard
禁止 AI 自己决定提交
禁止 AI 自己决定回滚
```

---

## 24. 以后要做的增强

### 24.1 更强 Session 记忆

目标：

```text
用户说“这个任务回滚”
HermesOS 自动知道是 latest_task 或 latest_review
```

做法：

```text
每次用户消息写 hermes_session_messages
每次 task.create 更新 hermes_sessions.latest_task_id
每次 dev/review 更新 latest_job_id
DeepSeek Action Extractor 输入最近 5 条 session message
```

### 24.2 更好的日报

新增 action：

```text
project.daily_report
```

SQL：

```sql
SELECT
  event_type,
  title,
  details,
  created_at
FROM hermes_events
WHERE project_key = 'HermesOS'
  AND created_at >= CURDATE()
ORDER BY created_at ASC;
```

### 24.3 多项目管理

当 HermesOS 稳定后，增加：

```text
project_key = ChatOS
project_key = AnotherProject
```

DeepSeek Action 要识别用户说的是哪个项目。

### 24.4 本地 Node Worker

如果以后觉得 GitHub Actions 太慢，可以做一个本地 Node Worker：

```text
n8n 写 hermes_jobs
Node worker 轮询 QUEUED jobs
执行本地命令
回写 MySQL
飞书汇报
```

第一版不建议马上做，因为 GitHub Actions self-hosted runner 已经能完成执行通道。

---

## 25. 当前你应该马上做什么

现在从这里开始，不要跳。

### Step 1：执行数据库 SQL

建这些表：

```text
hermes_projects
hermes_project_state
hermes_tasks
hermes_jobs
hermes_events
hermes_artifacts
hermes_worker_state
hermes_sessions
hermes_session_messages
```

然后初始化：

```text
HermesOS project
HermesOS project_state
HermesOS worker_state
```

### Step 2：搭 n8n 主 workflow

先只搭：

```text
Webhook
Feishu Message Parser
Challenge Response
Load Project Context
Build Action Input
DeepSeek Action Extractor
Parse Action JSON
State Validator
Dispatch by Action
project.status
help
unknown
Feishu Reply
```

### Step 3：测试飞书到 n8n

飞书发：

```text
项目状态
```

必须收到回复。

### Step 4：接 project.sync

搭：

```text
Create Sync Job
Trigger GitHub Actions Sync
Actions Callback Workflow
Update Project State From Callback
```

### Step 5：测试 sync

飞书发：

```text
同步一下
```

检查：

```text
GitHub Actions 是否启动
runner 是否在本地执行
MySQL git_state 是否变 CLEAN 或 DIRTY
```

### Step 6：接 task.create

飞书发：

```text
这个页面太丑了，重做
```

检查：

```text
hermes_tasks 是否新增
active_task_id 是否更新
```

### Step 7：接 task.continue 的 plan

飞书发：

```text
继续推进
```

第一版只生成 Codex plan，不改代码。

### Step 8：接 Claude dev

只有 Plan 稳定后再做。

### Step 9：接 review

只有 Claude dev 稳定后再做。

### Step 10：接 approve / rollback

最后接提交和回滚。

---

## 26. 判断项目完成的标准

HermesOS V1 完成标准：

```text
1. 飞书能查看项目状态。
2. 飞书能同步真实 Git 状态。
3. 飞书能创建任务。
4. 飞书能继续推进任务。
5. Codex 能生成开发计划。
6. Claude 能执行代码修改。
7. Codex 能 review diff。
8. 用户能 approve 后 commit / push。
9. 用户能 rollback 当前任务。
10. MySQL 记录完整任务、Job、事件、Artifact。
11. /project status 不会被旧状态误导。
12. 所有危险动作都有状态校验。
```

如果这 12 条都满足，HermesOS 就从“飞书机器人”升级成了真正的 AI 项目管家 V1。

---

## 27. 最重要的开发纪律

1. 不要同时改太多 workflow。
2. 每次只接一个 action。
3. 每个 action 都先写 event。
4. 每个 GitHub Actions 回调都必须更新 job。
5. 任何时候状态不确定，先 sync。
6. 任何时候有 DIRTY，先 review / approve / rollback。
7. AI 只负责理解和生成建议，危险动作必须由状态机判断。
8. Codex 先规划，Claude 再执行。
9. 不要让 Claude 自己决定提交。
10. main 分支永远不要自动 reset。

---

## 28. 最短可用闭环

你现在最短要做出来的是这个：

```text
飞书：项目状态
  -> 查 MySQL
  -> 回复状态

飞书：同步一下
  -> GitHub Actions 检查本地 git
  -> 回写 MySQL
  -> 回复状态

飞书：这个页面太丑了，重做
  -> 创建 task
  -> active_task_id 更新

飞书：继续推进
  -> Codex 生成 plan
  -> MySQL 保存 plan
  -> 飞书汇报 plan
```

先完成这个。  
这个完成后，HermesOS 的地基就稳了。  
后面接 Claude、Review、Commit、Rollback 都是在这个地基上加能力。

---

## 29. n8n 主 Workflow 完整连接图

这一节是为了防止你在 n8n 里连线时乱掉。  
按这个顺序连，不要自由发挥。

### 29.1 主干节点顺序

```text
Feishu Inbound Webhook
  -> Feishu Message Parser
  -> Is Feishu Challenge
```

`Is Feishu Challenge` 有两个出口：

```text
true
  -> Respond Feishu Challenge

false
  -> Respond Feishu OK
  -> Load Project Context
  -> Build Action Input
  -> DeepSeek Action Extractor
  -> Parse Action JSON
  -> State Validator
  -> Dispatch by Action
```

### 29.2 Dispatch by Action 分支连接

```text
project.status
  -> Query Project Status
  -> Query Recent Events
  -> Format Project Status Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

project.sync
  -> Create Sync Job
  -> Event Sync Requested
  -> Trigger GitHub Actions Sync
  -> Format Sync Started Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

task.create
  -> Create Task
  -> Set Active Task
  -> Event Task Created
  -> Format Task Created Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

task.continue
  -> Query Active Task For Continue
  -> Decide Continue Mode
  -> Continue Mode Switch

task.review
  -> Create Review Job
  -> Set Project Running Review
  -> Trigger GitHub Actions Review
  -> Format Review Started Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

task.approve
  -> Create Commit Job
  -> Set Project Running Commit
  -> Trigger GitHub Actions Commit
  -> Format Commit Started Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

task.rollback
  -> Create Rollback Job
  -> Set Project Running Rollback
  -> Trigger GitHub Actions Rollback
  -> Format Rollback Started Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

worker.online
  -> Set Worker Online
  -> Event Worker Online
  -> Format Worker Online Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

worker.offline
  -> Set Worker Offline
  -> Event Worker Offline
  -> Format Worker Offline Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

help
  -> Format Help Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

chat.reply
  -> DeepSeek Chat Reply
  -> Parse Chat Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply

unknown
  -> Format Unknown Reply
  -> Feishu Tenant Token
  -> Build Feishu Reply Body
  -> Feishu Reply
```

### 29.3 为什么每个分支都要回复飞书

飞书用户需要知道 HermesOS 到底做了什么。  
每个 action 都必须有一个明确回复：

```text
已开始
已拒绝
已创建
已同步
已进入审核
已提交
已回滚
无法理解
```

不要让用户发完消息后没有反馈。

---

## 30. worker.online 和 worker.offline 分支

这两个分支第一版不是真的启动或关闭 runner，只是控制 HermesOS 是否允许派发任务。

### 30.1 worker.online

用户说：

```text
本地上线
worker 上线
开始接任务
```

走 `worker.online`。

MySQL 节点名字：

```text
Set Worker Online
```

SQL：

```sql
UPDATE hermes_worker_state
SET
  enabled = 1,
  status = 'ONLINE',
  last_seen_at = NOW(),
  last_message = '用户在飞书开启本地 worker。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

MySQL 节点名字：

```text
Event Worker Online
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  'WORKER_ONLINE',
  'user',
  '本地 worker 已上线',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
);
```

Code 节点名字：

```text
Format Worker Online Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: 'HermesOS 本地 worker 已标记为上线，可以开始接收任务。建议先说：同步一下。',
    },
  },
];
```

### 30.2 worker.offline

用户说：

```text
本地下线
暂停接任务
不要接任务
```

走 `worker.offline`。

MySQL 节点名字：

```text
Set Worker Offline
```

SQL：

```sql
UPDATE hermes_worker_state
SET
  enabled = 0,
  status = 'OFFLINE',
  last_seen_at = NOW(),
  last_message = '用户在飞书关闭本地 worker。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

MySQL 节点名字：

```text
Event Worker Offline
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  'WORKER_OFFLINE',
  'user',
  '本地 worker 已下线',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
);
```

Code 节点名字：

```text
Format Worker Offline Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: 'HermesOS 本地 worker 已标记为下线，暂时不会派发新的开发任务。',
    },
  },
];
```

### 30.3 派发任务前检查 worker

所有会触发 GitHub Actions 的分支前面，都建议加一个 MySQL 节点。

节点名字：

```text
Check Worker Enabled
```

SQL：

```sql
SELECT
  enabled,
  status,
  last_seen_at,
  last_message
FROM hermes_worker_state
WHERE worker_key = 'HermesOS-Windows-Local'
LIMIT 1;
```

再加一个 Code 节点：

```text
Validate Worker Enabled
```

代码：

```javascript
const worker = $json;

if (!worker.enabled) {
  return [
    {
      json: {
        allowed: false,
        reply_text: '本地 worker 当前处于下线状态，不能派发任务。请先说：本地上线。',
      },
    },
  ];
}

return [
  {
    json: {
      allowed: true,
      worker,
    },
  },
];
```

然后用 Switch 判断：

```text
{{ $json.allowed }} equals true
```

如果 false，直接回复 `reply_text`，不要触发 GitHub Actions。

---

## 31. chat.reply 分支

这个分支用于普通聊天，不做项目动作。  
例如：

```text
你是谁？
这个系统能干什么？
为什么要先 sync？
```

### 31.1 HTTP Request：DeepSeek Chat Reply

节点名字：

```text
DeepSeek Chat Reply
```

请求：

```text
Method: POST
URL: https://api.deepseek.com/chat/completions
```

Headers：

```text
Authorization: Bearer 你的_DEEPSEEK_API_KEY
Content-Type: application/json
```

Body：

```json
{
  "model": "deepseek-chat",
  "temperature": 0.4,
  "messages": [
    {
      "role": "system",
      "content": "你是 HermesOS 的项目管家。你可以解释系统状态、解释下一步怎么做，但不能假装已经执行动作。回答要简洁、明确、中文。"
    },
    {
      "role": "user",
      "content": "项目上下文：\n{{ JSON.stringify($json.context) }}\n\n用户消息：\n{{ $json.text }}"
    }
  ]
}
```

### 31.2 Code：Parse Chat Reply

节点名字：

```text
Parse Chat Reply
```

代码：

```javascript
const raw =
  $json.choices?.[0]?.message?.content ??
  $json.data?.choices?.[0]?.message?.content ??
  '我收到了，但现在没有生成有效回复。';

return [
  {
    json: {
      reply_text: raw.trim(),
    },
  },
];
```

### 31.3 记录聊天事件

建议加 MySQL 节点：

```text
Event Chat Reply
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  'CHAT_REPLY',
  'ai',
  'HermesOS 回复普通聊天',
  {{ JSON.stringify($('Parse Chat Reply').first().json.reply_text) }}
);
```

---

## 32. task.review 完整分支

用户说：

```text
review 一下
检查一下当前改动
再审查一下
```

走 `task.review`。

### 32.1 创建 REVIEW job

MySQL 节点名字：

```text
Create Review Job
```

SQL：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  'REVIEW',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
  )
);
```

### 32.2 更新项目状态

节点名字：

```text
Set Project Running Review
```

SQL：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  active_job_id = {{ $('Create Review Job').first().json.insertId }},
  last_message = 'Codex 正在审查当前 git diff。'
WHERE project_key = 'HermesOS';
```

### 32.3 写事件

节点名字：

```text
Event Review Requested
```

SQL：

```sql
INSERT INTO hermes_events (
  project_key,
  task_id,
  job_id,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  {{ $('State Validator').first().json.validation.active_task_id }},
  {{ $('Create Review Job').first().json.insertId }},
  'TASK_REVIEW_REQUESTED',
  'user',
  '用户请求审查当前任务',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
);
```

### 32.4 触发 GitHub Actions review

HTTP Request 节点名字：

```text
Trigger GitHub Actions Review
```

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "review",
    "project_key": "HermesOS",
    "task_id": "{{ $('State Validator').first().json.validation.active_task_id }}",
    "job_id": "{{ $('Create Review Job').first().json.insertId }}",
    "user_message": "{{ $('Parse Action JSON').first().json.action.user_message }}"
  }
}
```

### 32.5 回复飞书

Code 节点名字：

```text
Format Review Started Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: '已开始审查当前任务。Codex 会读取 git diff，检查风险、bug 和缺失测试。',
    },
  },
];
```

---

## 33. task.continue 完整升级版

之前写的是第一版。这里写最终可用版。

### 33.1 Query Active Task For Continue

MySQL 节点名字：

```text
Query Active Task For Continue
```

SQL：

```sql
SELECT
  s.project_key,
  s.project_status,
  s.git_state,
  s.active_task_id,
  s.active_job_id,
  t.id AS task_id,
  t.title,
  t.user_request,
  t.status AS task_status,
  t.branch_name,
  t.plan_summary,
  t.review_summary
FROM hermes_project_state s
LEFT JOIN hermes_tasks t
  ON t.id = s.active_task_id
WHERE s.project_key = 'HermesOS'
LIMIT 1;
```

### 33.2 Decide Continue Mode

Code 节点名字：

```text
Decide Continue Mode
```

代码：

```javascript
const state = $json;

let allowed = true;
let mode = null;
let reply_text = '';

if (!state.active_task_id) {
  allowed = false;
  reply_text = '当前没有正在处理的任务。请先说一个具体需求，例如：这个页面太丑了，重做。';
} else if (state.git_state === 'UNKNOWN') {
  allowed = true;
  mode = 'sync';
} else if (state.git_state === 'DIRTY' || state.project_status === 'DIRTY' || state.project_status === 'REVIEW_REQUIRED') {
  allowed = false;
  reply_text = '当前本地存在未审核改动，不能继续开发。请先说：review 一下、没问题提交，或者回滚。';
} else if (state.task_status === 'CREATED') {
  mode = 'plan';
} else if (state.task_status === 'PLAN_READY') {
  mode = 'dev';
} else if (state.task_status === 'FAILED') {
  mode = 'plan';
} else if (state.task_status === 'PLANNING' || state.task_status === 'EXECUTING') {
  allowed = false;
  reply_text = '当前任务已经在执行中，请等回调结果。';
} else if (state.task_status === 'COMMITTED' || state.task_status === 'ROLLED_BACK' || state.task_status === 'CANCELLED') {
  allowed = false;
  reply_text = '当前任务已经结束。如果要继续，请先创建一个新任务。';
} else {
  mode = 'plan';
}

return [
  {
    json: {
      ...$('State Validator').first().json,
      active_task: state,
      continue_decision: {
        allowed,
        mode,
        reply_text,
      },
    },
  },
];
```

### 33.3 Continue Mode Switch

Switch 节点名字：

```text
Continue Mode Switch
```

判断字段：

```text
{{ $json.continue_decision.mode }}
```

分支：

```text
sync
plan
dev
```

如果 `allowed = false`，走拒绝回复。

Code 节点：

```text
Format Continue Blocked Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: $json.continue_decision.reply_text || '当前状态不允许继续推进。',
    },
  },
];
```

### 33.4 continue -> sync

直接复用 `project.sync` 分支。

回复可以稍微不同：

```javascript
return [
  {
    json: {
      reply_text: '继续推进前需要先同步真实 Git 状态。我已经开始同步。',
    },
  },
];
```

### 33.5 continue -> plan

复用第 12 节：

```text
Create Plan Job
Set Task Planning
Set Project Running Plan
Trigger GitHub Actions Plan
Format Plan Started Reply
```

### 33.6 continue -> dev

新增以下节点。

MySQL 节点名字：

```text
Create Dev Job
```

SQL：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Decide Continue Mode').first().json.active_task.task_id }},
  'DEV',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'user_message', {{ JSON.stringify($('Decide Continue Mode').first().json.active_task.user_request) }}
  )
);
```

MySQL 节点名字：

```text
Set Task Executing
```

SQL：

```sql
UPDATE hermes_tasks
SET status = 'EXECUTING'
WHERE id = {{ $('Decide Continue Mode').first().json.active_task.task_id }};
```

MySQL 节点名字：

```text
Set Project Running Dev
```

SQL：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  active_job_id = {{ $('Create Dev Job').first().json.insertId }},
  last_message = 'Claude 正在执行代码修改。'
WHERE project_key = 'HermesOS';
```

HTTP Request 节点名字：

```text
Trigger GitHub Actions Dev
```

Body：

```json
{
  "ref": "main",
  "inputs": {
    "mode": "dev",
    "project_key": "HermesOS",
    "task_id": "{{ $('Decide Continue Mode').first().json.active_task.task_id }}",
    "job_id": "{{ $('Create Dev Job').first().json.insertId }}",
    "user_message": "{{ $('Decide Continue Mode').first().json.active_task.user_request }}"
  }
}
```

Code 节点：

```text
Format Dev Started Reply
```

代码：

```javascript
return [
  {
    json: {
      reply_text: '已开始执行开发任务。Claude 会在本地安全分支上修改代码，完成后进入待审核状态。',
    },
  },
];
```

---

## 34. 分支策略必须补上

自动开发最容易出事故的地方是分支。  
所以 HermesOS 必须遵守：

```text
main 分支：只保存稳定代码
hermes/dev-{task_id}：每个任务自己的开发分支
commit / rollback 只允许 hermes/dev-* 分支
```

### 34.1 分支命名

```text
hermes/dev-1
hermes/dev-2
hermes/dev-3
```

不建议用中文或用户需求做分支名。

### 34.2 GitHub Actions 里加准备分支步骤

在 `Validate local project` 后面，加这个 step。

```yaml
      - name: Prepare dev branch
        if: ${{ inputs.mode == 'plan' || inputs.mode == 'dev' || inputs.mode == 'review' || inputs.mode == 'commit' || inputs.mode == 'rollback' }}
        shell: pwsh
        run: |
          Set-Location $env:HERMES_PROJECT_DIR

          if ([string]::IsNullOrWhiteSpace($env:TASK_ID)) {
            throw "TASK_ID is required for mode: $env:MODE"
          }

          $branch = "hermes/dev-$env:TASK_ID"

          git fetch origin

          $localExists = $false
          git show-ref --verify --quiet "refs/heads/$branch"
          if ($LASTEXITCODE -eq 0) {
            $localExists = $true
          }

          if ($localExists) {
            git checkout $branch
          } else {
            git checkout main
            git pull origin main
            git checkout -b $branch
          }

          git status --short
```

### 34.3 plan 是否需要分支

严格来说 plan 不需要分支，因为不改代码。  
但是统一切到任务分支有好处：

```text
后续 dev/review/commit/rollback 都在同一个分支
减少状态混乱
```

### 34.4 创建 task 后记录 branch_name

`Create Task` 后面加一个 MySQL 节点：

```text
Set Task Branch Name
```

SQL：

```sql
UPDATE hermes_tasks
SET branch_name = CONCAT('hermes/dev-', id)
WHERE id = {{ $('Create Task').first().json.insertId }};
```

---

## 35. GitHub Actions workflow 最终注意事项

第 18 节给了完整基础版。这里是必须再确认的点。

### 35.1 本机 Codex 命令要先单独测

在 PowerShell 里进项目目录：

```powershell
Set-Location C:\Users\AL\Documents\HermesOS
codex --help
```

如果你的 Codex 命令不是：

```powershell
codex exec --cd $env:HERMES_PROJECT_DIR --input-file $promptPath
```

就把 workflow 里的 Codex 命令替换掉。

### 35.2 本机 Claude 命令要先单独测

```powershell
claude --help
```

如果你的 Claude CLI 不是：

```powershell
claude -p "prompt"
```

就把 workflow 里的 Claude 命令替换掉。

### 35.3 self-hosted runner 权限

runner 必须能：

```text
读写 C:\Users\AL\Documents\HermesOS
执行 git
执行 codex
执行 claude
访问 n8n callback URL
访问 GitHub
```

如果 runner 是作为 Windows service 运行，要特别注意：

```text
service 用户可能不是你当前登录用户
它可能找不到 codex / claude / git
它可能没有你的环境变量
```

解决办法：

```text
1. 把 git/codex/claude 加到系统 PATH
2. 或者在 workflow 里写绝对路径
3. 或者不要用 service，先在 PowerShell 里手动运行 runner 测试
```

### 35.4 workflow 失败也要回调

基础版 workflow 如果中间 throw，后面的 callback 可能不会执行。  
最终版本应该加一个失败回调 step：

```yaml
      - name: Report failure
        if: ${{ failure() }}
        shell: pwsh
        run: |
          $body = @{
            project_key = $env:PROJECT_KEY
            task_id = $env:TASK_ID
            job_id = $env:JOB_ID
            mode = $env:MODE
            status = "FAILED"
            message = "GitHub Actions 执行失败。"
            details = "请打开 GitHub Actions 日志查看具体错误。"
          } | ConvertTo-Json -Depth 8

          Invoke-RestMethod `
            -Uri $env:HERMES_CALLBACK_URL `
            -Method Post `
            -ContentType "application/json" `
            -Body $body
```

把这个 step 放在 workflow 最后。

---

## 36. Callback 后主动发飞书

第一版可以先不做。  
但完整项目必须做，否则用户不知道异步任务什么时候完成。

问题是：callback workflow 不一定知道应该回复哪个飞书 chat。  
解决方法：创建 job 时，把飞书信息写进 `input_json`。

### 36.1 创建 job 时保存 feishu 信息

所有 Create Job SQL 都建议改成这种形式：

```sql
INSERT INTO hermes_jobs (
  project_key,
  task_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $json.task_id || 'NULL' }},
  'SYNC',
  'QUEUED',
  JSON_OBJECT(
    'source', 'feishu',
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }},
    'feishu_user_id', {{ JSON.stringify($('Feishu Message Parser').first().json.user_id) }},
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.user_message) }}
  )
);
```

### 36.2 callback 里查询 job.input_json

MySQL 节点名字：

```text
Load Job For Callback Reply
```

SQL：

```sql
SELECT
  id,
  project_key,
  task_id,
  job_type,
  status,
  input_json
FROM hermes_jobs
WHERE id = {{ $json.job_id }}
LIMIT 1;
```

### 36.3 生成 callback 飞书汇报

Code 节点名字：

```text
Format Callback Feishu Reply
```

代码：

```javascript
const cb = $('Parse Actions Callback').first().json;
const job = $('Load Job For Callback Reply').first().json;

let input = {};
try {
  input = typeof job.input_json === 'string'
    ? JSON.parse(job.input_json)
    : (job.input_json ?? {});
} catch (error) {
  input = {};
}

const lines = [];

if (cb.status === 'RUNNING') {
  lines.push(`HermesOS 已开始执行：${cb.mode}`);
} else if (cb.status === 'SUCCEEDED') {
  lines.push(`HermesOS 执行完成：${cb.mode}`);
} else if (cb.status === 'FAILED') {
  lines.push(`HermesOS 执行失败：${cb.mode}`);
} else {
  lines.push(`HermesOS 回调：${cb.mode} ${cb.status}`);
}

if (cb.message) {
  lines.push('');
  lines.push(cb.message);
}

if (cb.git_state) {
  lines.push('');
  lines.push(`Git 状态：${cb.git_state}`);
}

if (cb.project_status) {
  lines.push(`项目状态：${cb.project_status}`);
}

if (cb.review_result) {
  lines.push(`Review：${cb.review_result}`);
}

if (cb.commit_hash) {
  lines.push(`Commit：${cb.commit_hash}`);
}

if (cb.details) {
  lines.push('');
  lines.push('详情：');
  lines.push(String(cb.details).slice(0, 1200));
}

return [
  {
    json: {
      feishu_message_id: input.feishu_message_id,
      feishu_chat_id: input.feishu_chat_id,
      reply_text: lines.join('\n'),
    },
  },
];
```

### 36.4 callback 里回复飞书

如果有 `feishu_message_id`，优先 reply 原消息：

```text
POST /open-apis/im/v1/messages/{message_id}/reply
```

如果没有 `message_id`，但有 `chat_id`，发新消息：

```text
POST /open-apis/im/v1/messages?receive_id_type=chat_id
```

Body：

```json
{
  "receive_id": "{{ $json.feishu_chat_id }}",
  "msg_type": "text",
  "content": "{{ JSON.stringify({ text: $json.reply_text }) }}"
}
```

---

## 37. approve 前的二次确认

严格安全版本里，`task.approve` 和 `task.rollback` 应该二次确认。

### 37.1 为什么需要二次确认

因为这些动作会改变代码状态：

```text
commit
push
reset
clean
```

### 37.2 第一版简单做法

先不做复杂 confirmation token。  
规则：

```text
用户说“提交吧” -> HermesOS 汇报 diff 摘要，并要求用户说“确认提交”
用户说“确认提交” -> 触发 commit

用户说“回滚” -> HermesOS 汇报当前改动，并要求用户说“确认回滚”
用户说“确认回滚” -> 触发 rollback
```

### 37.3 Action 识别升级

DeepSeek Prompt 里加：

```text
- “提交吧 / 没问题 / 可以” = task.approve，但 needs_confirmation = true
- “确认提交 / 确认 commit” = task.approve，needs_confirmation = false
- “回滚 / 不要了 / 撤销” = task.rollback，但 needs_confirmation = true
- “确认回滚 / 确认撤销” = task.rollback，needs_confirmation = false
```

### 37.4 Validator 里拦截

在 `State Validator` 里加：

```javascript
if ((action.action === 'task.approve' || action.action === 'task.rollback') && action.needs_confirmation) {
  allowed = false;
  reason = action.action === 'task.approve'
    ? '这是提交动作。请明确回复：确认提交。'
    : '这是回滚动作。请明确回复：确认回滚。';
}
```

然后 blocked 分支回复：

```javascript
return [
  {
    json: {
      reply_text: $json.validation.reason,
    },
  },
];
```

---

## 38. Session 记忆完整做法

这一节先写完，后面你要做“这个任务回滚”时会用到。

### 38.1 每条用户消息写入 session_messages

在 `Parse Action JSON` 后面加 MySQL 节点：

```text
Insert User Session Message
```

SQL：

```sql
INSERT INTO hermes_session_messages (
  session_id,
  project_key,
  role,
  content,
  action_json,
  feishu_message_id
) VALUES (
  NULL,
  'HermesOS',
  'USER',
  {{ JSON.stringify($('Feishu Message Parser').first().json.text) }},
  CAST({{ JSON.stringify(JSON.stringify($('Parse Action JSON').first().json.action)) }} AS JSON),
  {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
);
```

### 38.2 更新 session latest_task_id

在 `Create Task` 后面加：

```sql
INSERT INTO hermes_sessions (
  project_key,
  feishu_chat_id,
  feishu_user_id,
  status,
  latest_task_id,
  latest_intent,
  summary
) VALUES (
  'HermesOS',
  {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
  {{ JSON.stringify($('Feishu Message Parser').first().json.user_id) }},
  'OPEN',
  {{ $('Create Task').first().json.insertId }},
  'task.create',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.summary) }}
)
ON DUPLICATE KEY UPDATE
  latest_task_id = VALUES(latest_task_id),
  latest_intent = VALUES(latest_intent),
  summary = VALUES(summary);
```

注意：这个 SQL 要求 `hermes_sessions` 对 `feishu_chat_id` 有唯一索引。  
如果你要这样用，先执行：

```sql
ALTER TABLE hermes_sessions
  ADD UNIQUE KEY uniq_project_chat_user (project_key, feishu_chat_id, feishu_user_id);
```

### 38.3 DeepSeek 输入最近消息

新增 MySQL 节点：

```text
Load Recent Session Messages
```

SQL：

```sql
SELECT
  role,
  content,
  action_json,
  created_at
FROM hermes_session_messages
WHERE project_key = 'HermesOS'
ORDER BY created_at DESC
LIMIT 8;
```

然后 `Build Action Input` 里加：

```javascript
const recentMessages = $('Load Recent Session Messages').all().map(item => item.json);
```

输出里加：

```javascript
recent_messages: recentMessages,
```

DeepSeek User Message 改成：

```text
项目上下文：
{{ JSON.stringify($json.context) }}

最近对话：
{{ JSON.stringify($json.recent_messages) }}

用户消息：
{{ $json.text }}
```

这样它就能理解“这个”“刚才那个”。

---

## 39. SQL 表结构升级补丁

如果你已经按前面的 SQL 建了表，现在继续执行这些补丁。

### 39.1 jobs 增加错误字段

```sql
ALTER TABLE hermes_jobs
  ADD COLUMN error_message TEXT NULL AFTER output_json;
```

如果提示字段已存在，就忽略。

### 39.2 project_state 增加当前分支

```sql
ALTER TABLE hermes_project_state
  ADD COLUMN current_branch VARCHAR(255) NULL AFTER git_state;
```

### 39.3 worker_state 增加 runner 名

```sql
ALTER TABLE hermes_worker_state
  ADD COLUMN runner_name VARCHAR(255) NULL AFTER worker_type;
```

### 39.4 sessions 增加唯一索引

```sql
ALTER TABLE hermes_sessions
  ADD UNIQUE KEY uniq_project_chat_user (project_key, feishu_chat_id, feishu_user_id);
```

### 39.5 tasks 增加 timestamps

```sql
ALTER TABLE hermes_tasks
  ADD COLUMN planned_at DATETIME NULL AFTER created_at,
  ADD COLUMN executed_at DATETIME NULL AFTER planned_at,
  ADD COLUMN reviewed_at DATETIME NULL AFTER executed_at,
  ADD COLUMN committed_at DATETIME NULL AFTER reviewed_at,
  ADD COLUMN rolled_back_at DATETIME NULL AFTER committed_at;
```

---

## 40. Callback 更新 SQL 增强版

前面的 callback SQL 能跑，但这里是更完整版本。

### 40.1 更新 job 增强版

```sql
UPDATE hermes_jobs
SET
  status = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'RUNNING' THEN 'RUNNING'
    WHEN {{ JSON.stringify($json.status) }} = 'SUCCEEDED' THEN 'SUCCEEDED'
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED' THEN 'FAILED'
    ELSE status
  END,
  output_json = CAST({{ JSON.stringify(JSON.stringify($json.raw_body)) }} AS JSON),
  error_message = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN {{ JSON.stringify($json.details || $json.message || '') }}
    ELSE NULL
  END,
  started_at = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'RUNNING' AND started_at IS NULL
    THEN NOW()
    ELSE started_at
  END,
  finished_at = CASE
    WHEN {{ JSON.stringify($json.status) }} IN ('SUCCEEDED', 'FAILED')
    THEN NOW()
    ELSE finished_at
  END
WHERE id = {{ $json.job_id || 0 }};
```

### 40.2 更新 project_state 增强版

```sql
UPDATE hermes_project_state
SET
  project_status = CASE
    WHEN {{ JSON.stringify($json.project_status ?? '') }} <> ''
    THEN {{ JSON.stringify($json.project_status ?? '') }}
    ELSE project_status
  END,
  git_state = CASE
    WHEN {{ JSON.stringify($json.git_state ?? '') }} <> ''
    THEN {{ JSON.stringify($json.git_state ?? '') }}
    ELSE git_state
  END,
  current_branch = CASE
    WHEN {{ JSON.stringify($json.branch ?? '') }} <> ''
    THEN {{ JSON.stringify($json.branch ?? '') }}
    ELSE current_branch
  END,
  last_sync_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'sync'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE last_sync_at
  END,
  last_message = {{ JSON.stringify($json.message || '') }},
  last_error = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN {{ JSON.stringify($json.details || $json.message || '') }}
    ELSE NULL
  END,
  active_job_id = CASE
    WHEN {{ JSON.stringify($json.status) }} IN ('SUCCEEDED', 'FAILED')
    THEN NULL
    ELSE active_job_id
  END
WHERE project_key = {{ JSON.stringify($json.project_key) }};
```

### 40.3 更新 task 增强版

```sql
UPDATE hermes_tasks
SET
  status = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'PLAN_READY'

    WHEN {{ JSON.stringify($json.mode) }} = 'dev'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
      AND {{ JSON.stringify($json.git_state) }} = 'DIRTY'
    THEN 'REVIEW_REQUIRED'

    WHEN {{ JSON.stringify($json.mode) }} = 'review'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'REVIEW_REQUIRED'

    WHEN {{ JSON.stringify($json.mode) }} = 'commit'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'COMMITTED'

    WHEN {{ JSON.stringify($json.mode) }} = 'rollback'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN 'ROLLED_BACK'

    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN 'FAILED'

    ELSE status
  END,
  branch_name = CASE
    WHEN {{ JSON.stringify($json.branch ?? '') }} <> ''
    THEN {{ JSON.stringify($json.branch ?? '') }}
    ELSE branch_name
  END,
  commit_hash = CASE
    WHEN {{ JSON.stringify($json.commit_hash ?? '') }} <> ''
    THEN {{ JSON.stringify($json.commit_hash ?? '') }}
    ELSE commit_hash
  END,
  plan_summary = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan'
    THEN LEFT({{ JSON.stringify($json.content ?? '') }}, 60000)
    ELSE plan_summary
  END,
  review_summary = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'review'
    THEN LEFT({{ JSON.stringify($json.content ?? '') }}, 60000)
    ELSE review_summary
  END,
  planned_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'plan'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE planned_at
  END,
  executed_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'dev'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE executed_at
  END,
  reviewed_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'review'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE reviewed_at
  END,
  committed_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'commit'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE committed_at
  END,
  rolled_back_at = CASE
    WHEN {{ JSON.stringify($json.mode) }} = 'rollback'
      AND {{ JSON.stringify($json.status) }} = 'SUCCEEDED'
    THEN NOW()
    ELSE rolled_back_at
  END,
  last_error = CASE
    WHEN {{ JSON.stringify($json.status) }} = 'FAILED'
    THEN {{ JSON.stringify($json.details || $json.message || '') }}
    ELSE last_error
  END
WHERE id = {{ $json.task_id || 0 }};
```

---

## 41. 完整测试矩阵

每个功能都要按矩阵测，不要只测成功路径。

### 41.1 Action 识别测试

| 用户消息 | 期望 action |
|---|---|
| 项目状态 | project.status |
| 今天做到哪了 | project.status |
| 同步一下 | project.sync |
| 检查 git | project.sync |
| 这个页面太丑了，重做 | task.create |
| 修一下登录 bug | task.create |
| 继续推进 | task.continue |
| 下一步 | task.continue |
| review 一下 | task.review |
| 没问题，提交 | task.approve |
| 确认提交 | task.approve |
| 回滚这个任务 | task.rollback |
| 确认回滚 | task.rollback |
| 本地上线 | worker.online |
| 本地下线 | worker.offline |
| 你能干什么 | help |

### 41.2 状态机测试

| 当前状态 | 用户消息 | 期望结果 |
|---|---|---|
| git_state UNKNOWN | 继续推进 | 先 sync |
| IDLE + CLEAN + no task | 继续推进 | 提示先创建任务 |
| IDLE + CLEAN + CREATED task | 继续推进 | 触发 plan |
| IDLE + CLEAN + PLAN_READY task | 继续推进 | 触发 dev |
| DIRTY | 继续推进 | 拒绝，提示 review/approve/rollback |
| REVIEW_REQUIRED | 没问题提交 | 触发 commit |
| REVIEW_REQUIRED | 回滚 | 要求确认或触发 rollback |
| RUNNING | 继续推进 | 提示正在执行 |

### 41.3 sync 测试

本地干净时：

```powershell
git status --short
```

输出为空。

飞书发：

```text
同步一下
```

期望：

```text
git_state = CLEAN
project_status = IDLE
last_sync_at 有值
```

本地有改动时：

```powershell
New-Item test-dirty.txt
```

飞书发：

```text
同步一下
```

期望：

```text
git_state = DIRTY
project_status = DIRTY
details 里包含 test-dirty.txt
```

测完清理：

```powershell
Remove-Item test-dirty.txt
```

### 41.4 dev 测试

先用一个非常小的任务：

```text
创建一个 README.md，写一句 HermesOS 初始化完成
```

然后：

```text
继续推进
继续推进
```

第一次应该 plan。  
第二次应该 dev。  
dev 后应该：

```text
git_state = DIRTY
project_status = REVIEW_REQUIRED
task.status = REVIEW_REQUIRED
```

### 41.5 commit 测试

确认当前分支：

```powershell
git branch --show-current
```

必须是：

```text
hermes/dev-数字
```

飞书发：

```text
确认提交
```

期望：

```text
commit_hash 有值
task.status = COMMITTED
git_state = CLEAN
project_status = IDLE
```

### 41.6 rollback 测试

创建一个测试任务，让 Claude 产生改动。  
然后飞书发：

```text
确认回滚
```

期望：

```text
git status --short 为空
task.status = ROLLED_BACK
git_state = CLEAN
project_status = IDLE
```

---

## 42. 常见问题和修复

### 42.1 飞书 URL 验证失败

现象：

```text
飞书后台提示 URL 验证失败
```

检查：

```text
Webhook path 是否正确
n8n workflow 是否 active
Respond Feishu Challenge 是否返回 {"challenge":"xxx"}
Response Mode 是否是 Using Respond to Webhook Node
```

### 42.2 飞书发消息 n8n 收不到

检查：

```text
飞书事件订阅是否启用
机器人是否被拉进群
是否订阅了 p2p_msg 或 group_at_msg
n8n URL 是否公网可访问
```

### 42.3 DeepSeek 输出不是 JSON

处理：

```text
降低 temperature 到 0.1
System Prompt 强调只能输出 JSON
Parse Action JSON 节点保留容错
```

### 42.4 n8n SQL 表达式报错

常见原因：

```text
字符串没有 JSON.stringify
NULL 被当成字符串 'NULL'
insertId 字段名和实际输出不一样
```

处理方法：

```text
先执行节点，看输出字段名
字符串一律用 {{ JSON.stringify(...) }}
数字字段可以直接插
```

### 42.5 GitHub Actions 没启动

检查：

```text
workflow 文件是否在 .github/workflows/hermes-dev.yml
workflow 是否已经 push 到 GitHub
GITHUB_TOKEN 是否有 actions:write 权限
dispatches URL 里的 repo 名是否正确
ref 是否存在
```

### 42.6 self-hosted runner 不接任务

检查：

```text
runner 是否在线
runs-on label 是否匹配
workflow 写的是 [self-hosted, Windows, hermes]
runner 是否真的有 hermes label
```

### 42.7 runner 找不到 codex 或 claude

检查：

```text
runner 运行用户是谁
codex/claude 是否在系统 PATH
PowerShell 里能不能运行 codex --help / claude --help
```

解决：

```text
用绝对路径调用
或把命令加入系统 PATH
或先手动启动 runner，不要作为 service
```

### 42.8 callback 没回到 n8n

检查：

```text
HERMES_CALLBACK_URL secret 是否正确
n8n callback workflow 是否 active
路径是否是 /webhook/hermes/actions-callback
runner 是否能访问公网 n8n
```

### 42.9 commit 被拒绝

原因：

```text
当前分支不是 hermes/dev-*
```

这是安全机制，不要删。  
应该修复分支准备步骤，而不是放开 main。

### 42.10 rollback 被拒绝

同理：

```text
当前分支不是 hermes/dev-*
```

不要在 main 分支 reset。

---

## 43. 最终产品使用手册

等 HermesOS 完成后，你日常只需要在飞书里这样用。

### 43.1 查看状态

```text
项目状态
今天项目怎么样
现在做到哪了
```

HermesOS 应该回复：

```text
项目状态
Git 状态
当前任务
最近事件
下一步建议
```

### 43.2 同步真实状态

```text
同步一下
检查真实状态
检查 git
```

HermesOS 应该：

```text
触发 self-hosted runner
检查本地 git status
回写 MySQL
飞书汇报 CLEAN 或 DIRTY
```

### 43.3 创建任务

```text
这个页面太丑了，重做
修一下登录页 bug
做一个项目状态面板
```

HermesOS 应该：

```text
创建 task
设置 active_task_id
回复任务编号
```

### 43.4 推进任务

```text
继续推进
下一步
接着做
```

HermesOS 应该根据状态判断：

```text
需要同步 -> sync
需要规划 -> Codex plan
需要执行 -> Claude dev
有待审核 -> 提示 review/approve/rollback
```

### 43.5 审查

```text
review 一下
检查一下当前改动
```

HermesOS 应该：

```text
Codex review git diff
返回 PASS / FAIL
```

### 43.6 提交

```text
确认提交
```

HermesOS 应该：

```text
确认当前分支 hermes/dev-*
git add
git commit
git push
记录 commit hash
状态回到 IDLE / CLEAN
```

### 43.7 回滚

```text
确认回滚
```

HermesOS 应该：

```text
确认当前分支 hermes/dev-*
git reset --hard
git clean -fd
记录 ROLLED_BACK
状态回到 IDLE / CLEAN
```

---

## 44. 最终交付清单

项目真正完结时，应该有这些东西。

### 44.1 数据库

```text
hermes_projects
hermes_project_state
hermes_tasks
hermes_jobs
hermes_events
hermes_artifacts
hermes_worker_state
hermes_sessions
hermes_session_messages
```

### 44.2 n8n workflows

```text
HermesOS - Feishu Main
HermesOS - Actions Callback
```

可选：

```text
HermesOS - Daily Report
HermesOS - Maintenance
```

### 44.3 GitHub

```text
.github/workflows/hermes-dev.yml
self-hosted runner online
GitHub secrets configured
```

### 44.4 飞书

```text
机器人可接收消息
机器人可发送消息
事件订阅正常
```

### 44.5 本地机器

```text
git 可用
codex 可用
claude 可用
self-hosted runner 可用
项目目录存在
```

### 44.6 功能验收

```text
项目状态
同步一下
创建任务
继续推进 -> plan
继续推进 -> dev
review 一下
确认提交
确认回滚
```

每个都要跑通。

---

## 45. 最后一版实施顺序

如果前面内容太多，你就按这个总顺序做。

### 第 1 天：状态地基

```text
1. 建 MySQL 表
2. 初始化 HermesOS project
3. 搭 Feishu Main workflow
4. 跑通 飞书 -> n8n -> project.status
5. 搭 Actions Callback workflow
6. 跑通 project.sync
```

第 1 天验收：

```text
飞书说“项目状态”有回复
飞书说“同步一下”会更新 MySQL git_state
```

### 第 2 天：任务地基

```text
1. 接 task.create
2. 接 task.continue -> plan
3. 配好 self-hosted runner 分支准备
4. 跑通 Codex plan
5. 保存 PLAN artifact
```

第 2 天验收：

```text
飞书创建任务
继续推进后生成开发计划
不会改代码
```

### 第 3 天：执行层

```text
1. 接 PLAN_READY -> dev
2. 配 Claude CLI
3. 跑通 Claude 修改代码
4. callback 设置 REVIEW_REQUIRED
```

第 3 天验收：

```text
Claude 能产生 git diff
MySQL 显示待审核
```

### 第 4 天：审核层

```text
1. 接 task.review
2. Codex review diff
3. 保存 REVIEW_REPORT
4. 飞书汇报 PASS / FAIL
```

第 4 天验收：

```text
review 一下能返回审查报告
```

### 第 5 天：闭环层

```text
1. 接确认提交
2. 接确认回滚
3. 加二次确认
4. 补事件记录
5. 跑完整闭环
```

第 5 天验收：

```text
创建任务 -> plan -> dev -> review -> commit
创建任务 -> plan -> dev -> rollback
两条链路都成功
```

### 第 6 天：记忆层

```text
1. 接 sessions
2. 接 session_messages
3. DeepSeek 输入最近对话
4. 支持“这个任务”“刚才那个”
```

第 6 天验收：

```text
不用 task_id，也能回滚 latest_task
```

### 第 7 天：打磨和稳定

```text
1. 补所有失败回调
2. 补所有飞书异步汇报
3. 补 worker.online/offline
4. 补 help
5. 补测试矩阵
6. 清理 n8n 节点命名
```

第 7 天验收：

```text
HermesOS V1 可以稳定使用
```

---

## 46. 你现在真正的下一步

现在不要继续想最终 AI OS。  
直接做这三个动作：

### 46.1 先建表

复制第 4 节和第 39 节 SQL 到 MySQL 执行。

### 46.2 再搭最小 n8n

只搭：

```text
Feishu Inbound Webhook
Feishu Message Parser
Respond Feishu Challenge
Respond Feishu OK
Load Project Context
Build Action Input
DeepSeek Action Extractor
Parse Action JSON
State Validator
Dispatch by Action
project.status 分支
help 分支
unknown 分支
Feishu Reply
```

### 46.3 最后测试一句

飞书发：

```text
项目状态
```

如果能收到状态回复，回来继续做：

```text
project.sync
```

这是 HermesOS 真正开始活起来的第一步。

---

## 47. 最终版本定义

前面第 1 到第 46 节写的是从 0 开始逐步落地的路线。  
这一节开始写 **HermesOS 最终完整版本**。

最终版本不是“能跑几个命令”的机器人，而是：

```text
一个由飞书控制、具备长期记忆、状态校验、任务调度、自动开发、自动审查、版本管理、日报汇报、故障恢复能力的 AI 项目操作系统。
```

最终版本必须支持：

```text
1. 多项目管理
2. 多会话上下文
3. 自然语言意图识别
4. 标准 Action 协议
5. 状态机校验
6. 任务生命周期管理
7. Job 队列和重试
8. 本地真实状态同步
9. Codex 规划
10. Claude 执行
11. Codex Review
12. 用户审批
13. 自动 commit / push
14. 安全 rollback
15. 日报 / 周报
16. 健康检查
17. 错误恢复
18. 全量事件审计
19. Artifact 保存
20. 飞书自然语言控制
```

最终版本的用户体验应该是：

```text
你在飞书里说：
今天 HermesOS 怎么样？

HermesOS 回复：
当前项目状态、最近任务、待审核内容、风险、下一步建议。

你说：
同步一下。

HermesOS 自动检查本地 Git、runner、任务队列、MySQL 状态，并修正状态。

你说：
这个页面太丑了，重做。

HermesOS 自动创建任务，进入规划。

你说：
继续推进。

HermesOS 自动判断当前阶段：
如果没计划，就让 Codex 规划。
如果有计划，就让 Claude 执行。
如果执行完，就让 Codex review。
如果待审核，就提示你提交或回滚。

你说：
确认提交。

HermesOS 自动检查安全条件，commit、push、记录 commit hash、回写 MySQL、飞书汇报。
```

---

## 48. 最终架构总图

最终架构分成 12 层。

```text
Layer 1  用户入口层
  飞书私聊、飞书群聊、未来 Web Console

Layer 2  消息解析层
  Feishu event parser、消息去重、用户身份解析

Layer 3  上下文装载层
  项目状态、任务状态、最近事件、Session、用户偏好

Layer 4  意图识别层
  DeepSeek Action Extractor，把自然语言转成标准 Action

Layer 5  策略和安全层
  State Validator、Permission Validator、Confirmation Validator

Layer 6  调度层
  Dispatcher、Action Router、Workflow Router

Layer 7  状态和记忆层
  MySQL，保存项目、任务、Job、事件、Artifact、Session

Layer 8  执行层
  GitHub Actions self-hosted runner、本地 Node Worker

Layer 9  AI 开发层
  Codex Planner、Claude Executor、Codex Reviewer

Layer 10  Git 安全层
  branch、diff、commit、push、rollback

Layer 11  汇报层
  飞书消息、日报、周报、任务完成通知、失败通知

Layer 12  运维层
  健康检查、重试、锁、错误恢复、审计
```

最终数据流：

```text
Feishu
  -> n8n Feishu Main
  -> Message Parser
  -> Context Loader
  -> DeepSeek Action Extractor
  -> Validator
  -> Dispatcher
  -> MySQL / Worker / GitHub Actions
  -> Codex / Claude / Git
  -> Callback
  -> MySQL Update
  -> Feishu Report
```

---

## 49. 最终模块清单

最终项目由这些模块组成。

### 49.1 飞书入口模块

负责：

```text
接收飞书事件
处理 URL challenge
解析消息文本
识别用户和群聊
去重 message_id
快速响应飞书 webhook
异步继续后续流程
```

必须支持：

```text
私聊
群聊 @机器人
回复原消息
主动发群消息
错误提示
帮助菜单
```

### 49.2 Action 识别模块

负责：

```text
把自然语言变成标准 action JSON
识别 target
识别 task_id
识别是否需要确认
识别用户真实意图
```

最终 action 列表：

```text
project.status
project.sync
project.report.daily
project.report.weekly
project.health
project.list
project.switch

task.create
task.continue
task.plan
task.execute
task.review
task.approve
task.rollback
task.cancel
task.list
task.detail

job.retry
job.cancel
job.status

worker.online
worker.offline
worker.status
worker.health

session.summary
session.reset

help
chat.reply
unknown
```

### 49.3 状态校验模块

负责：

```text
判断某个 action 当前能不能执行
防止状态错乱
防止 main 分支误操作
防止未审核改动被覆盖
防止重复触发 job
防止 AI 越权执行
```

必须校验：

```text
项目是否存在
worker 是否在线
是否有 active_task
是否有 active_job
git_state 是否 UNKNOWN
project_status 是否 RUNNING
是否有 DIRTY 改动
是否需要用户二次确认
当前分支是否 hermes/dev-*
```

### 49.4 任务管理模块

负责：

```text
创建任务
设置 active_task
推进任务状态
取消任务
回滚任务
查询任务详情
列出最近任务
```

### 49.5 Job 队列模块

负责：

```text
创建 job
标记 job running
标记 job succeeded
标记 job failed
失败重试
取消 job
记录 job 输入输出
```

### 49.6 执行模块

最终执行模块有两种模式：

```text
模式 A：GitHub Actions self-hosted runner
  第一版推荐，简单可靠。

模式 B：本地 Node Worker
  最终增强版，更快、更可控。
```

最终完整项目可以先用模式 A 跑通，再升级到模式 B。

### 49.7 AI 开发模块

包含三个 AI 角色：

```text
Codex Planner
  只规划，不改代码。

Claude Executor
  只执行，不决定方向。

Codex Reviewer
  审查 diff，判断风险。
```

### 49.8 Git 安全模块

负责：

```text
创建 hermes/dev-{task_id} 分支
检查 git status
生成 diff
commit
push
rollback
记录 commit hash
```

### 49.9 汇报模块

负责：

```text
状态回复
任务创建回复
执行开始回复
执行完成回复
失败回复
日报
周报
帮助信息
```

### 49.10 运维模块

负责：

```text
worker heartbeat
健康检查
失败重试
过期 job 扫描
状态修复
审计日志
数据库备份提醒
```

---

## 50. 最终数据库完整表清单

前面已经写了核心表。最终完整版本建议有这些表：

```text
hermes_projects
hermes_project_state
hermes_project_settings

hermes_tasks
hermes_jobs
hermes_events
hermes_artifacts

hermes_sessions
hermes_session_messages

hermes_worker_state
hermes_worker_heartbeats

hermes_approvals
hermes_locks
hermes_action_registry
hermes_command_aliases
hermes_health_checks
hermes_notifications
```

### 50.1 project_settings 表

用途：保存每个项目的策略配置。

```sql
CREATE TABLE IF NOT EXISTS hermes_project_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL UNIQUE,
  require_review_before_commit TINYINT(1) NOT NULL DEFAULT 1,
  require_confirmation_for_commit TINYINT(1) NOT NULL DEFAULT 1,
  require_confirmation_for_rollback TINYINT(1) NOT NULL DEFAULT 1,
  allow_auto_dev TINYINT(1) NOT NULL DEFAULT 1,
  allow_auto_commit TINYINT(1) NOT NULL DEFAULT 0,
  max_retry_count INT NOT NULL DEFAULT 2,
  max_running_jobs INT NOT NULL DEFAULT 1,
  daily_report_enabled TINYINT(1) NOT NULL DEFAULT 1,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化：

```sql
INSERT INTO hermes_project_settings (
  project_key,
  require_review_before_commit,
  require_confirmation_for_commit,
  require_confirmation_for_rollback,
  allow_auto_dev,
  allow_auto_commit,
  max_retry_count,
  max_running_jobs,
  daily_report_enabled,
  timezone
) VALUES (
  'HermesOS',
  1,
  1,
  1,
  1,
  0,
  2,
  1,
  1,
  'Asia/Shanghai'
)
ON DUPLICATE KEY UPDATE
  updated_at = NOW();
```

### 50.2 approvals 表

用途：保存提交、回滚等危险动作的二次确认。

```sql
CREATE TABLE IF NOT EXISTS hermes_approvals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  approval_type ENUM('COMMIT', 'ROLLBACK', 'CANCEL', 'EXECUTE') NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(255) NULL,
  approved_by VARCHAR(255) NULL,
  request_message TEXT NULL,
  approval_message TEXT NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_task_status (task_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

最终逻辑：

```text
用户说“提交吧”
  -> 创建 approval，status=PENDING
  -> 飞书提示“请回复 确认提交”

用户说“确认提交”
  -> 找到最新 PENDING COMMIT approval
  -> status=APPROVED
  -> 创建 COMMIT job
```

### 50.3 locks 表

用途：防止同一个项目同时跑多个危险 job。

```sql
CREATE TABLE IF NOT EXISTS hermes_locks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lock_key VARCHAR(255) NOT NULL UNIQUE,
  project_key VARCHAR(64) NOT NULL,
  locked_by VARCHAR(255) NOT NULL,
  locked_until DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_key),
  INDEX idx_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

获取锁：

```sql
INSERT INTO hermes_locks (
  lock_key,
  project_key,
  locked_by,
  locked_until
) VALUES (
  'project:HermesOS:execution',
  'HermesOS',
  'n8n',
  DATE_ADD(NOW(), INTERVAL 30 MINUTE)
)
ON DUPLICATE KEY UPDATE
  locked_by = IF(locked_until < NOW(), VALUES(locked_by), locked_by),
  locked_until = IF(locked_until < NOW(), VALUES(locked_until), locked_until);
```

释放锁：

```sql
DELETE FROM hermes_locks
WHERE lock_key = 'project:HermesOS:execution';
```

### 50.4 action_registry 表

用途：让 action 变成可管理配置，而不是写死在 prompt 里。

```sql
CREATE TABLE IF NOT EXISTS hermes_action_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action_name VARCHAR(128) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  dangerous TINYINT(1) NOT NULL DEFAULT 0,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化：

```sql
INSERT INTO hermes_action_registry
  (action_name, description, dangerous, requires_confirmation, enabled)
VALUES
  ('project.status', '查看项目状态', 0, 0, 1),
  ('project.sync', '同步项目真实状态', 0, 0, 1),
  ('task.create', '创建开发任务', 0, 0, 1),
  ('task.continue', '继续推进任务', 0, 0, 1),
  ('task.review', '审查当前任务', 0, 0, 1),
  ('task.approve', '批准并提交任务', 1, 1, 1),
  ('task.rollback', '回滚当前任务', 1, 1, 1),
  ('worker.online', '开启 worker', 0, 0, 1),
  ('worker.offline', '关闭 worker', 0, 0, 1)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  dangerous = VALUES(dangerous),
  requires_confirmation = VALUES(requires_confirmation),
  enabled = VALUES(enabled);
```

### 50.5 command_aliases 表

用途：让自然语言短语可维护。

```sql
CREATE TABLE IF NOT EXISTS hermes_command_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phrase VARCHAR(255) NOT NULL,
  action_name VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_phrase (phrase),
  INDEX idx_action (action_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化：

```sql
INSERT INTO hermes_command_aliases (phrase, action_name, enabled)
VALUES
  ('项目状态', 'project.status', 1),
  ('今天项目怎么样', 'project.status', 1),
  ('同步一下', 'project.sync', 1),
  ('检查 git', 'project.sync', 1),
  ('继续推进', 'task.continue', 1),
  ('下一步', 'task.continue', 1),
  ('review 一下', 'task.review', 1),
  ('确认提交', 'task.approve', 1),
  ('确认回滚', 'task.rollback', 1),
  ('本地上线', 'worker.online', 1),
  ('本地下线', 'worker.offline', 1)
ON DUPLICATE KEY UPDATE
  action_name = VALUES(action_name),
  enabled = VALUES(enabled);
```

### 50.6 health_checks 表

```sql
CREATE TABLE IF NOT EXISTS hermes_health_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  check_type VARCHAR(64) NOT NULL,
  status ENUM('OK', 'WARN', 'ERROR') NOT NULL,
  message TEXT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_created (project_key, created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 50.7 notifications 表

```sql
CREATE TABLE IF NOT EXISTS hermes_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  notification_type VARCHAR(64) NOT NULL,
  target_type ENUM('FEISHU_CHAT', 'FEISHU_USER') NOT NULL DEFAULT 'FEISHU_CHAT',
  target_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  status ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  INDEX idx_project_status (project_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 51. 最终状态机

### 51.1 Project 状态机

```text
IDLE
  项目空闲，可以接受新任务或继续任务。

RUNNING
  有 job 正在运行，不能重复派发。

REVIEW_REQUIRED
  本地有改动，等待 review / approve / rollback。

DIRTY
  本地有未知改动，可能不是 HermesOS 产生的，需要 sync / 人工处理。

BLOCKED
  项目被策略阻塞，例如 worker offline、approval pending。

ERROR
  最近 job 失败，需要查看错误或 retry。
```

允许转换：

```text
IDLE -> RUNNING
RUNNING -> IDLE
RUNNING -> REVIEW_REQUIRED
RUNNING -> ERROR
REVIEW_REQUIRED -> RUNNING
REVIEW_REQUIRED -> IDLE
DIRTY -> IDLE
DIRTY -> REVIEW_REQUIRED
ERROR -> RUNNING
ERROR -> IDLE
BLOCKED -> IDLE
```

禁止转换：

```text
DIRTY -> RUNNING
REVIEW_REQUIRED -> task.continue dev
RUNNING -> RUNNING
UNKNOWN git_state -> dev
```

### 51.2 Task 状态机

```text
CREATED
  用户刚创建任务。

PLANNING
  Codex 正在生成计划。

PLAN_READY
  计划已生成，等待执行。

EXECUTING
  Claude 正在改代码。

REVIEW_REQUIRED
  有代码改动，等待 review / approve / rollback。

APPROVED
  用户已批准，等待 commit。

COMMITTED
  已提交并推送。

ROLLED_BACK
  已回滚。

FAILED
  任务失败。

CANCELLED
  用户取消。
```

允许转换：

```text
CREATED -> PLANNING
PLANNING -> PLAN_READY
PLANNING -> FAILED
PLAN_READY -> EXECUTING
EXECUTING -> REVIEW_REQUIRED
EXECUTING -> FAILED
REVIEW_REQUIRED -> APPROVED
REVIEW_REQUIRED -> ROLLED_BACK
APPROVED -> COMMITTED
FAILED -> PLANNING
CREATED -> CANCELLED
PLAN_READY -> CANCELLED
```

### 51.3 Job 状态机

```text
QUEUED -> RUNNING -> SUCCEEDED
QUEUED -> RUNNING -> FAILED
QUEUED -> CANCELLED
FAILED -> QUEUED
```

### 51.4 Approval 状态机

```text
PENDING -> APPROVED
PENDING -> REJECTED
PENDING -> EXPIRED
```

---

## 52. 最终 API / Webhook 合约

### 52.1 Feishu Inbound

```text
POST /webhook/hermes/feishu
```

输入：飞书原始事件。

输出：

```json
{
  "code": 0,
  "msg": "ok"
}
```

challenge 输出：

```json
{
  "challenge": "xxx"
}
```

### 52.2 Actions Callback

```text
POST /webhook/hermes/actions-callback
```

标准 body：

```json
{
  "project_key": "HermesOS",
  "task_id": "12",
  "job_id": "99",
  "mode": "sync",
  "status": "SUCCEEDED",
  "project_status": "IDLE",
  "git_state": "CLEAN",
  "branch": "hermes/dev-12",
  "commit_hash": null,
  "review_result": null,
  "message": "本地 Git 工作区干净。",
  "details": "",
  "content": ""
}
```

### 52.3 Worker Heartbeat

如果最终做本地 Node Worker，增加：

```text
POST /webhook/hermes/worker-heartbeat
```

body：

```json
{
  "worker_key": "HermesOS-Windows-Local",
  "project_key": "HermesOS",
  "status": "ONLINE",
  "current_job_id": null,
  "message": "worker alive"
}
```

### 52.4 Worker Result

```text
POST /webhook/hermes/worker-result
```

body 和 actions-callback 保持一致。

---

## 53. 最终 n8n Workflow 清单

最终 n8n 应该有这些 workflow。

### 53.1 HermesOS - Feishu Main

用途：

```text
接收飞书消息
识别 action
校验状态
调度任务
回复飞书
```

状态：

```text
必须实现
```

### 53.2 HermesOS - Actions Callback

用途：

```text
接收 GitHub Actions / worker 回调
更新 job/task/project_state
写 event/artifact
飞书异步汇报
```

状态：

```text
必须实现
```

### 53.3 HermesOS - Daily Report

用途：

```text
每天固定时间读取 events/tasks/jobs
生成项目日报
发到飞书
```

状态：

```text
最终版本必须实现
```

### 53.4 HermesOS - Health Monitor

用途：

```text
定时检查 worker 是否在线
检查是否有超时 RUNNING job
检查 project_state 是否长时间 ERROR
写 health_checks
必要时飞书告警
```

状态：

```text
最终版本必须实现
```

### 53.5 HermesOS - Session Summarizer

用途：

```text
定期把 session_messages 总结成 session.summary
避免上下文无限增长
```

状态：

```text
最终版本建议实现
```

### 53.6 HermesOS - Approval Expirer

用途：

```text
把过期 approvals 从 PENDING 改成 EXPIRED
```

状态：

```text
最终版本建议实现
```

---

## 54. 最终 AI Prompt 清单

最终项目至少有 5 个 prompt。

### 54.1 Action Extractor Prompt

作用：

```text
自然语言 -> 标准 Action JSON
```

要求：

```text
只输出 JSON
不能执行动作
不能编造状态
```

### 54.2 Chat Reply Prompt

作用：

```text
普通解释、帮助、状态解释
```

要求：

```text
可以解释
不能假装执行
回答简洁
```

### 54.3 Codex Planner Prompt

作用：

```text
读取项目，生成开发计划和 Claude prompt
```

要求：

```text
不改代码
不提交
不 push
输出风险
输出文件列表
输出执行步骤
```

### 54.4 Claude Executor Prompt

作用：

```text
按照计划执行代码修改
```

要求：

```text
只做明确任务
不顺手优化
不改架构
不提交
不 push
完成后停止
```

### 54.5 Codex Reviewer Prompt

作用：

```text
审查 git diff
```

要求：

```text
找 bug
找风险
找回归
检查测试
输出 PASS 或 FAIL
不改代码
```

---

## 55. 最终本地 Node Worker 方案

GitHub Actions self-hosted runner 能完成最终项目，但最终更优雅的版本是本地 Node Worker。

### 55.1 为什么要 Node Worker

GitHub Actions 的问题：

```text
启动慢
调试不方便
状态回调间接
不适合高频任务
```

Node Worker 的好处：

```text
启动快
直接连 MySQL
直接执行本地命令
可以 heartbeat
可以轮询 job
更像真正的 HermesOS 执行器
```

### 55.2 Worker 目录结构

最终项目建议增加：

```text
worker/
  package.json
  .env.example
  src/
    index.js
    config.js
    db.js
    job-poller.js
    executors/
      sync.js
      plan.js
      dev.js
      review.js
      commit.js
      rollback.js
    lib/
      shell.js
      callback.js
      git.js
```

### 55.3 package.json

```json
{
  "name": "hermesos-worker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "mysql2": "^3.11.0"
  }
}
```

### 55.4 .env.example

```text
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=hermes
MYSQL_USER=root
MYSQL_PASSWORD=

PROJECT_KEY=HermesOS
WORKER_KEY=HermesOS-Windows-Local
PROJECT_DIR=C:\Users\AL\Documents\HermesOS

POLL_INTERVAL_MS=5000
CODEX_COMMAND=codex
CLAUDE_COMMAND=claude
```

### 55.5 worker/src/config.js

```javascript
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  mysql: {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  },
  projectKey: process.env.PROJECT_KEY || 'HermesOS',
  workerKey: process.env.WORKER_KEY || 'HermesOS-Windows-Local',
  projectDir: process.env.PROJECT_DIR,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),
  codexCommand: process.env.CODEX_COMMAND || 'codex',
  claudeCommand: process.env.CLAUDE_COMMAND || 'claude',
};
```

### 55.6 worker/src/db.js

```javascript
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.mysql,
  waitForConnections: true,
  connectionLimit: 5,
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
```

### 55.7 worker/src/lib/shell.js

```javascript
import { spawn } from 'node:child_process';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', code => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}
```

### 55.8 worker/src/executors/sync.js

```javascript
import { config } from '../config.js';
import { runCommand } from '../lib/shell.js';

export async function executeSyncJob() {
  const branchResult = await runCommand('git', ['branch --show-current'], {
    cwd: config.projectDir,
  });

  const statusResult = await runCommand('git', ['status --short'], {
    cwd: config.projectDir,
  });

  const branch = branchResult.stdout.trim();
  const details = statusResult.stdout.trim();

  if (!details) {
    return {
      project_status: 'IDLE',
      git_state: 'CLEAN',
      branch,
      message: '本地 Git 工作区干净。',
      details: '',
    };
  }

  return {
    project_status: 'DIRTY',
    git_state: 'DIRTY',
    branch,
    message: '本地 Git 工作区存在未提交改动。',
    details,
  };
}
```

### 55.9 worker/src/job-poller.js

```javascript
import { query } from './db.js';
import { executeSyncJob } from './executors/sync.js';

export async function pollOneJob(projectKey) {
  const jobs = await query(
    `
    SELECT *
    FROM hermes_jobs
    WHERE project_key = ?
      AND status = 'QUEUED'
    ORDER BY id ASC
    LIMIT 1
    `,
    [projectKey]
  );

  if (jobs.length === 0) {
    return null;
  }

  const job = jobs[0];

  await query(
    `
    UPDATE hermes_jobs
    SET status = 'RUNNING', started_at = NOW()
    WHERE id = ?
    `,
    [job.id]
  );

  try {
    let result;

    if (job.job_type === 'SYNC') {
      result = await executeSyncJob(job);
    } else {
      throw new Error(`Unsupported job_type: ${job.job_type}`);
    }

    await query(
      `
      UPDATE hermes_jobs
      SET
        status = 'SUCCEEDED',
        output_json = CAST(? AS JSON),
        finished_at = NOW()
      WHERE id = ?
      `,
      [JSON.stringify(result), job.id]
    );

    await query(
      `
      UPDATE hermes_project_state
      SET
        project_status = ?,
        git_state = ?,
        current_branch = ?,
        last_sync_at = NOW(),
        last_message = ?
      WHERE project_key = ?
      `,
      [
        result.project_status,
        result.git_state,
        result.branch,
        result.message,
        job.project_key,
      ]
    );

    await query(
      `
      INSERT INTO hermes_events (
        project_key,
        job_id,
        event_type,
        actor,
        title,
        details,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))
      `,
      [
        job.project_key,
        job.id,
        'WORKER_JOB_SUCCEEDED',
        'worker',
        result.message,
        result.details || '',
        JSON.stringify(result),
      ]
    );

    return {
      job,
      result,
    };
  } catch (error) {
    await query(
      `
      UPDATE hermes_jobs
      SET
        status = 'FAILED',
        error_message = ?,
        finished_at = NOW()
      WHERE id = ?
      `,
      [error.message, job.id]
    );

    await query(
      `
      UPDATE hermes_project_state
      SET
        project_status = 'ERROR',
        last_error = ?
      WHERE project_key = ?
      `,
      [error.message, job.project_key]
    );

    throw error;
  }
}
```

### 55.10 worker/src/index.js

```javascript
import { config } from './config.js';
import { query } from './db.js';
import { pollOneJob } from './job-poller.js';

async function heartbeat() {
  await query(
    `
    UPDATE hermes_worker_state
    SET
      status = 'ONLINE',
      last_seen_at = NOW(),
      last_message = 'Node worker heartbeat'
    WHERE worker_key = ?
    `,
    [config.workerKey]
  );
}

async function loop() {
  await heartbeat();

  try {
    const result = await pollOneJob(config.projectKey);
    if (result) {
      console.log(`Processed job ${result.job.id}`);
    }
  } catch (error) {
    console.error(error);
  }

  setTimeout(loop, config.pollIntervalMs);
}

console.log(`HermesOS worker started for ${config.projectKey}`);
loop();
```

最终 Node Worker 要继续补：

```text
PLAN executor
DEV executor
REVIEW executor
COMMIT executor
ROLLBACK executor
Feishu notification
lock handling
retry handling
```

但第一版可以先只让它做 SYNC。  
GitHub Actions 和 Node Worker 不冲突。最终你可以二选一，也可以把 Node Worker 当主执行器。

---

## 56. 最终日报 Workflow

Workflow 名字：

```text
HermesOS - Daily Report
```

触发器：

```text
Schedule Trigger
每天 21:30
Timezone: Asia/Shanghai
```

### 56.1 查询今日事件

MySQL：

```sql
SELECT
  event_type,
  title,
  details,
  created_at
FROM hermes_events
WHERE project_key = 'HermesOS'
  AND created_at >= CURDATE()
ORDER BY created_at ASC;
```

### 56.2 查询今日任务

```sql
SELECT
  id,
  title,
  status,
  created_at,
  updated_at,
  commit_hash
FROM hermes_tasks
WHERE project_key = 'HermesOS'
  AND created_at >= CURDATE()
ORDER BY created_at ASC;
```

### 56.3 格式化日报

Code：

```javascript
const events = $('Query Today Events').all().map(item => item.json);
const tasks = $('Query Today Tasks').all().map(item => item.json);

const lines = [];

lines.push('HermesOS 今日日报');
lines.push('');

if (tasks.length === 0) {
  lines.push('今日没有新任务。');
} else {
  lines.push('今日任务：');
  for (const task of tasks) {
    lines.push(`- #${task.id} ${task.title} [${task.status}]`);
  }
}

lines.push('');

if (events.length === 0) {
  lines.push('今日没有事件记录。');
} else {
  lines.push('关键事件：');
  for (const event of events.slice(-10)) {
    lines.push(`- ${event.created_at} ${event.title}`);
  }
}

return [
  {
    json: {
      reply_text: lines.join('\n'),
    },
  },
];
```

---

## 57. 最终健康检查 Workflow

Workflow 名字：

```text
HermesOS - Health Monitor
```

触发器：

```text
每 10 分钟一次
```

检查项：

```text
worker 是否 10 分钟内 heartbeat
是否有 RUNNING job 超过 60 分钟
是否有 project_status = ERROR
是否有 approval 超过 30 分钟未确认
是否有 git_state = UNKNOWN 超过 24 小时
```

### 57.1 检查 worker

```sql
SELECT
  worker_key,
  status,
  last_seen_at,
  TIMESTAMPDIFF(MINUTE, last_seen_at, NOW()) AS minutes_since_seen
FROM hermes_worker_state
WHERE project_key = 'HermesOS';
```

如果：

```text
minutes_since_seen > 10
```

写 health check：

```sql
INSERT INTO hermes_health_checks (
  project_key,
  check_type,
  status,
  message
) VALUES (
  'HermesOS',
  'WORKER_HEARTBEAT',
  'WARN',
  'Worker 超过 10 分钟没有 heartbeat。'
);
```

### 57.2 检查超时 job

```sql
SELECT
  id,
  job_type,
  started_at,
  TIMESTAMPDIFF(MINUTE, started_at, NOW()) AS running_minutes
FROM hermes_jobs
WHERE project_key = 'HermesOS'
  AND status = 'RUNNING'
  AND started_at < DATE_SUB(NOW(), INTERVAL 60 MINUTE);
```

超时后：

```sql
UPDATE hermes_jobs
SET
  status = 'FAILED',
  error_message = 'Job running timeout',
  finished_at = NOW()
WHERE project_key = 'HermesOS'
  AND status = 'RUNNING'
  AND started_at < DATE_SUB(NOW(), INTERVAL 60 MINUTE);
```

---

## 58. 最终安全规则

这些规则是最终项目必须遵守的。

### 58.1 Git 安全

```text
1. main 分支禁止自动 reset。
2. main 分支禁止自动 commit。
3. main 分支禁止 Claude 直接修改。
4. commit 必须在 hermes/dev-*。
5. rollback 必须在 hermes/dev-*。
6. 每个 task 一个 dev branch。
```

### 58.2 AI 安全

```text
1. DeepSeek 只能识别 action，不执行。
2. Codex Planner 不改文件。
3. Claude Executor 不提交。
4. Codex Reviewer 不改文件。
5. AI 不能绕过 State Validator。
```

### 58.3 用户确认

必须确认：

```text
commit
rollback
cancel running task
删除 artifact
清理 dirty state
```

### 58.4 状态安全

```text
1. git_state UNKNOWN 不能 dev。
2. project_status RUNNING 不能重复派发。
3. project_status REVIEW_REQUIRED 不能继续 dev。
4. worker OFFLINE 不能派发任务。
5. active_job_id 不为空时不能创建新 job，除非 job 已超时。
```

---

## 59. 最终验收剧本

这是完整项目最终验收，不是最小版本。

### 59.1 冷启动验收

从空数据库开始：

```text
1. 执行建表 SQL
2. 初始化项目
3. 启动 n8n workflows
4. 启动 self-hosted runner 或 Node Worker
5. 飞书发：项目状态
```

期望：

```text
HermesOS 能回复 IDLE / UNKNOWN
```

### 59.2 同步验收

```text
飞书：同步一下
```

期望：

```text
git_state 变 CLEAN 或 DIRTY
last_sync_at 更新
events 有 PROJECT_SYNC
飞书收到异步汇报
```

### 59.3 创建任务验收

```text
飞书：给项目加一个 README，说明 HermesOS 的目标
```

期望：

```text
tasks 新增
active_task_id 更新
branch_name = hermes/dev-{id}
events 有 TASK_CREATED
```

### 59.4 规划验收

```text
飞书：继续推进
```

期望：

```text
Codex plan 运行
task.status = PLAN_READY
artifacts 有 PLAN
飞书收到计划摘要
没有文件改动
```

### 59.5 执行验收

```text
飞书：继续推进
```

期望：

```text
Claude dev 运行
本地产生 git diff
task.status = REVIEW_REQUIRED
project_status = REVIEW_REQUIRED
git_state = DIRTY
```

### 59.6 审查验收

```text
飞书：review 一下
```

期望：

```text
Codex review 运行
artifacts 有 REVIEW_REPORT
飞书收到 PASS/FAIL
```

### 59.7 提交验收

```text
飞书：确认提交
```

期望：

```text
分支 hermes/dev-{id} commit 成功
push 成功
commit_hash 写入 task
task.status = COMMITTED
project_status = IDLE
git_state = CLEAN
```

### 59.8 回滚验收

新建另一个任务并执行到 REVIEW_REQUIRED。

```text
飞书：确认回滚
```

期望：

```text
git status --short 为空
task.status = ROLLED_BACK
project_status = IDLE
git_state = CLEAN
events 有 TASK_ROLLED_BACK
```

### 59.9 Session 验收

```text
飞书：这个任务怎么样？
```

期望：

```text
HermesOS 能理解“这个任务”是 latest_task。
```

### 59.10 日报验收

手动触发 Daily Report。

期望：

```text
飞书收到今日任务、事件、提交记录。
```

---

## 60. 最终项目完成标准

当下面所有项都完成，才算整个完整项目开发完结。

### 60.1 功能完成

```text
[ ] 飞书消息接入
[ ] 飞书回复
[ ] 飞书异步汇报
[ ] DeepSeek Action 识别
[ ] State Validator
[ ] project.status
[ ] project.sync
[ ] task.create
[ ] task.continue
[ ] task.plan
[ ] task.execute
[ ] task.review
[ ] task.approve
[ ] task.rollback
[ ] worker.online
[ ] worker.offline
[ ] help
[ ] chat.reply
[ ] session memory
[ ] daily report
[ ] health monitor
```

### 60.2 数据完成

```text
[ ] projects
[ ] project_state
[ ] project_settings
[ ] tasks
[ ] jobs
[ ] events
[ ] artifacts
[ ] sessions
[ ] session_messages
[ ] worker_state
[ ] approvals
[ ] locks
[ ] health_checks
[ ] notifications
```

### 60.3 执行完成

```text
[ ] self-hosted runner 可用
[ ] 或 Node Worker 可用
[ ] sync 可执行
[ ] plan 可执行
[ ] dev 可执行
[ ] review 可执行
[ ] commit 可执行
[ ] rollback 可执行
```

### 60.4 安全完成

```text
[ ] main 禁止自动 reset
[ ] main 禁止自动 commit
[ ] commit 需要确认
[ ] rollback 需要确认
[ ] DIRTY 阻止 continue
[ ] UNKNOWN 阻止 dev
[ ] RUNNING 阻止重复派发
[ ] 所有 job 有事件记录
```

### 60.5 可观测完成

```text
[ ] 每个任务可查
[ ] 每个 job 可查
[ ] 每个错误可查
[ ] 每个 artifact 可查
[ ] 每天有日报
[ ] worker 掉线会告警
```

---

## 61. 对前面“最小闭环”的重新说明

第 28 节和第 46 节不是最终项目。  
它们只是第一阶段的启动路线。

完整项目分为三个层级：

```text
Level 1：能活
  飞书 -> 状态 -> sync -> 创建任务 -> plan

Level 2：能干活
  plan -> dev -> review -> approve -> commit / rollback

Level 3：能长期管理
  session、日报、健康检查、多项目、重试、审计、worker、权限
```

你要的是完整最终版本，所以最终必须做到 Level 3。  
前面的最小闭环只是让 HermesOS 从 0 开始可验证，不是让你停在那里。

---

## 62. 最终推荐开发顺序

完整版本也不要一口气乱搭。  
按这个顺序做，最终就是完整项目。

```text
1. 数据库完整建表
2. Feishu Main workflow
3. Actions Callback workflow
4. project.status
5. project.sync
6. task.create
7. 本地 Node Worker
8. task.continue -> plan
9. task.continue -> dev
10. task.review
11. approval 二次确认
12. commit
13. rollback
14. session memory
15. worker.online/offline
16. callback 飞书异步汇报
17. daily report
18. health monitor
19. 多项目支持
20. GitHub Actions 可选备用通道
21. 最终验收剧本全跑一遍
```

这 21 步全部完成，才是 HermesOS 最终完整开发版本。

---

## 63. 按你的真实部署前提修正最终架构

你的真实前提是：

```text
n8n 在阿里云服务器 Docker 里。
MySQL 在阿里云服务器。
Codex 在本地电脑。
Claude 在本地电脑。
项目代码目录在本地电脑。
你希望整个系统能在本地推进项目。
```

在这个前提下，最终最优架构应该改成：

```text
阿里云 = 控制面 + 状态面
本地电脑 = 执行面 + 项目工作区
```

也就是：

```text
飞书
  -> 阿里云 n8n Docker
  -> 阿里云 MySQL 写入任务 / 状态 / 事件
  -> 本地 Hermes Worker 轮询 MySQL
  -> 本地 Worker 调 Codex / Claude / git
  -> 本地 Worker 回调阿里云 n8n
  -> n8n 更新 MySQL 并回复飞书
```

这比 GitHub Actions self-hosted runner 更适合你的场景。

### 63.1 为什么本地 Worker 是最终主通道

GitHub Actions self-hosted runner 可以用，但它不是你的最终最优主通道。

原因：

```text
1. Codex 和 Claude 都在本地，本地 Worker 调用最直接。
2. 项目目录在本地，本地 Worker 读写文件最自然。
3. n8n 在阿里云，不能直接运行本地命令。
4. 不应该把本地电脑开放公网端口给 n8n 调用。
5. 本地 Worker 主动连接云端 MySQL / n8n callback，更安全。
6. GitHub Actions dispatch 多一层 GitHub 中转，慢，也更难调试。
7. 本地 Worker 可以做 heartbeat、锁、重试、日志，更像最终系统。
```

所以最终版执行通道优先级应该是：

```text
Primary：本地 Node Worker 轮询阿里云 MySQL
Fallback：GitHub Actions self-hosted runner
Deprecated：n8n 直接调用本地机器
```

### 63.2 最终部署图

```text
┌───────────────────────────────┐
│ 飞书                           │
│ 用户自然语言控制               │
└───────────────┬───────────────┘
                │ HTTPS webhook
                ▼
┌───────────────────────────────┐
│ 阿里云 ECS / Docker            │
│ n8n                            │
│ - Feishu Main                  │
│ - Actions Callback             │
│ - Daily Report                 │
│ - Health Monitor               │
└───────────────┬───────────────┘
                │ MySQL
                ▼
┌───────────────────────────────┐
│ 阿里云 MySQL                   │
│ - projects                     │
│ - project_state                │
│ - tasks                        │
│ - jobs                         │
│ - events                       │
│ - artifacts                    │
│ - sessions                     │
│ - worker_state                 │
└───────────────▲───────────────┘
                │ outbound polling
                │ outbound callback
┌───────────────┴───────────────┐
│ 本地 Windows 电脑              │
│ Hermes Local Worker            │
│ - poll jobs                    │
│ - heartbeat                    │
│ - git status                   │
│ - codex plan                   │
│ - claude dev                   │
│ - codex review                 │
│ - commit / rollback            │
│                               │
│ C:\Users\AL\Documents\HermesOS │
└───────────────────────────────┘
```

### 63.3 网络原则

最终版本不要让阿里云主动连你的本地电脑。

推荐：

```text
本地 -> 阿里云 MySQL
本地 -> 阿里云 n8n callback
阿里云 n8n -> 飞书 API
飞书 -> 阿里云 n8n webhook
```

不推荐：

```text
阿里云 n8n -> 本地电脑 HTTP 服务
公网暴露本地 worker 端口
公网暴露本地项目目录
```

### 63.4 MySQL 访问方式

本地 Worker 需要访问阿里云 MySQL。

推荐安全方式，按优先级：

```text
1. Tailscale / ZeroTier / WireGuard 私有网络
2. 阿里云安全组只放行你本地公网 IP
3. MySQL 开启 SSL 连接
4. 创建 hermes_worker 专用 MySQL 用户，只给 hermes 库必要权限
```

不推荐：

```text
0.0.0.0/0 开放 3306
root 用户远程连接
把 MySQL 密码写进代码
```

建议创建专用用户：

```sql
CREATE USER 'hermes_worker'@'%' IDENTIFIED BY '换成强密码';

GRANT SELECT, INSERT, UPDATE, DELETE
ON hermes.*
TO 'hermes_worker'@'%';

FLUSH PRIVILEGES;
```

如果你用固定本地 IP，可以更安全：

```sql
CREATE USER 'hermes_worker'@'你的本地公网IP' IDENTIFIED BY '换成强密码';

GRANT SELECT, INSERT, UPDATE, DELETE
ON hermes.*
TO 'hermes_worker'@'你的本地公网IP';

FLUSH PRIVILEGES;
```

### 63.5 n8n Docker 需要的环境变量

阿里云 Docker 里的 n8n 至少要配置：

```text
N8N_HOST=你的域名
N8N_PROTOCOL=https
WEBHOOK_URL=https://你的域名/
N8N_ENCRYPTION_KEY=固定长随机字符串
GENERIC_TIMEZONE=Asia/Shanghai
TZ=Asia/Shanghai
```

如果 n8n 也用 MySQL 作为自己的内部数据库，注意这是 n8n 自己的库，不一定等于 HermesOS 的业务库。

建议区分：

```text
n8n_internal
  n8n 自己用。

hermes
  HermesOS 业务数据用。
```

### 63.6 本地 Worker 必须常驻

最终系统能不能本地推进项目，关键在本地 Worker 是否在线。

本地 Worker 负责：

```text
1. 每 10 秒轮询 hermes_jobs 里 QUEUED 的 job。
2. 抢占 job，改成 RUNNING。
3. 根据 job_type 执行 sync / plan / dev / review / commit / rollback。
4. 调用本地 Codex。
5. 调用本地 Claude。
6. 操作本地 Git。
7. 把执行结果写回 MySQL。
8. POST 到 n8n callback，让 n8n 回复飞书。
9. 定时 heartbeat 到 hermes_worker_state。
```

### 63.7 最终分工修正版

```text
飞书
  用户入口。

阿里云 n8n
  控制器、消息入口、AI 意图识别、飞书回复、日报、健康检查。

阿里云 MySQL
  唯一状态源、任务队列、事件日志、Artifact 存储。

本地 Hermes Worker
  唯一执行器，负责所有本地动作。

Codex
  本地规划和审查。

Claude
  本地执行代码修改。

Git
  本地真实状态与版本控制。

GitHub
  远程代码仓库和备份，不再作为主执行通道。
```

---

## 64. 针对本地 Worker 的数据库增强

如果本地 Worker 是最终主通道，`hermes_jobs` 需要支持抢占、重试和锁。

执行这些 SQL patch。

### 64.1 jobs 增加 worker 字段

```sql
ALTER TABLE hermes_jobs
  ADD COLUMN claimed_by VARCHAR(128) NULL AFTER status,
  ADD COLUMN claimed_at DATETIME NULL AFTER claimed_by,
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER claimed_at,
  ADD COLUMN max_attempts INT NOT NULL DEFAULT 2 AFTER attempt_count,
  ADD COLUMN next_run_at DATETIME NULL AFTER max_attempts;
```

如果字段已存在，忽略错误。

### 64.2 jobs 增加索引

```sql
ALTER TABLE hermes_jobs
  ADD INDEX idx_queue_poll (project_key, status, next_run_at, created_at),
  ADD INDEX idx_claimed_by (claimed_by);
```

### 64.3 worker_heartbeats 表

```sql
CREATE TABLE IF NOT EXISTS hermes_worker_heartbeats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_key VARCHAR(128) NOT NULL,
  project_key VARCHAR(64) NOT NULL,
  status ENUM('ONLINE', 'BUSY', 'ERROR', 'OFFLINE') NOT NULL,
  current_job_id BIGINT UNSIGNED NULL,
  message TEXT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_worker_created (worker_key, created_at),
  INDEX idx_project_created (project_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 64.4 Worker 抢占 job 的 SQL

本地 Worker 每次只抢一个 job。

```sql
UPDATE hermes_jobs
SET
  status = 'RUNNING',
  claimed_by = ?,
  claimed_at = NOW(),
  started_at = COALESCE(started_at, NOW()),
  attempt_count = attempt_count + 1
WHERE id = (
  SELECT id FROM (
    SELECT id
    FROM hermes_jobs
    WHERE project_key = ?
      AND status = 'QUEUED'
      AND (next_run_at IS NULL OR next_run_at <= NOW())
    ORDER BY created_at ASC
    LIMIT 1
  ) AS queued_job
);
```

然后查询自己抢到的 job：

```sql
SELECT *
FROM hermes_jobs
WHERE project_key = ?
  AND status = 'RUNNING'
  AND claimed_by = ?
ORDER BY claimed_at DESC
LIMIT 1;
```

### 64.5 Worker heartbeat SQL

```sql
UPDATE hermes_worker_state
SET
  status = ?,
  last_seen_at = NOW(),
  last_message = ?
WHERE worker_key = ?;

INSERT INTO hermes_worker_heartbeats (
  worker_key,
  project_key,
  status,
  current_job_id,
  message,
  payload_json
) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON));
```

---

## 65. 本地 Worker 最终代码结构

第 55 节写了基础 Worker。  
按你的部署前提，最终 Worker 应该升级成这个完整结构。

```text
worker/
  package.json
  .env
  .env.example
  src/
    index.js
    config.js
    db.js
    logger.js
    poller.js
    heartbeat.js
    dispatcher.js
    executors/
      sync.js
      plan.js
      dev.js
      review.js
      commit.js
      rollback.js
    services/
      git-service.js
      codex-service.js
      claude-service.js
      callback-service.js
      artifact-service.js
      event-service.js
      state-service.js
    safety/
      branch-guard.js
      dirty-guard.js
      lock-guard.js
```

最终 `.env`：

```text
MYSQL_HOST=你的阿里云MySQL地址
MYSQL_PORT=3306
MYSQL_DATABASE=hermes
MYSQL_USER=hermes_worker
MYSQL_PASSWORD=强密码

PROJECT_KEY=HermesOS
WORKER_KEY=HermesOS-Windows-Local
PROJECT_DIR=C:\Users\AL\Documents\HermesOS

N8N_CALLBACK_URL=https://你的n8n域名/webhook/hermes/actions-callback

POLL_INTERVAL_MS=5000
HEARTBEAT_INTERVAL_MS=10000

CODEX_COMMAND=codex
CLAUDE_COMMAND=claude

GIT_DEFAULT_BRANCH=main
GIT_DEV_BRANCH_PREFIX=hermes/dev-
```

---

## 66. 本地 Worker 完整执行逻辑

### 66.1 主循环

```text
启动
  -> 检查 PROJECT_DIR 是否存在
  -> 检查 git 可用
  -> 检查 codex 可用
  -> 检查 claude 可用
  -> 连接阿里云 MySQL
  -> 写 worker ONLINE
  -> 开始 heartbeat
  -> 开始 poll jobs
```

### 66.2 Job 执行流程

```text
poll QUEUED job
  -> claim job
  -> heartbeat BUSY
  -> dispatch by job_type
  -> execute
  -> write artifact
  -> write event
  -> update task
  -> update project_state
  -> update job SUCCEEDED / FAILED
  -> POST n8n callback
  -> heartbeat ONLINE
```

### 66.3 sync executor

```text
git branch --show-current
git status --short
如果空：
  git_state=CLEAN
  project_status=IDLE
否则：
  git_state=DIRTY
  project_status=DIRTY 或 REVIEW_REQUIRED
```

### 66.4 plan executor

```text
准备 hermes/dev-{task_id} 分支
读取 task.user_request
调用 codex
保存 PLAN artifact
task.status=PLAN_READY
project_status=IDLE
```

### 66.5 dev executor

```text
切到 hermes/dev-{task_id}
确认 git_state=CLEAN
调用 Claude
检查 git diff
如果无 diff：
  task.status=FAILED 或 PLAN_READY
  message=没有产生改动
如果有 diff：
  task.status=REVIEW_REQUIRED
  project_status=REVIEW_REQUIRED
  git_state=DIRTY
```

### 66.6 review executor

```text
读取 git diff
调用 Codex Reviewer
保存 REVIEW_REPORT
如果 PASS：
  仍然保持 REVIEW_REQUIRED，等待用户确认提交
如果 FAIL：
  task.status=REVIEW_REQUIRED
  project_status=REVIEW_REQUIRED
  last_message=review failed with findings
```

### 66.7 commit executor

```text
确认分支 hermes/dev-*
确认 task.status=APPROVED 或 approval=APPROVED
git add -A
git commit -m "Hermes task {task_id}: {title}"
git push origin hermes/dev-{task_id}
记录 commit_hash
task.status=COMMITTED
project_status=IDLE
git_state=CLEAN
```

### 66.8 rollback executor

```text
确认分支 hermes/dev-*
确认 approval=APPROVED
git reset --hard
git clean -fd
task.status=ROLLED_BACK
project_status=IDLE
git_state=CLEAN
```

---

## 67. n8n 在阿里云 Docker 的最终职责边界

n8n 不应该做：

```text
不直接执行 Codex
不直接执行 Claude
不直接访问本地项目目录
不直接 SSH 到你本地电脑
不直接做 git reset
不保存本地机器敏感执行密钥
```

n8n 应该做：

```text
接收飞书
调用 DeepSeek
读写 MySQL
创建 job
校验状态
发送飞书消息
接收 worker callback
生成日报
做健康检查
```

这条边界非常重要。  
最终系统稳定与否，基本取决于边界是否清楚。

---

## 68. 你这个部署前提下的最终优化建议

### 68.1 把 Node Worker 提前

原文档把 Node Worker 写成后期可选升级。  
按你的部署，应该改成：

```text
Level 1 就要做本地 Worker 的 SYNC 能力。
Level 2 扩展 Worker 的 PLAN / DEV / REVIEW / COMMIT / ROLLBACK。
Level 3 再补 heartbeat / retry / health / multi-project。
```

### 68.2 GitHub Actions 只保留备用

GitHub Actions 可以保留：

```text
当本地 Worker 坏了时，手动触发一次诊断。
当你想用 GitHub UI 看执行日志时。
当未来某些任务不需要本地 Codex/Claude 时。
```

但不要让它成为主路径。

### 68.3 MySQL 要成为真正队列

n8n 不需要主动找本地执行器。  
n8n 只要：

```text
INSERT hermes_jobs status=QUEUED
```

本地 Worker 会自己拿。

这就是最稳的云端控制、本地执行架构。

### 68.4 Worker 要有自检命令

本地 Worker 启动时必须检查：

```text
git --version
codex --help
claude --help
PROJECT_DIR 是否存在
MySQL 是否可连
n8n callback 是否可访问
```

如果失败：

```text
worker_state.status = ERROR
飞书告警
```

### 68.5 最终最完美版本的判断

按你的前提，最终最完美版本不是：

```text
n8n -> GitHub Actions -> self-hosted runner -> 本地执行
```

而是：

```text
n8n -> MySQL jobs -> 本地 Worker -> Codex/Claude/Git -> n8n callback
```

这才是最贴合你当前环境的最终版本。
