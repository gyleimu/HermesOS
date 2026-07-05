# HermesOS 最终完整开发文档

版本：Final AI Developer OS Spec  
部署前提：n8n 在阿里云 Docker，MySQL 在阿里云，Codex / Claude / 项目代码在本地 Windows  
最终目标：飞书自然语言控制，本地 Worker 推进项目，Codex 规划和 Review，Claude 改代码，MySQL 长期记忆

---

## 0. 架构评估结论

你贴的架构是目前 HermesOS 的最优方向：

```text
Session 管上下文
Job 管执行
Worker 管本地动作
Codex 管规划和 Review
Claude 管改代码
DeepSeek 管理解人话
n8n 管调度
MySQL 管记忆
```

这个方向是对的，而且比“n8n 直接调本地机器”或“GitHub Actions 当主执行通道”更适合你的环境。

我建议的最终优化是：

```text
Worker 不直连 MySQL。
Worker 只通过 n8n Webhook 通信。
MySQL 只暴露给阿里云 n8n。
本地电脑不开放公网端口。
GitHub Actions 不作为主通道，只保留为备用诊断工具。
```

最终最优链路：

```text
飞书
  -> 阿里云 n8n
  -> 阿里云 MySQL
  -> 本地 Worker 主动 poll n8n
  -> 本地 Worker 调 Codex / Claude / Git
  -> 本地 Worker report 回 n8n
  -> n8n 写 MySQL
  -> 飞书汇报
```

为什么这是最优解：

```text
1. 本地 Codex / Claude / 项目目录都在本地，执行就应该在本地。
2. n8n 在阿里云，只适合调度，不适合碰本地文件。
3. Worker 主动访问 n8n，不需要暴露本地端口。
4. Worker 不直连 MySQL，不需要公网开放 3306。
5. n8n 统一管理数据库写入，状态更可控。
6. Session + Job 混合模型能解决“这个、刚才那个、继续改”的上下文问题。
```

---

## 1. 最终项目是什么

HermesOS 不是普通飞书机器人，而是一个 AI Developer OS。

最终你可以在飞书里说：

```text
今天项目怎么样？
同步一下真实状态
这个页面太丑了，重做
这里颜色还是不行，再高级一点
review 一下
没问题继续吧
这个不要了，回滚
Hermes 本地上线
```

HermesOS 应该自动完成：

```text
1. 理解你的自然语言。
2. 找到当前项目和当前 Session。
3. 判断当前状态是否允许执行。
4. 创建 Session 或继续已有 Session。
5. 创建 Job。
6. 本地 Worker 拉取 Job。
7. Codex 规划。
8. Claude 执行。
9. Codex Review。
10. 自动修复最多 3 轮。
11. 等你审核。
12. 你确认后 commit / push。
13. 你回滚时安全 rollback。
14. 全过程写入 MySQL。
15. 飞书汇报每一步结果。
```

---

## 2. 最终架构图

```text
┌──────────────────────────────┐
│ 飞书                          │
│ 用户自然语言                   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 阿里云 n8n Docker             │
│ Hermes Main - Feishu Router   │
│ Hermes Worker - Heartbeat     │
│ Hermes Worker - Poll          │
│ Hermes Worker - Report        │
│ Hermes Reply - Feishu Sender  │
│ Hermes Daily Report           │
│ Hermes Health Monitor         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 阿里云 MySQL                  │
│ projects                      │
│ project_state                 │
│ sessions                      │
│ session_messages              │
│ session_artifacts             │
│ local_jobs                    │
│ project_events                │
│ agent_state                   │
│ approvals                     │
└──────────────▲───────────────┘
               │ HTTPS poll/report
               ▼
┌──────────────────────────────┐
│ 本地 Windows                  │
│ Hermes Worker                 │
│ C:\Users\AL\Documents\HermesOS│
│ git / codex / claude          │
└──────────────────────────────┘
```

---

## 3. 最终职责边界

### 3.1 飞书

只负责：

```text
用户输入
机器人回复
群聊 / 私聊交互
```

### 3.2 DeepSeek

只负责：

```text
自然语言 -> 标准 Action JSON
```

不负责：

```text
不执行任务
不改数据库
不调用 Codex
不调用 Claude
不操作 Git
```

### 3.3 n8n

负责：

```text
接收飞书消息
解析消息
调用 DeepSeek
构建上下文
创建 Session
创建 Job
接收 Worker heartbeat
处理 Worker poll
处理 Worker report
写 MySQL
发飞书消息
做日报和健康检查
```

不负责：

```text
不直接执行 Codex
不直接执行 Claude
不 SSH 到本地电脑
不访问本地项目目录
不做 git reset
```

### 3.4 MySQL

负责：

```text
长期记忆
状态源
Session 历史
Job 队列
事件日志
Artifact 存档
Worker 状态
审批记录
```

### 3.5 本地 Worker

负责：

```text
heartbeat 到 n8n
poll n8n 拉 Job
本地执行 git / Codex / Claude
收集 changed_files / diff_stat / summary / risk
report 回 n8n
```

Worker 不直接改 MySQL。  
Worker 只和 n8n 通信。

### 3.6 Codex

负责：

```text
读项目
理解任务
生成计划
生成 Claude Prompt
Review Claude 改动
判断 PASS / FAIL
必要时生成修复建议
```

Codex 默认不直接改代码，除非未来你明确允许。

### 3.7 Claude

负责：

```text
按 Codex Prompt 改代码
不提交
不 push
不做无关扩展
改完停止
```

### 3.8 GitHub

负责：

```text
远程仓库
分支备份
commit 历史
push
Pull Request，可选
```

GitHub Actions 不做主执行通道。

---

## 4. Level 1 到 Level 3 完整目标

### Level 1：能活

目标：

```text
飞书 -> n8n -> DeepSeek -> Action JSON
Worker heartbeat / poll / report
project.status
project.sync
Worker 假装执行 Job
```

验收：

```text
飞书发“项目状态”，能回复。
飞书发“同步一下”，本地 Worker 能执行 git status 并汇报。
```

### Level 2：能干活

目标：

```text
Session 创建
Job 创建
Codex Plan
Claude Execute
Codex Review
Review Pending
Approve Commit
Rollback
```

验收：

```text
飞书一句话创建开发 Session。
Worker 本地完成 Codex -> Claude -> Codex Review。
用户确认后 commit / push。
用户回滚时安全 rollback。
```

### Level 3：能长期管理

目标：

```text
Session 长期上下文
自动修复最多 3 轮
日报
健康检查
Worker 状态告警
Job 重试
审批过期
多项目支持
完整审计
```

验收：

```text
你可以说“刚才那个继续改”“这个不要了”“今天项目怎么样”，Hermes 都能理解并操作正确 Session。
```

---

## 5. 最终 Workflow 数量

不要做几十个 n8n Workflow。最终控制在 7 个。

```text
1. Hermes Main - Feishu Router
2. Hermes Worker - Heartbeat
3. Hermes Worker - Poll
4. Hermes Worker - Report
5. Hermes Reply - Feishu Sender
6. Hermes Daily Report
7. Hermes Health Monitor
```

Level 1 先做前 5 个。  
Level 3 再做 Daily Report 和 Health Monitor。

---

## 6. 最终 Action 协议

DeepSeek 输出标准 JSON。

### 6.1 Action 列表

```text
project.status
project.sync
project.report.daily

dev.run
dev.fix
dev.review
dev.approve
dev.rollback
dev.cancel

session.status
session.list
session.reset

worker.online
worker.offline
worker.status

help
chat.reply
unknown
```

### 6.2 Action JSON 格式

```json
{
  "action": "dev.run",
  "project_key": "HermesOS",
  "target": "current_session",
  "instruction": "把当前页面重新设计得更高级",
  "summary": "重做当前页面视觉效果",
  "session_id": null,
  "confidence": 0.92,
  "need_confirm": false
}
```

字段说明：

```text
action
  标准动作。

project_key
  默认 HermesOS。

target
  current_session
  latest_session
  explicit_session
  current_project
  none

instruction
  给后续 Codex / Claude 使用的用户意图。

summary
  一句话摘要。

session_id
  明确指定 Session 时填写，否则 null。

confidence
  0 到 1。

need_confirm
  commit / rollback 等危险动作需要 true。
```

---

## 7. 数据库完整设计

在阿里云 MySQL 执行。

### 7.1 建库

```sql
CREATE DATABASE IF NOT EXISTS hermes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hermes;
```

### 7.2 hermes_projects

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

初始化：

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

### 7.3 hermes_project_state

```sql
CREATE TABLE IF NOT EXISTS hermes_project_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL UNIQUE,
  project_status ENUM(
    'IDLE',
    'RUNNING',
    'REVIEW_PENDING',
    'DIRTY',
    'BLOCKED',
    'ERROR'
  ) NOT NULL DEFAULT 'IDLE',
  git_state ENUM('UNKNOWN', 'CLEAN', 'DIRTY') NOT NULL DEFAULT 'UNKNOWN',
  current_branch VARCHAR(255) NULL,
  current_session_id BIGINT UNSIGNED NULL,
  current_job_id BIGINT UNSIGNED NULL,
  last_sync_at DATETIME NULL,
  last_message TEXT NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_status),
  INDEX idx_git_state (git_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化：

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
  'HermesOS 已初始化，等待本地 Worker 同步。'
)
ON DUPLICATE KEY UPDATE
  project_status = VALUES(project_status),
  git_state = VALUES(git_state),
  last_message = VALUES(last_message);
```

### 7.4 hermes_sessions

Session 是开发上下文。

```sql
CREATE TABLE IF NOT EXISTS hermes_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  user_goal TEXT NOT NULL,
  status ENUM(
    'OPEN',
    'PLANNING',
    'EXECUTING',
    'REVIEWING',
    'FIXING',
    'REVIEW_PENDING',
    'APPROVING',
    'DONE',
    'ROLLED_BACK',
    'BLOCKED',
    'FAILED'
  ) NOT NULL DEFAULT 'OPEN',
  branch_name VARCHAR(255) NULL,
  risk_level ENUM('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  review_result ENUM('PASS', 'FAIL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  fix_count INT NOT NULL DEFAULT 0,
  max_fix_count INT NOT NULL DEFAULT 3,
  commit_hash VARCHAR(128) NULL,
  created_by VARCHAR(255) NULL,
  feishu_chat_id VARCHAR(255) NULL,
  feishu_message_id VARCHAR(255) NULL,
  summary TEXT NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.5 hermes_session_messages

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

### 7.6 hermes_session_artifacts

```sql
CREATE TABLE IF NOT EXISTS hermes_session_artifacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  project_key VARCHAR(64) NOT NULL,
  artifact_type ENUM(
    'PLAN',
    'CLAUDE_PROMPT',
    'CLAUDE_RESULT',
    'REVIEW_REPORT',
    'DIFF_STAT',
    'WORKER_LOG',
    'OTHER'
  ) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  content_format ENUM('text', 'markdown', 'json') NOT NULL DEFAULT 'markdown',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_type (session_id, artifact_type),
  INDEX idx_project_type (project_key, artifact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.7 hermes_local_jobs

Job 是一次具体执行。

```sql
CREATE TABLE IF NOT EXISTS hermes_local_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  job_type ENUM(
    'SYNC',
    'DEV_RUN',
    'DEV_FIX',
    'DEV_REVIEW',
    'APPROVE',
    'ROLLBACK',
    'HEALTH'
  ) NOT NULL,
  status ENUM(
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'PENDING',
  priority INT NOT NULL DEFAULT 100,
  worker_key VARCHAR(128) NULL,
  lease_token VARCHAR(128) NULL,
  lease_until DATETIME NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 2,
  input_json JSON NULL,
  output_json JSON NULL,
  error_message TEXT NULL,
  run_after DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_queue (project_key, status, priority, created_at),
  INDEX idx_session (session_id),
  INDEX idx_worker (worker_key),
  INDEX idx_lease (lease_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.8 hermes_project_events

```sql
CREATE TABLE IF NOT EXISTS hermes_project_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  job_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL DEFAULT 'system',
  title VARCHAR(255) NOT NULL,
  details TEXT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_created (project_key, created_at),
  INDEX idx_session_created (session_id, created_at),
  INDEX idx_event_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.9 hermes_agent_state

```sql
CREATE TABLE IF NOT EXISTS hermes_agent_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_key VARCHAR(128) NOT NULL UNIQUE,
  project_key VARCHAR(64) NOT NULL,
  status ENUM('OFFLINE', 'IDLE', 'BUSY', 'PAUSED', 'ERROR') NOT NULL DEFAULT 'OFFLINE',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  current_job_id BIGINT UNSIGNED NULL,
  last_seen_at DATETIME NULL,
  last_message TEXT NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

初始化：

```sql
INSERT INTO hermes_agent_state (
  worker_key,
  project_key,
  status,
  enabled,
  last_message
) VALUES (
  'HermesOS-Windows-Local',
  'HermesOS',
  'OFFLINE',
  1,
  '等待本地 Worker heartbeat。'
)
ON DUPLICATE KEY UPDATE
  enabled = VALUES(enabled),
  last_message = VALUES(last_message);
```

### 7.10 hermes_approvals

```sql
CREATE TABLE IF NOT EXISTS hermes_approvals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  approval_type ENUM('APPROVE', 'ROLLBACK', 'CANCEL') NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(255) NULL,
  approved_by VARCHAR(255) NULL,
  request_message TEXT NULL,
  approval_message TEXT NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_key, status),
  INDEX idx_session_status (session_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 8. n8n 凭证和环境

### 8.1 n8n Docker 环境变量

阿里云 Docker 里建议：

```text
N8N_HOST=你的域名
N8N_PROTOCOL=https
WEBHOOK_URL=https://你的域名/
N8N_ENCRYPTION_KEY=固定随机长字符串
GENERIC_TIMEZONE=Asia/Shanghai
TZ=Asia/Shanghai
```

### 8.2 n8n Credentials

需要创建：

```text
MySQL Credential
  连接阿里云 MySQL hermes 库。

DeepSeek Credential
  HTTP Header Authorization: Bearer xxx

Feishu App Credential
  app_id
  app_secret
```

### 8.3 Worker API Token

创建一个随机 token：

```text
HERMES_WORKER_TOKEN=换成很长的随机字符串
```

本地 Worker 每次请求 n8n worker webhook 都带：

```text
Authorization: Bearer HERMES_WORKER_TOKEN
```

n8n Worker 三个 workflow 第一节点后都要校验这个 token。

---

## 9. n8n Workflow 1：Hermes Main - Feishu Router

### 9.1 节点顺序

```text
Feishu Inbound Webhook
  -> Feishu Message Parser
  -> Is Feishu Challenge
    -> true: Respond Challenge
    -> false:
      -> Respond Feishu OK
      -> Load Project Context
      -> Load Current Session
      -> Load Recent Messages
      -> Build Action Input
      -> DeepSeek Action Translator
      -> Parse Action JSON
      -> Hermes Brain
      -> Dispatch Action
```

### 9.2 Feishu Inbound Webhook

```text
Method: POST
Path: hermes/feishu
Response Mode: Using Respond to Webhook Node
```

飞书事件订阅 URL：

```text
https://你的n8n域名/webhook/hermes/feishu
```

### 9.3 Feishu Message Parser

Code 节点：

```javascript
const body = $json.body ?? $json;

if (body.challenge) {
  return [{ json: { event_type: 'feishu.challenge', challenge: body.challenge } }];
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

const text = String(content.text ?? content.content ?? message.content ?? '').trim();

return [
  {
    json: {
      event_type: header.event_type ?? 'unknown',
      event_id: header.event_id ?? null,
      message_id: message.message_id ?? null,
      chat_id: message.chat_id ?? null,
      chat_type: message.chat_type ?? null,
      user_id: sender.sender_id?.user_id ?? null,
      open_id: sender.sender_id?.open_id ?? null,
      union_id: sender.sender_id?.union_id ?? null,
      text,
      raw_body: body,
      project_key: 'HermesOS',
    },
  },
];
```

### 9.4 Challenge Response

如果 `event_type = feishu.challenge`，返回：

```json
{
  "challenge": "{{ $json.challenge }}"
}
```

普通消息立刻返回：

```json
{
  "code": 0,
  "msg": "ok"
}
```

### 9.5 Load Project Context

MySQL：

```sql
SELECT
  p.project_key,
  p.project_name,
  p.local_path,
  p.default_branch,
  p.dev_branch_prefix,
  s.project_status,
  s.git_state,
  s.current_branch,
  s.current_session_id,
  s.current_job_id,
  s.last_sync_at,
  s.last_message,
  s.last_error,
  a.status AS worker_status,
  a.enabled AS worker_enabled,
  a.last_seen_at AS worker_last_seen_at
FROM hermes_projects p
LEFT JOIN hermes_project_state s ON s.project_key = p.project_key
LEFT JOIN hermes_agent_state a ON a.project_key = p.project_key
WHERE p.project_key = 'HermesOS'
LIMIT 1;
```

### 9.6 Load Current Session

```sql
SELECT *
FROM hermes_sessions
WHERE project_key = 'HermesOS'
  AND status IN ('OPEN','PLANNING','EXECUTING','REVIEWING','FIXING','REVIEW_PENDING','BLOCKED','FAILED')
ORDER BY updated_at DESC
LIMIT 1;
```

### 9.7 Load Recent Messages

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

### 9.8 Build Action Input

Code：

```javascript
const msg = $('Feishu Message Parser').first().json;
const project = $('Load Project Context').first().json;
const currentSession = $('Load Current Session').first()?.json ?? null;
const recentMessages = $('Load Recent Messages').all().map(item => item.json);

return [
  {
    json: {
      project_key: 'HermesOS',
      text: msg.text,
      feishu: {
        message_id: msg.message_id,
        chat_id: msg.chat_id,
        user_id: msg.user_id,
        open_id: msg.open_id,
      },
      context: {
        project,
        current_session: currentSession,
        recent_messages: recentMessages,
      },
    },
  },
];
```

### 9.9 DeepSeek Action Translator

HTTP Request：

```text
POST https://api.deepseek.com/chat/completions
```

Body：

```json
{
  "model": "deepseek-chat",
  "temperature": 0.1,
  "messages": [
    {
      "role": "system",
      "content": "你是 HermesOS 的 Action Translator。你只能把用户自然语言转换成标准 Action JSON。不能执行任务，不能编造状态，不能解释。只输出 JSON，不要 Markdown。可用 action：project.status, project.sync, project.report.daily, dev.run, dev.fix, dev.review, dev.approve, dev.rollback, dev.cancel, session.status, session.list, session.reset, worker.online, worker.offline, worker.status, help, chat.reply, unknown。规则：查看状态=project.status；同步/检查git=project.sync；新需求/重做/修bug=dev.run；这里再改/继续修=dev.fix；review=dev.review；没问题/提交/确认提交=dev.approve；回滚/不要了/撤销=dev.rollback；本地上线=worker.online；本地下线=worker.offline；帮助=help。如果用户说这个/这里/刚才那个，target=current_session。commit和rollback默认 need_confirm=true，只有用户明确说确认提交或确认回滚时 need_confirm=false。confidence低于0.6时 action=unknown。输出格式：{\"action\":\"dev.run\",\"project_key\":\"HermesOS\",\"target\":\"current_session\",\"instruction\":\"\",\"summary\":\"\",\"session_id\":null,\"confidence\":0.9,\"need_confirm\":false}"
    },
    {
      "role": "user",
      "content": "上下文：\n{{ JSON.stringify($json.context) }}\n\n用户消息：\n{{ $json.text }}"
    }
  ]
}
```

### 9.10 Parse Action JSON

Code：

```javascript
const original = $('Build Action Input').first().json;
const raw = $json.choices?.[0]?.message?.content ?? '';

function clean(value) {
  return String(value)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

let action;
try {
  action = JSON.parse(clean(raw));
} catch (error) {
  action = {
    action: 'unknown',
    project_key: 'HermesOS',
    target: 'none',
    instruction: original.text,
    summary: 'DeepSeek 输出不是合法 JSON',
    session_id: null,
    confidence: 0,
    need_confirm: false,
    raw_output: raw,
    parse_error: error.message,
  };
}

const allowed = new Set([
  'project.status',
  'project.sync',
  'project.report.daily',
  'dev.run',
  'dev.fix',
  'dev.review',
  'dev.approve',
  'dev.rollback',
  'dev.cancel',
  'session.status',
  'session.list',
  'session.reset',
  'worker.online',
  'worker.offline',
  'worker.status',
  'help',
  'chat.reply',
  'unknown',
]);

if (!allowed.has(action.action)) action.action = 'unknown';
if (!action.project_key) action.project_key = 'HermesOS';
if (typeof action.confidence !== 'number') action.confidence = 0;
if (action.confidence < 0.6 && action.action !== 'chat.reply') action.action = 'unknown';

return [{ json: { ...original, action } }];
```

### 9.11 Hermes Brain

Code：

```javascript
const item = $json;
const action = item.action;
const project = item.context.project ?? {};
const session = item.context.current_session ?? null;

let allowed = true;
let reason = '';
let route = action.action;

const projectStatus = project.project_status ?? 'IDLE';
const gitState = project.git_state ?? 'UNKNOWN';
const workerEnabled = Number(project.worker_enabled ?? 0) === 1;
const workerStatus = project.worker_status ?? 'OFFLINE';

const workerRequired = new Set([
  'project.sync',
  'dev.run',
  'dev.fix',
  'dev.review',
  'dev.approve',
  'dev.rollback',
]);

if (workerRequired.has(action.action)) {
  if (!workerEnabled || workerStatus === 'OFFLINE' || workerStatus === 'ERROR') {
    allowed = false;
    reason = '本地 Worker 当前不可用。请先启动本地 Worker，或发送：Hermes 本地上线。';
  }
}

if ((action.action === 'dev.run' || action.action === 'dev.fix') && projectStatus === 'RUNNING') {
  allowed = false;
  reason = '当前已有 Job 正在执行，不能重复派发。';
}

if ((action.action === 'dev.run' || action.action === 'dev.fix') && gitState === 'DIRTY') {
  allowed = false;
  reason = '本地 Git 存在未处理改动，请先 review、提交或回滚。';
}

if (action.action === 'dev.fix' && !session) {
  allowed = false;
  reason = '当前没有可继续修改的 Session，请先创建一个开发任务。';
}

if ((action.action === 'dev.approve' || action.action === 'dev.rollback') && !session) {
  allowed = false;
  reason = '当前没有可提交或回滚的 Session。';
}

if ((action.action === 'dev.approve' || action.action === 'dev.rollback') && action.need_confirm) {
  allowed = false;
  reason = action.action === 'dev.approve'
    ? '这是提交动作。请明确回复：确认提交。'
    : '这是回滚动作。请明确回复：确认回滚。';
}

return [
  {
    json: {
      ...item,
      brain: {
        allowed,
        reason,
        route,
        project_status: projectStatus,
        git_state: gitState,
        current_session_id: session?.id ?? null,
      },
    },
  },
];
```

### 9.12 Dispatch Action

Switch 字段：

```text
{{ $json.brain.allowed ? $json.brain.route : 'blocked' }}
```

分支：

```text
blocked
project.status
project.sync
dev.run
dev.fix
dev.review
dev.approve
dev.rollback
worker.online
worker.offline
worker.status
help
chat.reply
unknown
```

---

## 10. Main Router 各分支怎么做

### 10.1 blocked

Code：

```javascript
return [{ json: { reply_text: $json.brain.reason || '当前状态不允许执行。' } }];
```

发送到 `Hermes Reply - Feishu Sender`。

### 10.2 project.status

MySQL：

```sql
SELECT
  s.project_key,
  s.project_status,
  s.git_state,
  s.current_branch,
  s.current_session_id,
  s.current_job_id,
  s.last_sync_at,
  s.last_message,
  s.last_error,
  a.status AS worker_status,
  a.last_seen_at AS worker_last_seen_at,
  se.title AS session_title,
  se.status AS session_status
FROM hermes_project_state s
LEFT JOIN hermes_agent_state a ON a.project_key = s.project_key
LEFT JOIN hermes_sessions se ON se.id = s.current_session_id
WHERE s.project_key = 'HermesOS'
LIMIT 1;
```

MySQL 最近事件：

```sql
SELECT title, details, created_at
FROM hermes_project_events
WHERE project_key = 'HermesOS'
ORDER BY created_at DESC
LIMIT 5;
```

Code：

```javascript
const s = $('Query Project Status').first().json;
const events = $('Query Recent Events').all().map(i => i.json);
const lines = [];

lines.push('HermesOS 项目状态');
lines.push('');
lines.push(`项目状态：${s.project_status}`);
lines.push(`Git 状态：${s.git_state}`);
lines.push(`当前分支：${s.current_branch ?? '未知'}`);
lines.push(`Worker：${s.worker_status ?? 'UNKNOWN'}`);
lines.push(`最后同步：${s.last_sync_at ?? '暂无'}`);

if (s.current_session_id) {
  lines.push('');
  lines.push(`当前 Session：#${s.current_session_id} ${s.session_title ?? ''}`);
  lines.push(`Session 状态：${s.session_status ?? 'UNKNOWN'}`);
}

if (s.last_message) {
  lines.push('');
  lines.push(`备注：${s.last_message}`);
}

if (s.last_error) {
  lines.push('');
  lines.push(`错误：${s.last_error}`);
}

if (events.length) {
  lines.push('');
  lines.push('最近事件：');
  for (const e of events) lines.push(`- ${e.created_at} ${e.title}`);
}

return [{ json: { reply_text: lines.join('\n') } }];
```

### 10.3 project.sync

创建 Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  NULL,
  'SYNC',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }},
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }}
  )
);
```

更新状态：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  current_job_id = {{ $('Create Sync Job').first().json.insertId }},
  last_message = '已创建 SYNC Job，等待本地 Worker 拉取。'
WHERE project_key = 'HermesOS';
```

回复：

```javascript
return [{ json: { reply_text: '已创建同步任务，本地 Worker 会检查真实 Git 状态并回报。' } }];
```

### 10.4 dev.run

创建 Session：

```sql
INSERT INTO hermes_sessions (
  project_key,
  title,
  user_goal,
  status,
  created_by,
  feishu_chat_id,
  feishu_message_id,
  summary
) VALUES (
  'HermesOS',
  LEFT({{ JSON.stringify($('Parse Action JSON').first().json.action.summary) }}, 255),
  {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }},
  'OPEN',
  {{ JSON.stringify($('Feishu Message Parser').first().json.user_id) }},
  {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
  {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }},
  {{ JSON.stringify($('Parse Action JSON').first().json.action.summary) }}
);
```

设置分支：

```sql
UPDATE hermes_sessions
SET branch_name = CONCAT('hermes/dev-', id)
WHERE id = {{ $('Create Session').first().json.insertId }};
```

创建 Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Create Session').first().json.insertId }},
  'DEV_RUN',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'instruction', {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }},
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
  )
);
```

更新 project state：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  current_session_id = {{ $('Create Session').first().json.insertId }},
  current_job_id = {{ $('Create Dev Run Job').first().json.insertId }},
  last_message = '已创建开发 Session 和 DEV_RUN Job。'
WHERE project_key = 'HermesOS';
```

写事件：

```sql
INSERT INTO hermes_project_events (
  project_key,
  session_id,
  job_id,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  {{ $('Create Session').first().json.insertId }},
  {{ $('Create Dev Run Job').first().json.insertId }},
  'SESSION_CREATED',
  'user',
  '用户创建开发 Session',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }}
);
```

回复：

```javascript
const sessionId = $('Create Session').first().json.insertId;
return [{ json: { reply_text: `已创建 Session #${sessionId}，本地 Worker 会开始规划、执行和 Review。` } }];
```

### 10.5 dev.fix

使用当前 Session，创建 `DEV_FIX` Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Hermes Brain').first().json.brain.current_session_id }},
  'DEV_FIX',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'instruction', {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }},
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
  )
);
```

更新 Session：

```sql
UPDATE hermes_sessions
SET status = 'FIXING'
WHERE id = {{ $('Hermes Brain').first().json.brain.current_session_id }};
```

回复：

```javascript
return [{ json: { reply_text: '已创建继续修改 Job，本地 Worker 会在当前 Session 分支上继续修。' } }];
```

### 10.6 dev.review

创建 `DEV_REVIEW` Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Hermes Brain').first().json.brain.current_session_id }},
  'DEV_REVIEW',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
  )
);
```

### 10.7 dev.approve

创建 `APPROVE` Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Hermes Brain').first().json.brain.current_session_id }},
  'APPROVE',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
  )
);
```

回复：

```javascript
return [{ json: { reply_text: '收到确认提交。本地 Worker 会检查分支和 Review 状态，通过后 commit / push。' } }];
```

### 10.8 dev.rollback

创建 `ROLLBACK` Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  session_id,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  {{ $('Hermes Brain').first().json.brain.current_session_id }},
  'ROLLBACK',
  'PENDING',
  JSON_OBJECT(
    'source', 'feishu',
    'feishu_chat_id', {{ JSON.stringify($('Feishu Message Parser').first().json.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Feishu Message Parser').first().json.message_id) }}
  )
);
```

### 10.9 worker.online / worker.offline

上线：

```sql
UPDATE hermes_agent_state
SET
  enabled = 1,
  status = IF(last_seen_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE), 'IDLE', 'OFFLINE'),
  last_message = '用户允许本地 Worker 接任务。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

下线：

```sql
UPDATE hermes_agent_state
SET
  enabled = 0,
  status = 'PAUSED',
  last_message = '用户暂停本地 Worker 接任务。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

---

## 11. n8n Workflow 2：Hermes Worker - Heartbeat

### 11.1 Webhook

```text
Method: POST
Path: hermes/worker/heartbeat
Response: JSON
```

### 11.2 校验 Token

Code：

```javascript
const auth = $json.headers?.authorization ?? $json.headers?.Authorization ?? '';
const expected = 'Bearer 换成你的_HERMES_WORKER_TOKEN';

if (auth !== expected) {
  return [{ json: { ok: false, statusCode: 401, error: 'Unauthorized' } }];
}

return [{ json: { ok: true, body: $json.body ?? $json } }];
```

如果 `ok=false`，Respond 401。

### 11.3 更新 agent_state

MySQL：

```sql
UPDATE hermes_agent_state
SET
  status = {{ JSON.stringify($json.body.status || 'IDLE') }},
  current_job_id = {{ $json.body.current_job_id || 'NULL' }},
  last_seen_at = NOW(),
  last_message = {{ JSON.stringify($json.body.message || 'Worker heartbeat') }},
  last_error = NULL
WHERE worker_key = {{ JSON.stringify($json.body.worker_key || 'HermesOS-Windows-Local') }};
```

### 11.4 返回

```json
{
  "ok": true,
  "server_time": "{{ new Date().toISOString() }}"
}
```

---

## 12. n8n Workflow 3：Hermes Worker - Poll

### 12.1 Webhook

```text
Method: POST
Path: hermes/worker/poll
```

Worker Body：

```json
{
  "worker_key": "HermesOS-Windows-Local",
  "project_key": "HermesOS"
}
```

### 12.2 查询 Worker 是否可接任务

```sql
SELECT *
FROM hermes_agent_state
WHERE worker_key = {{ JSON.stringify($json.body.worker_key) }}
  AND project_key = {{ JSON.stringify($json.body.project_key) }}
LIMIT 1;
```

如果：

```text
enabled = 0
```

返回：

```json
{
  "ok": true,
  "job": null,
  "message": "worker paused"
}
```

### 12.3 查询下一个 Job

```sql
SELECT
  j.*,
  s.title AS session_title,
  s.user_goal,
  s.branch_name,
  s.status AS session_status,
  p.local_path,
  p.default_branch,
  p.dev_branch_prefix
FROM hermes_local_jobs j
LEFT JOIN hermes_sessions s ON s.id = j.session_id
LEFT JOIN hermes_projects p ON p.project_key = j.project_key
WHERE j.project_key = {{ JSON.stringify($json.body.project_key) }}
  AND j.status = 'PENDING'
  AND (j.run_after IS NULL OR j.run_after <= NOW())
ORDER BY j.priority ASC, j.created_at ASC
LIMIT 1;
```

如果没有 Job，返回：

```json
{
  "ok": true,
  "job": null
}
```

### 12.4 Claim Job

```sql
UPDATE hermes_local_jobs
SET
  status = 'RUNNING',
  worker_key = {{ JSON.stringify($json.body.worker_key) }},
  lease_token = UUID(),
  lease_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE),
  attempt_count = attempt_count + 1,
  started_at = COALESCE(started_at, NOW())
WHERE id = {{ $('Query Next Job').first().json.id }}
  AND status = 'PENDING';
```

### 12.5 返回 Job 给 Worker

Code：

```javascript
const job = $('Query Next Job').first()?.json;

if (!job) {
  return [{ json: { ok: true, job: null } }];
}

let input = {};
try {
  input = typeof job.input_json === 'string' ? JSON.parse(job.input_json) : (job.input_json ?? {});
} catch (error) {
  input = {};
}

return [
  {
    json: {
      ok: true,
      job: {
        id: job.id,
        project_key: job.project_key,
        session_id: job.session_id,
        job_type: job.job_type,
        input,
        session: {
          title: job.session_title,
          user_goal: job.user_goal,
          branch_name: job.branch_name,
          status: job.session_status,
        },
        project: {
          local_path: job.local_path,
          default_branch: job.default_branch,
          dev_branch_prefix: job.dev_branch_prefix,
        },
      },
    },
  },
];
```

---

## 13. n8n Workflow 4：Hermes Worker - Report

### 13.1 Webhook

```text
Method: POST
Path: hermes/worker/report
```

Worker Body：

```json
{
  "worker_key": "HermesOS-Windows-Local",
  "project_key": "HermesOS",
  "job_id": 1,
  "session_id": 1,
  "job_type": "DEV_RUN",
  "status": "SUCCESS",
  "session_status": "REVIEW_PENDING",
  "project_status": "REVIEW_PENDING",
  "git_state": "DIRTY",
  "branch": "hermes/dev-1",
  "summary": "完成初步修改",
  "risk_level": "MEDIUM",
  "review_result": "PASS",
  "changed_files": ["src/App.tsx"],
  "diff_stat": "1 file changed",
  "artifacts": [
    {
      "artifact_type": "PLAN",
      "title": "Codex Plan",
      "content": "..."
    }
  ],
  "error_message": null
}
```

### 13.2 更新 Job

```sql
UPDATE hermes_local_jobs
SET
  status = {{ JSON.stringify($json.body.status) }},
  output_json = CAST({{ JSON.stringify(JSON.stringify($json.body)) }} AS JSON),
  error_message = {{ JSON.stringify($json.body.error_message || '') }},
  finished_at = NOW(),
  lease_until = NULL
WHERE id = {{ $json.body.job_id }};
```

### 13.3 更新 Session

```sql
UPDATE hermes_sessions
SET
  status = {{ JSON.stringify($json.body.session_status || 'OPEN') }},
  risk_level = {{ JSON.stringify($json.body.risk_level || 'UNKNOWN') }},
  review_result = {{ JSON.stringify($json.body.review_result || 'UNKNOWN') }},
  branch_name = {{ JSON.stringify($json.body.branch || '') }},
  summary = {{ JSON.stringify($json.body.summary || '') }},
  last_error = {{ JSON.stringify($json.body.error_message || '') }}
WHERE id = {{ $json.body.session_id || 0 }};
```

### 13.4 更新 Project State

```sql
UPDATE hermes_project_state
SET
  project_status = {{ JSON.stringify($json.body.project_status || 'IDLE') }},
  git_state = {{ JSON.stringify($json.body.git_state || 'UNKNOWN') }},
  current_branch = {{ JSON.stringify($json.body.branch || '') }},
  current_session_id = {{ $json.body.session_id || 'NULL' }},
  current_job_id = NULL,
  last_message = {{ JSON.stringify($json.body.summary || '') }},
  last_error = {{ JSON.stringify($json.body.error_message || '') }},
  last_sync_at = CASE
    WHEN {{ JSON.stringify($json.body.job_type) }} = 'SYNC' THEN NOW()
    ELSE last_sync_at
  END
WHERE project_key = {{ JSON.stringify($json.body.project_key) }};
```

### 13.5 写 Artifact

n8n 对数组循环不方便，建议用 Code 节点拆 items。

Code：

```javascript
const body = $json.body;
const artifacts = Array.isArray(body.artifacts) ? body.artifacts : [];

return artifacts.map(artifact => ({
  json: {
    project_key: body.project_key,
    session_id: body.session_id,
    job_id: body.job_id,
    artifact_type: artifact.artifact_type || 'OTHER',
    title: artifact.title || artifact.artifact_type || 'Artifact',
    content: artifact.content || '',
    content_format: artifact.content_format || 'markdown',
  },
}));
```

MySQL：

```sql
INSERT INTO hermes_session_artifacts (
  project_key,
  session_id,
  job_id,
  artifact_type,
  title,
  content,
  content_format
) VALUES (
  {{ JSON.stringify($json.project_key) }},
  {{ $json.session_id || 'NULL' }},
  {{ $json.job_id || 'NULL' }},
  {{ JSON.stringify($json.artifact_type) }},
  {{ JSON.stringify($json.title) }},
  {{ JSON.stringify($json.content) }},
  {{ JSON.stringify($json.content_format) }}
);
```

### 13.6 写 Event

```sql
INSERT INTO hermes_project_events (
  project_key,
  session_id,
  job_id,
  event_type,
  actor,
  title,
  details,
  payload_json
) VALUES (
  {{ JSON.stringify($json.body.project_key) }},
  {{ $json.body.session_id || 'NULL' }},
  {{ $json.body.job_id || 'NULL' }},
  CONCAT('JOB_', {{ JSON.stringify($json.body.job_type) }}, '_', {{ JSON.stringify($json.body.status) }}),
  'worker',
  {{ JSON.stringify($json.body.summary || 'Worker report') }},
  {{ JSON.stringify(($json.body.diff_stat || '') + '\n' + (($json.body.changed_files || []).join('\n'))) }},
  CAST({{ JSON.stringify(JSON.stringify($json.body)) }} AS JSON)
);
```

### 13.7 生成飞书汇报

Code：

```javascript
const b = $json.body;
const lines = [];

if (b.status === 'SUCCESS') {
  lines.push(`✅ Hermes Job 完成：${b.job_type}`);
} else {
  lines.push(`❌ Hermes Job 失败：${b.job_type}`);
}

if (b.session_id) lines.push(`Session：#${b.session_id}`);
if (b.session_status) lines.push(`Session 状态：${b.session_status}`);
if (b.project_status) lines.push(`项目状态：${b.project_status}`);
if (b.git_state) lines.push(`Git 状态：${b.git_state}`);
if (b.branch) lines.push(`分支：${b.branch}`);
if (b.review_result) lines.push(`Review：${b.review_result}`);
if (b.risk_level) lines.push(`风险：${b.risk_level}`);

if (b.summary) {
  lines.push('');
  lines.push('摘要：');
  lines.push(b.summary);
}

if (Array.isArray(b.changed_files) && b.changed_files.length) {
  lines.push('');
  lines.push('修改文件：');
  for (const file of b.changed_files.slice(0, 20)) lines.push(`- ${file}`);
}

if (b.diff_stat) {
  lines.push('');
  lines.push('Diff：');
  lines.push(String(b.diff_stat).slice(0, 1200));
}

if (b.error_message) {
  lines.push('');
  lines.push('错误：');
  lines.push(b.error_message);
}

lines.push('');
lines.push('你可以回复：');
lines.push('没问题继续吧');
lines.push('这里再改一下');
lines.push('确认提交');
lines.push('确认回滚');

return [{ json: { reply_text: lines.join('\n'), body: b } }];
```

然后调用 `Hermes Reply - Feishu Sender`。

---

## 14. n8n Workflow 5：Hermes Reply - Feishu Sender

建议做成子工作流，被其他 workflow 调用。

输入：

```json
{
  "reply_text": "xxx",
  "feishu_message_id": "xxx",
  "feishu_chat_id": "xxx"
}
```

### 14.1 获取 tenant_access_token

```text
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
```

Body：

```json
{
  "app_id": "你的 FEISHU_APP_ID",
  "app_secret": "你的 FEISHU_APP_SECRET"
}
```

### 14.2 优先回复原消息

如果有 `feishu_message_id`：

```text
POST https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply
```

Body：

```json
{
  "msg_type": "text",
  "content": "{\"text\":\"{{ $json.reply_text }}\"}"
}
```

如果只有 `chat_id`：

```text
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id
```

Body：

```json
{
  "receive_id": "{{ $json.feishu_chat_id }}",
  "msg_type": "text",
  "content": "{\"text\":\"{{ $json.reply_text }}\"}"
}
```

---

## 15. 本地 Worker 开发

在本地项目目录创建：

```text
C:\Users\AL\Documents\HermesOS\worker
```

### 15.1 package.json

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
    "dotenv": "^16.4.5"
  }
}
```

### 15.2 .env.example

```text
PROJECT_KEY=HermesOS
WORKER_KEY=HermesOS-Windows-Local
PROJECT_DIR=C:\Users\AL\Documents\HermesOS

N8N_BASE_URL=https://你的n8n域名
HERMES_WORKER_TOKEN=和n8n里一致的长随机token

POLL_INTERVAL_MS=5000
HEARTBEAT_INTERVAL_MS=10000

CODEX_COMMAND=codex
CLAUDE_COMMAND=claude
DEFAULT_BRANCH=main
DEV_BRANCH_PREFIX=hermes/dev-
```

复制为 `.env` 后填写真实值。

### 15.3 目录结构

```text
worker/
  package.json
  .env
  src/
    index.js
    config.js
    api.js
    shell.js
    git.js
    prompts.js
    executors.js
```

### 15.4 src/config.js

```javascript
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  projectKey: process.env.PROJECT_KEY || 'HermesOS',
  workerKey: process.env.WORKER_KEY || 'HermesOS-Windows-Local',
  projectDir: process.env.PROJECT_DIR,
  n8nBaseUrl: process.env.N8N_BASE_URL,
  token: process.env.HERMES_WORKER_TOKEN,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || 10000),
  codexCommand: process.env.CODEX_COMMAND || 'codex',
  claudeCommand: process.env.CLAUDE_COMMAND || 'claude',
  defaultBranch: process.env.DEFAULT_BRANCH || 'main',
  devBranchPrefix: process.env.DEV_BRANCH_PREFIX || 'hermes/dev-',
};
```

### 15.5 src/api.js

```javascript
import { config } from './config.js';

async function post(path, body) {
  const response = await fetch(`${config.n8nBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

export function heartbeat(status, currentJobId = null, message = '') {
  return post('/webhook/hermes/worker/heartbeat', {
    worker_key: config.workerKey,
    project_key: config.projectKey,
    status,
    current_job_id: currentJobId,
    message,
  });
}

export function pollJob() {
  return post('/webhook/hermes/worker/poll', {
    worker_key: config.workerKey,
    project_key: config.projectKey,
  });
}

export function reportJob(payload) {
  return post('/webhook/hermes/worker/report', {
    worker_key: config.workerKey,
    project_key: config.projectKey,
    ...payload,
  });
}
```

### 15.6 src/shell.js

```javascript
import { spawn } from 'node:child_process';

export function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env, ...(options.env || {}) },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function mustRun(command, args = [], options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}
```

### 15.7 src/git.js

```javascript
import { config } from './config.js';
import { mustRun, run } from './shell.js';

export async function git(args) {
  return mustRun('git', [args], { cwd: config.projectDir });
}

export async function currentBranch() {
  const result = await git('branch --show-current');
  return result.stdout.trim();
}

export async function statusShort() {
  const result = await git('status --short');
  return result.stdout.trim();
}

export async function diffStat() {
  const result = await run('git', ['diff --stat'], { cwd: config.projectDir });
  return result.stdout.trim();
}

export async function changedFiles() {
  const result = await run('git', ['diff --name-only'], { cwd: config.projectDir });
  return result.stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

export async function ensureDevBranch(sessionId) {
  const branch = `${config.devBranchPrefix}${sessionId}`;
  await git(`fetch origin`);

  const localCheck = await run('git', [`show-ref --verify --quiet refs/heads/${branch}`], {
    cwd: config.projectDir,
  });

  if (localCheck.code === 0) {
    await git(`checkout ${branch}`);
    return branch;
  }

  await git(`checkout ${config.defaultBranch}`);
  await git(`pull origin ${config.defaultBranch}`);
  await git(`checkout -b ${branch}`);
  return branch;
}

export function assertDevBranch(branch) {
  if (!branch.startsWith(config.devBranchPrefix)) {
    throw new Error(`Refuse dangerous git operation on non-dev branch: ${branch}`);
  }
}
```

### 15.8 src/prompts.js

```javascript
export function codexPlanPrompt(job) {
  return [
    '你是 HermesOS 的 Codex Planner。',
    '',
    '这一步只规划，不修改文件。',
    '',
    `用户目标：${job.session?.user_goal || job.input?.instruction || ''}`,
    '',
    '请输出：',
    '1. 任务理解',
    '2. 需要修改的文件',
    '3. 实施步骤',
    '4. 风险点',
    '5. 给 Claude CLI 的执行 Prompt',
    '',
    '不要提交 git，不要 push，不要做无关重构。',
  ].join('\n');
}

export function claudeExecutePrompt(job, plan) {
  return [
    '你是 HermesOS 的 Claude Executor。',
    '',
    '只允许完成用户明确要求的修改。',
    '不要提交 git，不要 push。',
    '不要做顺手优化。',
    '不要升级架构。',
    '',
    `用户目标：${job.session?.user_goal || job.input?.instruction || ''}`,
    '',
    'Codex Plan：',
    plan,
    '',
    '完成后输出：',
    '1. 修改了哪些文件',
    '2. 实现了什么',
    '3. 有什么风险',
  ].join('\n');
}

export function codexReviewPrompt(job) {
  return [
    '你是 HermesOS 的 Codex Reviewer。',
    '',
    '请审查当前 git diff。',
    '只审查，不修改文件。',
    '',
    '输出格式必须包含：',
    'REVIEW_RESULT: PASS 或 FAIL',
    'RISK: LOW / MEDIUM / HIGH',
    '',
    '然后列出：',
    '1. 主要发现',
    '2. 风险',
    '3. 是否需要 Claude 修复',
  ].join('\n');
}
```

### 15.9 src/executors.js

```javascript
import { config } from './config.js';
import { mustRun, run } from './shell.js';
import {
  currentBranch,
  statusShort,
  diffStat,
  changedFiles,
  ensureDevBranch,
  assertDevBranch,
  git,
} from './git.js';
import { codexPlanPrompt, claudeExecutePrompt, codexReviewPrompt } from './prompts.js';

async function runCodex(prompt) {
  const result = await mustRun(config.codexCommand, [
    `exec --cd "${config.projectDir}" "${prompt.replace(/"/g, '\\"')}"`
  ], { cwd: config.projectDir });
  return result.stdout.trim();
}

async function runClaude(prompt) {
  const result = await mustRun(config.claudeCommand, [
    `-p "${prompt.replace(/"/g, '\\"')}"`
  ], { cwd: config.projectDir });
  return result.stdout.trim();
}

function parseReview(reviewText) {
  const pass = /REVIEW_RESULT:\s*PASS/i.test(reviewText);
  const high = /RISK:\s*HIGH/i.test(reviewText);
  const medium = /RISK:\s*MEDIUM/i.test(reviewText);
  return {
    review_result: pass ? 'PASS' : 'FAIL',
    risk_level: high ? 'HIGH' : medium ? 'MEDIUM' : 'LOW',
  };
}

export async function executeSync(job) {
  const branch = await currentBranch();
  const short = await statusShort();
  return {
    session_status: null,
    project_status: short ? 'DIRTY' : 'IDLE',
    git_state: short ? 'DIRTY' : 'CLEAN',
    branch,
    summary: short ? '本地 Git 存在未提交改动。' : '本地 Git 工作区干净。',
    changed_files: [],
    diff_stat: short,
    artifacts: [],
  };
}

export async function executeDevRun(job) {
  const branch = await ensureDevBranch(job.session_id);

  const before = await statusShort();
  if (before) {
    throw new Error(`Git is dirty before dev run:\n${before}`);
  }

  const planPrompt = codexPlanPrompt(job);
  const plan = await runCodex(planPrompt);

  const claudePrompt = claudeExecutePrompt(job, plan);
  const claudeResult = await runClaude(claudePrompt);

  const reviewPrompt = codexReviewPrompt(job);
  const review = await runCodex(reviewPrompt);
  const parsed = parseReview(review);

  const files = await changedFiles();
  const stat = await diffStat();

  return {
    session_status: 'REVIEW_PENDING',
    project_status: 'REVIEW_PENDING',
    git_state: files.length ? 'DIRTY' : 'CLEAN',
    branch,
    summary: files.length
      ? 'Codex Plan、Claude Execute、Codex Review 已完成，等待用户审核。'
      : '执行完成，但没有产生文件改动。',
    changed_files: files,
    diff_stat: stat,
    review_result: parsed.review_result,
    risk_level: parsed.risk_level,
    artifacts: [
      { artifact_type: 'PLAN', title: 'Codex Plan', content: plan },
      { artifact_type: 'CLAUDE_PROMPT', title: 'Claude Prompt', content: claudePrompt },
      { artifact_type: 'CLAUDE_RESULT', title: 'Claude Result', content: claudeResult },
      { artifact_type: 'REVIEW_REPORT', title: 'Codex Review', content: review },
    ],
  };
}

export async function executeDevFix(job) {
  return executeDevRun(job);
}

export async function executeReview(job) {
  const branch = await currentBranch();
  const review = await runCodex(codexReviewPrompt(job));
  const parsed = parseReview(review);
  const files = await changedFiles();
  const stat = await diffStat();

  return {
    session_status: 'REVIEW_PENDING',
    project_status: 'REVIEW_PENDING',
    git_state: files.length ? 'DIRTY' : 'CLEAN',
    branch,
    summary: 'Codex Review 已完成。',
    changed_files: files,
    diff_stat: stat,
    review_result: parsed.review_result,
    risk_level: parsed.risk_level,
    artifacts: [
      { artifact_type: 'REVIEW_REPORT', title: 'Codex Review', content: review },
    ],
  };
}

export async function executeApprove(job) {
  const branch = await currentBranch();
  assertDevBranch(branch);

  const short = await statusShort();
  if (!short) {
    return {
      session_status: 'DONE',
      project_status: 'IDLE',
      git_state: 'CLEAN',
      branch,
      summary: '没有可提交改动。',
      changed_files: [],
      diff_stat: '',
      artifacts: [],
    };
  }

  await git('add -A');
  const title = job.session?.title || `Hermes session ${job.session_id}`;
  await git(`commit -m "Hermes session ${job.session_id}: ${title.replace(/"/g, '\\"')}"`);
  await git(`push origin ${branch}`);
  const hash = (await git('rev-parse HEAD')).stdout.trim();

  return {
    session_status: 'DONE',
    project_status: 'IDLE',
    git_state: 'CLEAN',
    branch,
    commit_hash: hash,
    summary: `已提交并推送：${hash}`,
    changed_files: [],
    diff_stat: '',
    artifacts: [],
  };
}

export async function executeRollback(job) {
  const branch = await currentBranch();
  assertDevBranch(branch);
  await git('reset --hard');
  await git('clean -fd');

  return {
    session_status: 'ROLLED_BACK',
    project_status: 'IDLE',
    git_state: 'CLEAN',
    branch,
    summary: '已回滚当前 Session 分支的本地改动。',
    changed_files: [],
    diff_stat: '',
    artifacts: [],
  };
}

export async function executeJob(job) {
  if (job.job_type === 'SYNC') return executeSync(job);
  if (job.job_type === 'DEV_RUN') return executeDevRun(job);
  if (job.job_type === 'DEV_FIX') return executeDevFix(job);
  if (job.job_type === 'DEV_REVIEW') return executeReview(job);
  if (job.job_type === 'APPROVE') return executeApprove(job);
  if (job.job_type === 'ROLLBACK') return executeRollback(job);
  throw new Error(`Unsupported job_type: ${job.job_type}`);
}
```

### 15.10 src/index.js

```javascript
import { config } from './config.js';
import { heartbeat, pollJob, reportJob } from './api.js';
import { executeJob } from './executors.js';
import { mustRun } from './shell.js';

let currentJobId = null;
let busy = false;

async function selfCheck() {
  if (!config.projectDir) throw new Error('PROJECT_DIR is required');
  if (!config.n8nBaseUrl) throw new Error('N8N_BASE_URL is required');
  if (!config.token) throw new Error('HERMES_WORKER_TOKEN is required');

  await mustRun('git', ['--version'], { cwd: config.projectDir });
  await mustRun(config.codexCommand, ['--help'], { cwd: config.projectDir });
  await mustRun(config.claudeCommand, ['--help'], { cwd: config.projectDir });
}

async function sendHeartbeat() {
  try {
    await heartbeat(busy ? 'BUSY' : 'IDLE', currentJobId, busy ? 'Worker busy' : 'Worker idle');
  } catch (error) {
    console.error('heartbeat failed:', error.message);
  }
}

async function tick() {
  if (busy) return;

  try {
    const response = await pollJob();
    if (!response.job) return;

    const job = response.job;
    currentJobId = job.id;
    busy = true;
    await sendHeartbeat();

    try {
      const result = await executeJob(job);
      await reportJob({
        job_id: job.id,
        session_id: job.session_id,
        job_type: job.job_type,
        status: 'SUCCESS',
        ...result,
      });
    } catch (error) {
      await reportJob({
        job_id: job.id,
        session_id: job.session_id,
        job_type: job.job_type,
        status: 'FAILED',
        session_status: 'FAILED',
        project_status: 'ERROR',
        git_state: 'UNKNOWN',
        summary: 'Worker 执行失败。',
        error_message: error.message,
        artifacts: [
          { artifact_type: 'WORKER_LOG', title: 'Worker Error', content: error.stack || error.message },
        ],
      });
    } finally {
      currentJobId = null;
      busy = false;
      await sendHeartbeat();
    }
  } catch (error) {
    console.error('poll failed:', error.message);
  }
}

async function main() {
  await selfCheck();
  await heartbeat('IDLE', null, 'Worker started');

  setInterval(sendHeartbeat, config.heartbeatIntervalMs);
  setInterval(tick, config.pollIntervalMs);

  console.log(`Hermes Worker started for ${config.projectKey}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
```

### 15.11 安装和启动

```powershell
cd C:\Users\AL\Documents\HermesOS\worker
npm install
copy .env.example .env
notepad .env
npm run start
```

---

## 16. 本地 Worker 执行流程

### 16.1 SYNC

```text
git branch --show-current
git status --short
返回 CLEAN / DIRTY
```

### 16.2 DEV_RUN

```text
切到 hermes/dev-{session_id}
确认 git clean
Codex Plan
Claude Execute
Codex Review
收集 diff
report REVIEW_PENDING
```

### 16.3 DEV_FIX

```text
继续在当前 Session 分支
Codex 根据用户补充意见重新规划
Claude 修改
Codex Review
report REVIEW_PENDING
```

### 16.4 DEV_REVIEW

```text
Codex 只 review 当前 diff
不改代码
```

### 16.5 APPROVE

```text
确认 hermes/dev-* 分支
git add -A
git commit
git push
Session DONE
Project IDLE / CLEAN
```

### 16.6 ROLLBACK

```text
确认 hermes/dev-* 分支
git reset --hard
git clean -fd
Session ROLLED_BACK
Project IDLE / CLEAN
```

---

## 17. 安全规则

必须实现：

```text
1. Worker 不在线，Job 可以入队，但不能执行。
2. Git DIRTY 时不允许新 dev.run。
3. dev.run 必须创建 hermes/dev-{session_id} 分支。
4. Claude 改完必须 Codex Review。
5. Review 不通过不能自动提交。
6. 自动修复最多 3 轮，超过 BLOCKED。
7. commit / push 必须等用户明确“确认提交”。
8. rollback 必须等用户明确“确认回滚”。
9. rollback 只能在 hermes/dev-* 分支执行。
10. main 分支禁止自动 commit / reset / clean。
11. 每次执行都记录 changed_files、diff_stat、risk、summary。
12. 所有 Session / Job / Artifact / Event 都写入 MySQL。
```

---

## 18. Level 1 开发步骤

### Step 1：建数据库

执行第 7 节所有 SQL。

### Step 2：配置飞书机器人

飞书后台：

```text
创建应用
开启机器人
开通接收消息权限
开通发送消息权限
事件订阅 URL 填 n8n webhook
```

URL：

```text
https://你的n8n域名/webhook/hermes/feishu
```

### Step 3：搭 Hermes Main - Feishu Router

先搭：

```text
Webhook
Message Parser
Challenge Response
Respond OK
Load Project Context
Load Current Session
Load Recent Messages
Build Action Input
DeepSeek Action Translator
Parse Action JSON
Hermes Brain
Dispatch Action
project.status
help
unknown
```

测试：

```text
飞书：项目状态
```

### Step 4：搭 Worker Heartbeat

测试：

```powershell
curl -X POST https://你的n8n域名/webhook/hermes/worker/heartbeat `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"worker_key\":\"HermesOS-Windows-Local\",\"project_key\":\"HermesOS\",\"status\":\"IDLE\"}"
```

MySQL 应看到：

```text
agent_state.last_seen_at 更新
status = IDLE
```

### Step 5：搭 Worker Poll

手动插入测试 Job：

```sql
INSERT INTO hermes_local_jobs (
  project_key,
  job_type,
  status,
  input_json
) VALUES (
  'HermesOS',
  'SYNC',
  'PENDING',
  JSON_OBJECT('test', true)
);
```

测试 poll：

```powershell
curl -X POST https://你的n8n域名/webhook/hermes/worker/poll `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"worker_key\":\"HermesOS-Windows-Local\",\"project_key\":\"HermesOS\"}"
```

应该返回 job。

### Step 6：搭 Worker Report

用 curl 模拟 report，确认 MySQL 更新。

### Step 7：写本地 Worker

按第 15 节创建代码。

### Step 8：测试 project.sync

飞书：

```text
同步一下
```

预期：

```text
n8n 创建 SYNC Job
Worker poll 到 Job
Worker 执行 git status
Worker report
n8n 更新 MySQL
飞书收到汇报
```

Level 1 完成。

---

## 19. Level 2 开发步骤

### Step 1：实现 dev.run

Main Router 里接 `dev.run`：

```text
创建 Session
创建 DEV_RUN Job
更新 project_state
飞书回复
```

### Step 2：Worker 实现 DEV_RUN

本地 Worker：

```text
ensureDevBranch
Codex Plan
Claude Execute
Codex Review
report REVIEW_PENDING
```

### Step 3：实现 dev.fix

Main Router：

```text
找到 current_session
创建 DEV_FIX Job
```

Worker：

```text
同 DEV_RUN，但使用用户补充 instruction
```

### Step 4：实现 dev.review

Main Router：

```text
创建 DEV_REVIEW Job
```

Worker：

```text
Codex Review 当前 diff
```

### Step 5：实现 dev.approve

DeepSeek 规则：

```text
“提交吧 / 没问题继续吧” -> need_confirm=true
“确认提交” -> need_confirm=false
```

Main Router：

```text
need_confirm=true -> 提示用户确认提交
need_confirm=false -> 创建 APPROVE Job
```

Worker：

```text
assert hermes/dev-*
git add -A
git commit
git push
```

### Step 6：实现 dev.rollback

规则同 approve。

Worker：

```text
assert hermes/dev-*
git reset --hard
git clean -fd
```

Level 2 完成。

---

## 20. Level 3 开发步骤

### Step 1：Session 记忆

每次用户消息都写：

```text
hermes_session_messages
```

每次 AI action 都写：

```text
action_json
```

DeepSeek 输入最近 8 条消息。  
这样它能理解：

```text
这个
这里
刚才那个
继续改
```

### Step 2：自动修复最多 3 轮

如果 Codex Review FAIL：

```text
fix_count < max_fix_count
  -> 自动继续 DEV_FIX
fix_count >= max_fix_count
  -> Session BLOCKED
  -> 飞书汇报
```

n8n Report workflow 里根据 review_result 判断是否创建下一轮 DEV_FIX Job。

### Step 3：日报

Workflow：Hermes Daily Report  
Schedule：每天 21:30

SQL：

```sql
SELECT *
FROM hermes_project_events
WHERE project_key = 'HermesOS'
  AND created_at >= CURDATE()
ORDER BY created_at ASC;
```

汇报：

```text
今日完成了什么
哪些 Session 还在 REVIEW_PENDING
哪些 Job 失败
最新 commit
明天建议
```

### Step 4：健康检查

Workflow：Hermes Health Monitor  
Schedule：每 10 分钟

检查：

```text
Worker 超过 2 分钟没 heartbeat
Job RUNNING 超过 60 分钟
Session REVIEW_PENDING 超过 24 小时
project_state ERROR
```

### Step 5：多项目支持

DeepSeek Action 增加 project_key 判断。  
数据库所有查询都从固定 `HermesOS` 改成：

```text
{{ $json.action.project_key }}
```

### Step 6：完整审计

所有动作都写：

```text
hermes_project_events
```

包括：

```text
ACTION_TRANSLATED
SESSION_CREATED
JOB_CREATED
WORKER_POLLED
JOB_SUCCESS
JOB_FAILED
SESSION_DONE
SESSION_ROLLED_BACK
```

Level 3 完成。

---

## 21. 最终测试剧本

### 21.1 通信测试

```text
飞书：项目状态
预期：收到项目状态
```

### 21.2 Worker 测试

```text
启动 Worker
MySQL agent_state = IDLE
```

### 21.3 Sync 测试

```text
飞书：同步一下
预期：git_state = CLEAN 或 DIRTY
```

### 21.4 Dev Run 测试

```text
飞书：给项目创建一个 README，写明 HermesOS 是 AI Developer OS
```

预期：

```text
Session 创建
DEV_RUN Job 创建
Worker 执行
Codex Plan artifact
Claude Result artifact
Review Report artifact
Session REVIEW_PENDING
Git DIRTY
```

### 21.5 Fix 测试

```text
飞书：这里写得不够清楚，再高级一点
```

预期：

```text
同一个 Session
DEV_FIX Job
继续修改
```

### 21.6 Review 测试

```text
飞书：review 一下
```

预期：

```text
Codex Review
Review artifact 更新
```

### 21.7 Commit 测试

```text
飞书：确认提交
```

预期：

```text
分支 hermes/dev-{session_id}
commit 成功
push 成功
Session DONE
project_state IDLE / CLEAN
```

### 21.8 Rollback 测试

新建另一个 Session，让它产生改动。

```text
飞书：确认回滚
```

预期：

```text
git status clean
Session ROLLED_BACK
project_state IDLE / CLEAN
```

### 21.9 Session 记忆测试

```text
飞书：刚才那个继续改
```

预期：

```text
DeepSeek target=current_session
n8n 创建 DEV_FIX Job
```

---

## 22. 最终完成标准

全部满足才算项目完成。

```text
[ ] 飞书入口正常
[ ] DeepSeek Action JSON 稳定
[ ] n8n Main Router 正常
[ ] Worker Heartbeat 正常
[ ] Worker Poll 正常
[ ] Worker Report 正常
[ ] MySQL 保存 Session / Job / Event / Artifact
[ ] project.status 正常
[ ] project.sync 正常
[ ] dev.run 正常
[ ] dev.fix 正常
[ ] dev.review 正常
[ ] dev.approve 正常
[ ] dev.rollback 正常
[ ] Codex Plan 正常
[ ] Claude Execute 正常
[ ] Codex Review 正常
[ ] commit / push 正常
[ ] rollback 安全
[ ] Session 能理解“这个 / 刚才那个”
[ ] 日报正常
[ ] 健康检查正常
[ ] Worker 掉线有提示
[ ] 所有危险动作需要确认
[ ] main 分支不会被自动 reset 或 commit
```

---

## 23. 最终实施顺序

按这个顺序做，不要跳。

```text
1. 阿里云 MySQL 建库建表
2. 飞书机器人配置
3. n8n Main Router 基础链路
4. project.status
5. Worker Heartbeat workflow
6. Worker Poll workflow
7. Worker Report workflow
8. 本地 Worker 基础代码
9. project.sync
10. dev.run 创建 Session / Job
11. Worker DEV_RUN
12. Worker DEV_FIX
13. Worker DEV_REVIEW
14. approve 二次确认
15. Worker APPROVE commit/push
16. rollback 二次确认
17. Worker ROLLBACK
18. Session 记忆
19. 自动修复 3 轮
20. 日报
21. 健康检查
22. 多项目支持
23. 最终测试剧本全跑
```

这 23 步完成，就是 HermesOS 最终完整版本。
