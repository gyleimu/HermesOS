# HermesOS 新手手把手完整开发文档

版本：Beginner Complete Guide  
适用部署：n8n 在阿里云 Docker，MySQL 在阿里云，Codex / Claude / 项目代码在本地 Windows  
目标：你照着一步一步点、填、复制，就能从 0 做到最终完整版本

---

## 0. 先说明

这份文档会非常啰嗦。  
它不是架构讨论文档，而是操作手册。

你每一步只需要做三件事：

```text
1. 看这一节要打开哪里。
2. 按照“节点名字 / 节点类型 / 参数”创建。
3. 复制对应代码或 SQL。
```

最终系统是：

```text
飞书
  -> 阿里云 n8n
  -> 阿里云 MySQL
  -> 本地 Hermes Worker 主动 poll n8n
  -> 本地 Worker 调 Codex / Claude / Git
  -> Worker report 回 n8n
  -> n8n 写 MySQL
  -> 飞书汇报
```

最终分工：

```text
DeepSeek：理解人话
n8n：调度
MySQL：记忆
Session：上下文
Job：执行队列
Worker：本地动作
Codex：规划和 Review
Claude：改代码
GitHub：版本保存
```

---

## 1. 你先准备这些信息

先新建一个本地临时文本，名字随便，比如：

```text
HermesOS配置记录.txt
```

把下面内容复制进去，然后逐项填。

```text
N8N_URL=https://你的n8n域名

MYSQL_HOST=你的阿里云MySQL地址
MYSQL_PORT=3306
MYSQL_DATABASE=hermes
MYSQL_USER=你的MySQL用户名
MYSQL_PASSWORD=你的MySQL密码

FEISHU_APP_ID=你的飞书应用 app_id
FEISHU_APP_SECRET=你的飞书应用 app_secret

DEEPSEEK_API_KEY=你的 DeepSeek key

HERMES_WORKER_TOKEN=你自己生成的超长随机字符串

PROJECT_KEY=HermesOS
PROJECT_DIR=C:\Users\AL\Documents\HermesOS
WORKER_KEY=HermesOS-Windows-Local
DEFAULT_BRANCH=main
DEV_BRANCH_PREFIX=hermes/dev-
```

`HERMES_WORKER_TOKEN` 可以随便生成一个长字符串，例如：

```text
hermes-worker-2026-change-this-to-a-long-random-secret
```

以后 n8n 和本地 Worker 都要填同一个 token。

---

## 2. 第一步：在阿里云 MySQL 建数据库

### 2.1 打开 MySQL 客户端

你可以用任意一种：

```text
方式 A：阿里云控制台的数据库管理工具
方式 B：宝塔 / phpMyAdmin
方式 C：Navicat / DBeaver
方式 D：服务器命令行 mysql
```

只要能执行 SQL 就行。

### 2.2 执行建库 SQL

复制执行：

```sql
CREATE DATABASE IF NOT EXISTS hermes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hermes;
```

### 2.3 创建项目表

复制执行：

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

### 2.4 创建项目状态表

复制执行：

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

### 2.5 创建 Session 表

复制执行：

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

### 2.6 创建 Session 消息表

复制执行：

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

### 2.7 创建 Artifact 表

复制执行：

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

### 2.8 创建 Job 队列表

复制执行：

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

### 2.9 创建事件表

复制执行：

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

### 2.10 创建 Worker 状态表

复制执行：

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

### 2.11 创建审批表

复制执行：

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

### 2.12 初始化 HermesOS 项目

复制执行。  
你只需要改 `你的GitHub用户名/HermesOS`，如果暂时没有 GitHub 仓库也可以先填 `local/HermesOS`。

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

### 2.13 初始化项目状态

复制执行：

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

### 2.14 初始化 Worker

复制执行：

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

### 2.15 检查数据库

执行：

```sql
SELECT * FROM hermes_projects;
SELECT * FROM hermes_project_state;
SELECT * FROM hermes_agent_state;
```

你应该看到：

```text
hermes_projects 有 HermesOS
hermes_project_state 有 HermesOS
hermes_agent_state 有 HermesOS-Windows-Local
```

---

## 3. 第二步：配置 n8n 的 MySQL 凭证

### 3.1 打开 n8n

浏览器打开：

```text
https://你的n8n域名
```

### 3.2 创建 MySQL Credential

操作：

```text
左侧菜单 Credentials
点击 New credential
搜索 MySQL
选择 MySQL
```

填写：

```text
Credential Name: Hermes MySQL
Host: 你的阿里云 MySQL 地址
Database: hermes
User: 你的 MySQL 用户名
Password: 你的 MySQL 密码
Port: 3306
SSL: 按你的 MySQL 配置选择，没有就先关闭
```

点击：

```text
Save
Test
```

看到成功再继续。

---

## 4. 第三步：配置飞书机器人

### 4.1 打开飞书开放平台

进入：

```text
https://open.feishu.cn/
```

操作：

```text
进入你的应用
打开“凭证与基础信息”
复制 App ID
复制 App Secret
```

填进你的配置记录：

```text
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
```

### 4.2 开启机器人能力

在飞书应用后台：

```text
左侧菜单：应用能力
找到：机器人
点击开启
```

### 4.3 添加权限

在飞书应用后台：

```text
左侧菜单：权限管理
搜索并添加：
接收消息
发送消息
```

常见权限名可能类似：

```text
im:message
im:message:send_as_bot
im:message.p2p_msg
im:message.group_at_msg
```

不同飞书后台版本名字可能略有不同，看到“接收消息”“发送消息”就加。

### 4.4 先别填事件订阅 URL

等我们把 n8n 的 Webhook 工作流建好，再回来填。

---

## 5. 第四步：建 n8n Workflow 1：Hermes Main - Feishu Router

这个 workflow 负责：

```text
接收飞书消息
解析消息
调用 DeepSeek
判断 action
创建 Session / Job
回复飞书
```

### 5.1 新建 Workflow

在 n8n：

```text
左侧 Workflows
点击 Add workflow
右上角名字改成：Hermes Main - Feishu Router
点击 Save
```

---

### 5.2 节点 1：Feishu Inbound Webhook

操作：

```text
点击画布中间的 +
搜索 Webhook
选择 Webhook
```

填写：

```text
Name: Feishu Inbound Webhook
HTTP Method: POST
Path: hermes/feishu
Authentication: None
Respond: Using Respond to Webhook Node
```

保存。

这个节点的生产 URL 应该类似：

```text
https://你的n8n域名/webhook/hermes/feishu
```

复制这个 URL，等下填到飞书事件订阅。

---

### 5.3 节点 2：Feishu Message Parser

操作：

```text
点击 Webhook 后面的 +
搜索 Code
选择 Code
```

填写：

```text
Name: Feishu Message Parser
Mode: Run Once for All Items
Language: JavaScript
```

代码框粘贴：

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

---

### 5.4 节点 3：Is Feishu Challenge

操作：

```text
点击 Feishu Message Parser 后面的 +
搜索 IF
选择 IF
```

填写：

```text
Name: Is Feishu Challenge
```

条件设置：

```text
Value 1: {{ $json.event_type }}
Operation: equals
Value 2: feishu.challenge
```

这个节点会有两个出口：

```text
true
false
```

---

### 5.5 节点 4：Respond Feishu Challenge

从 `Is Feishu Challenge` 的 true 出口创建节点：

```text
点击 true 旁边的 +
搜索 Respond to Webhook
选择 Respond to Webhook
```

填写：

```text
Name: Respond Feishu Challenge
Respond With: JSON
Response Body:
```

粘贴：

```json
{
  "challenge": "{{ $json.challenge }}"
}
```

---

### 5.6 节点 5：Respond Feishu OK

从 `Is Feishu Challenge` 的 false 出口创建节点：

```text
搜索 Respond to Webhook
选择 Respond to Webhook
```

填写：

```text
Name: Respond Feishu OK
Respond With: JSON
Response Body:
```

粘贴：

```json
{
  "code": 0,
  "msg": "ok"
}
```

原因：

```text
飞书要求 Webhook 快速返回。
后面的 AI / MySQL / Job 可以继续慢慢跑。
```

---

### 5.7 节点 6：Load Project Context

从 `Respond Feishu OK` 后面添加：

```text
搜索 MySQL
选择 MySQL
```

填写：

```text
Name: Load Project Context
Credential: Hermes MySQL
Operation: Execute Query
```

Query 粘贴：

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

---

### 5.8 节点 7：Load Current Session

添加 MySQL 节点：

```text
Name: Load Current Session
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
SELECT *
FROM hermes_sessions
WHERE project_key = 'HermesOS'
  AND status IN ('OPEN','PLANNING','EXECUTING','REVIEWING','FIXING','REVIEW_PENDING','BLOCKED','FAILED')
ORDER BY updated_at DESC
LIMIT 1;
```

---

### 5.9 节点 8：Load Recent Messages

添加 MySQL 节点：

```text
Name: Load Recent Messages
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

---

### 5.10 节点 9：Build Action Input

添加 Code 节点：

```text
Name: Build Action Input
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
const msg = $('Feishu Message Parser').first().json;
const project = $('Load Project Context').first().json;

let currentSession = null;
try {
  currentSession = $('Load Current Session').first().json;
} catch (error) {
  currentSession = null;
}

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

---

### 5.11 节点 10：DeepSeek Action Translator

添加 HTTP Request 节点：

```text
Name: DeepSeek Action Translator
Method: POST
URL: https://api.deepseek.com/chat/completions
Authentication: None
Send Headers: On
Send Body: On
Body Content Type: JSON
```

Headers 添加两行：

```text
Name: Authorization
Value: Bearer 你的_DEEPSEEK_API_KEY

Name: Content-Type
Value: application/json
```

Body 粘贴：

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

注意：

```text
把 Bearer 后面的 key 换成你的 DeepSeek API Key。
```

---

### 5.12 节点 11：Parse Action JSON

添加 Code 节点：

```text
Name: Parse Action JSON
Mode: Run Once for All Items
Language: JavaScript
```

代码：

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

---

### 5.13 节点 12：Insert User Session Message

添加 MySQL 节点：

```text
Name: Insert User Session Message
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
INSERT INTO hermes_session_messages (
  session_id,
  project_key,
  role,
  content,
  action_json,
  feishu_message_id
) VALUES (
  {{ $json.context.current_session?.id || 'NULL' }},
  'HermesOS',
  'USER',
  {{ JSON.stringify($json.text) }},
  CAST({{ JSON.stringify(JSON.stringify($json.action)) }} AS JSON),
  {{ JSON.stringify($json.feishu.message_id) }}
);
```

---

### 5.14 节点 13：Hermes Brain

添加 Code 节点：

```text
Name: Hermes Brain
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
const item = $('Parse Action JSON').first().json;
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
    reason = '本地 Worker 当前不可用。请先启动本地 Worker。';
  }
}

if ((action.action === 'dev.run' || action.action === 'dev.fix') && projectStatus === 'RUNNING') {
  allowed = false;
  reason = '当前已有 Job 正在执行，不能重复派发。';
}

if ((action.action === 'dev.run' || action.action === 'dev.fix') && gitState === 'DIRTY') {
  allowed = false;
  reason = '本地 Git 存在未处理改动，请先 review、确认提交或确认回滚。';
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

---

### 5.15 节点 14：Dispatch Action

添加 Switch 节点：

```text
Name: Dispatch Action
```

设置：

```text
Mode: Rules
Value to check: {{ $json.brain.allowed ? $json.brain.route : 'blocked' }}
```

添加这些 rules：

```text
equals blocked
equals project.status
equals project.sync
equals dev.run
equals dev.fix
equals dev.review
equals dev.approve
equals dev.rollback
equals worker.online
equals worker.offline
equals worker.status
equals help
equals chat.reply
equals unknown
```

接下来每个出口都要接分支。

---

## 6. Main Router 分支：blocked

从 `Dispatch Action` 的 `blocked` 出口添加 Code 节点。

```text
Name: Format Blocked Reply
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
return [
  {
    json: {
      reply_text: $json.brain.reason || '当前状态不允许执行。',
      feishu_message_id: $json.feishu.message_id,
      feishu_chat_id: $json.feishu.chat_id,
    },
  },
];
```

然后接飞书回复节点。  
飞书回复节点怎么建，看第 15 节。

---

## 7. Main Router 分支：project.status

### 7.1 节点：Query Project Status

从 `project.status` 出口添加 MySQL 节点：

```text
Name: Query Project Status
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

### 7.2 节点：Query Recent Events

添加 MySQL 节点：

```text
Name: Query Recent Events
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
SELECT title, details, created_at
FROM hermes_project_events
WHERE project_key = 'HermesOS'
ORDER BY created_at DESC
LIMIT 5;
```

### 7.3 节点：Format Project Status Reply

添加 Code 节点：

```text
Name: Format Project Status Reply
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
const s = $('Query Project Status').first().json;
const events = $('Query Recent Events').all().map(i => i.json);
const feishu = $('Build Action Input').first().json.feishu;

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

return [
  {
    json: {
      reply_text: lines.join('\n'),
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

然后接飞书回复节点。

---

## 8. Main Router 分支：project.sync

### 8.1 节点：Create Sync Job

从 `project.sync` 出口添加 MySQL 节点：

```text
Name: Create Sync Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }},
    'user_message', {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }}
  )
);
```

### 8.2 节点：Set Project Running Sync

添加 MySQL 节点：

```text
Name: Set Project Running Sync
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  current_job_id = {{ $('Create Sync Job').first().json.insertId }},
  last_message = '已创建 SYNC Job，等待本地 Worker 拉取。'
WHERE project_key = 'HermesOS';
```

如果你的 MySQL 节点输出里没有 `insertId`，先运行一次 `Create Sync Job` 看输出字段名，然后把上面的 `insertId` 改成实际字段。

### 8.3 节点：Event Sync Requested

添加 MySQL 节点：

```text
Name: Event Sync Requested
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
INSERT INTO hermes_project_events (
  project_key,
  job_id,
  event_type,
  actor,
  title,
  details
) VALUES (
  'HermesOS',
  {{ $('Create Sync Job').first().json.insertId }},
  'SYNC_REQUESTED',
  'user',
  '用户请求同步本地真实状态',
  {{ JSON.stringify($('Parse Action JSON').first().json.action.instruction) }}
);
```

### 8.4 节点：Format Sync Reply

添加 Code 节点：

```text
Name: Format Sync Reply
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [
  {
    json: {
      reply_text: '已创建同步任务，本地 Worker 会检查真实 Git 状态并回报。',
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

然后接飞书回复节点。

---

## 9. Main Router 分支：dev.run

### 9.1 节点：Create Session

从 `dev.run` 出口添加 MySQL 节点：

```text
Name: Create Session
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
  {{ JSON.stringify($('Build Action Input').first().json.feishu.user_id) }},
  {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
  {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }},
  {{ JSON.stringify($('Parse Action JSON').first().json.action.summary) }}
);
```

### 9.2 节点：Set Session Branch

添加 MySQL 节点：

```text
Name: Set Session Branch
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_sessions
SET branch_name = CONCAT('hermes/dev-', id)
WHERE id = {{ $('Create Session').first().json.insertId }};
```

### 9.3 节点：Create Dev Run Job

添加 MySQL 节点：

```text
Name: Create Dev Run Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }}
  )
);
```

### 9.4 节点：Set Project Running Dev

添加 MySQL 节点：

```text
Name: Set Project Running Dev
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_project_state
SET
  project_status = 'RUNNING',
  current_session_id = {{ $('Create Session').first().json.insertId }},
  current_job_id = {{ $('Create Dev Run Job').first().json.insertId }},
  last_message = '已创建开发 Session 和 DEV_RUN Job。'
WHERE project_key = 'HermesOS';
```

### 9.5 节点：Event Session Created

添加 MySQL 节点：

```text
Name: Event Session Created
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

### 9.6 节点：Format Dev Run Reply

添加 Code 节点：

```text
Name: Format Dev Run Reply
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
const sessionId = $('Create Session').first().json.insertId;
const feishu = $('Build Action Input').first().json.feishu;
return [
  {
    json: {
      reply_text: `已创建 Session #${sessionId}，本地 Worker 会开始 Codex 规划、Claude 执行和 Codex Review。`,
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

然后接飞书回复节点。

---

## 10. Main Router 分支：dev.fix / dev.review / dev.approve / dev.rollback

这几个分支结构类似。

### 10.1 dev.fix：Create Dev Fix Job

MySQL 节点：

```text
Name: Create Dev Fix Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }}
  )
);
```

后面加 MySQL：

```text
Name: Set Session Fixing
```

Query：

```sql
UPDATE hermes_sessions
SET status = 'FIXING'
WHERE id = {{ $('Hermes Brain').first().json.brain.current_session_id }};
```

回复 Code：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '已创建继续修改 Job，本地 Worker 会在当前 Session 分支上继续修。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

### 10.2 dev.review：Create Review Job

MySQL 节点：

```text
Name: Create Review Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }}
  )
);
```

回复：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '已创建 Review Job，Codex 会审查当前 diff。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

### 10.3 dev.approve：Create Approve Job

MySQL 节点：

```text
Name: Create Approve Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }}
  )
);
```

回复：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '收到确认提交。本地 Worker 会检查分支和 Review 状态，通过后 commit / push。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

### 10.4 dev.rollback：Create Rollback Job

MySQL 节点：

```text
Name: Create Rollback Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
    'feishu_chat_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
    'feishu_message_id', {{ JSON.stringify($('Build Action Input').first().json.feishu.message_id) }}
  )
);
```

回复：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '收到确认回滚。本地 Worker 会检查安全分支，然后回滚当前 Session 改动。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

---

## 11. Main Router 分支：worker.online / worker.offline / help / unknown

### 11.1 worker.online

MySQL 节点：

```text
Name: Set Worker Enabled
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_agent_state
SET
  enabled = 1,
  status = IF(last_seen_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE), 'IDLE', 'OFFLINE'),
  last_message = '用户允许本地 Worker 接任务。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

回复：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '已允许本地 Worker 接任务。如果 Worker 没启动，请在本地运行 npm run start。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

### 11.2 worker.offline

MySQL 节点：

```text
Name: Set Worker Disabled
```

Query：

```sql
UPDATE hermes_agent_state
SET
  enabled = 0,
  status = 'PAUSED',
  last_message = '用户暂停本地 Worker 接任务。'
WHERE worker_key = 'HermesOS-Windows-Local';
```

回复：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [{ json: { reply_text: '已暂停本地 Worker 接任务。', feishu_message_id: feishu.message_id, feishu_chat_id: feishu.chat_id } }];
```

### 11.3 help

Code 节点：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [
  {
    json: {
      reply_text: [
        'HermesOS 可以这样用：',
        '',
        '项目状态',
        '同步一下',
        '这个页面太丑了，重做',
        '这里再改一下',
        'review 一下',
        '确认提交',
        '确认回滚',
        'Hermes 本地上线',
        'Hermes 本地下线'
      ].join('\n'),
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

### 11.4 unknown

Code 节点：

```javascript
const feishu = $('Build Action Input').first().json.feishu;
return [
  {
    json: {
      reply_text: '我还没理解这句话要执行什么。你可以说：项目状态、同步一下、继续修改、确认提交、确认回滚。',
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

---

## 12. 第五步：飞书回复节点怎么建

每个要回复飞书的分支，最后都接这三个节点。

### 12.1 节点：Feishu Tenant Token

添加 HTTP Request 节点：

```text
Name: Feishu Tenant Token
Method: POST
URL: https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Send Body: On
Body Content Type: JSON
```

Body：

```json
{
  "app_id": "你的_FEISHU_APP_ID",
  "app_secret": "你的_FEISHU_APP_SECRET"
}
```

### 12.2 节点：Build Feishu Reply Body

添加 Code 节点：

```text
Name: Build Feishu Reply Body
Mode: Run Once for All Items
Language: JavaScript
```

代码：

```javascript
return [
  {
    json: {
      feishu_message_id: $json.feishu_message_id,
      feishu_chat_id: $json.feishu_chat_id,
      msg_type: 'text',
      content: JSON.stringify({
        text: $json.reply_text || 'HermesOS 已收到。',
      }),
      token: $('Feishu Tenant Token').first().json.tenant_access_token,
    },
  },
];
```

### 12.3 节点：Feishu Reply

添加 HTTP Request 节点：

```text
Name: Feishu Reply
Method: POST
URL: https://open.feishu.cn/open-apis/im/v1/messages/{{ $json.feishu_message_id }}/reply
Send Headers: On
Send Body: On
Body Content Type: JSON
```

Headers：

```text
Authorization: Bearer {{ $json.token }}
Content-Type: application/json
```

Body：

```json
{
  "msg_type": "{{ $json.msg_type }}",
  "content": "{{ $json.content }}"
}
```

---

## 13. 第六步：回飞书后台填事件订阅 URL

现在回飞书开放平台。

操作：

```text
进入应用
事件订阅
填写请求地址
```

URL：

```text
https://你的n8n域名/webhook/hermes/feishu
```

点击验证。

如果验证失败，检查：

```text
n8n workflow 是否 Active
Webhook path 是否 hermes/feishu
Respond Challenge 是否接在 true 出口
Response Body 是否 {"challenge":"{{ $json.challenge }}"}
```

验证通过后，发布应用或重新发布权限。

---

## 14. 第七步：建 n8n Workflow 2：Hermes Worker - Heartbeat

### 14.1 新建 Workflow

```text
Workflows
Add workflow
名字：Hermes Worker - Heartbeat
Save
```

### 14.2 节点 1：Worker Heartbeat Webhook

Webhook 节点：

```text
Name: Worker Heartbeat Webhook
HTTP Method: POST
Path: hermes/worker/heartbeat
Authentication: None
Respond: Using Respond to Webhook Node
```

### 14.3 节点 2：Validate Worker Token

Code 节点：

```javascript
const auth = $json.headers?.authorization ?? $json.headers?.Authorization ?? '';
const expected = 'Bearer 换成你的_HERMES_WORKER_TOKEN';

if (auth !== expected) {
  return [{ json: { ok: false, statusCode: 401, error: 'Unauthorized' } }];
}

return [{ json: { ok: true, body: $json.body ?? $json } }];
```

### 14.4 节点 3：Is Token OK

IF 节点：

```text
Value 1: {{ $json.ok }}
Operation: equals
Value 2: true
```

false 出口接 Respond：

```json
{
  "ok": false,
  "error": "Unauthorized"
}
```

### 14.5 节点 4：Update Agent State

true 出口接 MySQL：

```text
Name: Update Agent State
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

### 14.6 节点 5：Respond Heartbeat OK

Respond to Webhook：

```json
{
  "ok": true,
  "message": "heartbeat received"
}
```

最后点：

```text
Active: 开启
Save
```

---

## 15. 第八步：建 n8n Workflow 3：Hermes Worker - Poll

### 15.1 新建 Workflow

名字：

```text
Hermes Worker - Poll
```

### 15.2 节点 1：Worker Poll Webhook

Webhook：

```text
Name: Worker Poll Webhook
HTTP Method: POST
Path: hermes/worker/poll
Respond: Using Respond to Webhook Node
```

### 15.3 节点 2：Validate Worker Token

同 heartbeat，代码里的 token 要一样。

### 15.4 节点 3：Load Worker State

MySQL：

```text
Name: Load Worker State
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
SELECT *
FROM hermes_agent_state
WHERE worker_key = {{ JSON.stringify($json.body.worker_key) }}
  AND project_key = {{ JSON.stringify($json.body.project_key) }}
LIMIT 1;
```

### 15.5 节点 4：Is Worker Enabled

IF 节点：

```text
Value 1: {{ Number($json.enabled) }}
Operation: equals
Value 2: 1
```

false 出口 Respond：

```json
{
  "ok": true,
  "job": null,
  "message": "worker paused"
}
```

### 15.6 节点 5：Query Next Job

true 出口接 MySQL：

```text
Name: Query Next Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
WHERE j.project_key = 'HermesOS'
  AND j.status = 'PENDING'
  AND (j.run_after IS NULL OR j.run_after <= NOW())
ORDER BY j.priority ASC, j.created_at ASC
LIMIT 1;
```

### 15.7 节点 6：Has Job

IF 节点：

```text
Value 1: {{ $json.id }}
Operation: is not empty
```

false 出口 Respond：

```json
{
  "ok": true,
  "job": null
}
```

### 15.8 节点 7：Claim Job

true 出口接 MySQL：

```text
Name: Claim Job
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_local_jobs
SET
  status = 'RUNNING',
  worker_key = {{ JSON.stringify($('Worker Poll Webhook').first().json.body.worker_key) }},
  lease_token = UUID(),
  lease_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE),
  attempt_count = attempt_count + 1,
  started_at = COALESCE(started_at, NOW())
WHERE id = {{ $('Query Next Job').first().json.id }}
  AND status = 'PENDING';
```

### 15.9 节点 8：Build Poll Response

Code：

```javascript
const job = $('Query Next Job').first().json;

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

### 15.10 节点 9：Respond Poll

Respond to Webhook：

```text
Respond With: First Incoming Item
```

或者 JSON Body 直接填：

```json
{{ JSON.stringify($json) }}
```

不同 n8n 版本这里略有差异，目标就是把 `Build Poll Response` 的 JSON 原样返回。

开启 Active。

---

## 16. 第九步：建 n8n Workflow 4：Hermes Worker - Report

### 16.1 新建 Workflow

名字：

```text
Hermes Worker - Report
```

### 16.2 节点 1：Worker Report Webhook

Webhook：

```text
Name: Worker Report Webhook
HTTP Method: POST
Path: hermes/worker/report
Respond: Using Respond to Webhook Node
```

### 16.3 节点 2：Validate Worker Token

同前面。

### 16.4 节点 3：Update Job From Report

MySQL：

```text
Name: Update Job From Report
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

### 16.5 节点 4：Update Session From Report

MySQL：

```text
Name: Update Session From Report
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

```sql
UPDATE hermes_sessions
SET
  status = {{ JSON.stringify($json.body.session_status || 'OPEN') }},
  risk_level = {{ JSON.stringify($json.body.risk_level || 'UNKNOWN') }},
  review_result = {{ JSON.stringify($json.body.review_result || 'UNKNOWN') }},
  branch_name = {{ JSON.stringify($json.body.branch || '') }},
  commit_hash = {{ JSON.stringify($json.body.commit_hash || '') }},
  summary = {{ JSON.stringify($json.body.summary || '') }},
  last_error = {{ JSON.stringify($json.body.error_message || '') }}
WHERE id = {{ $json.body.session_id || 0 }};
```

### 16.6 节点 5：Update Project State From Report

MySQL：

```text
Name: Update Project State From Report
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

### 16.7 节点 6：Split Artifacts

Code：

```javascript
const body = $('Worker Report Webhook').first().json.body;
const artifacts = Array.isArray(body.artifacts) ? body.artifacts : [];

if (artifacts.length === 0) {
  return [];
}

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

### 16.8 节点 7：Insert Artifact

MySQL：

```text
Name: Insert Artifact
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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

注意：如果没有 artifacts，这条链不会运行，没关系。

### 16.9 节点 8：Insert Report Event

从 `Update Project State From Report` 后面接 MySQL：

```text
Name: Insert Report Event
Credential: Hermes MySQL
Operation: Execute Query
```

Query：

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
  {{ JSON.stringify($('Worker Report Webhook').first().json.body.project_key) }},
  {{ $('Worker Report Webhook').first().json.body.session_id || 'NULL' }},
  {{ $('Worker Report Webhook').first().json.body.job_id || 'NULL' }},
  CONCAT('JOB_', {{ JSON.stringify($('Worker Report Webhook').first().json.body.job_type) }}, '_', {{ JSON.stringify($('Worker Report Webhook').first().json.body.status) }}),
  'worker',
  {{ JSON.stringify($('Worker Report Webhook').first().json.body.summary || 'Worker report') }},
  {{ JSON.stringify(($('Worker Report Webhook').first().json.body.diff_stat || '') + '\n' + (($('Worker Report Webhook').first().json.body.changed_files || []).join('\n'))) }},
  CAST({{ JSON.stringify(JSON.stringify($('Worker Report Webhook').first().json.body)) }} AS JSON)
);
```

### 16.10 节点 9：Format Report Reply

Code：

```javascript
const b = $('Worker Report Webhook').first().json.body;
const lines = [];

if (b.status === 'SUCCESS') {
  lines.push(`Hermes Job 完成：${b.job_type}`);
} else {
  lines.push(`Hermes Job 失败：${b.job_type}`);
}

if (b.session_id) lines.push(`Session：#${b.session_id}`);
if (b.session_status) lines.push(`Session 状态：${b.session_status}`);
if (b.project_status) lines.push(`项目状态：${b.project_status}`);
if (b.git_state) lines.push(`Git 状态：${b.git_state}`);
if (b.branch) lines.push(`分支：${b.branch}`);
if (b.review_result) lines.push(`Review：${b.review_result}`);
if (b.risk_level) lines.push(`风险：${b.risk_level}`);
if (b.commit_hash) lines.push(`Commit：${b.commit_hash}`);

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
lines.push('这里再改一下');
lines.push('review 一下');
lines.push('确认提交');
lines.push('确认回滚');

const input = b.input || {};

return [
  {
    json: {
      reply_text: lines.join('\n'),
      feishu_message_id: input.feishu_message_id,
      feishu_chat_id: input.feishu_chat_id,
    },
  },
];
```

然后接第 12 节的飞书回复节点。

### 16.11 节点 10：Respond Report OK

Respond to Webhook：

```json
{
  "ok": true
}
```

开启 Active。

---

## 17. 第十步：写本地 Worker

### 17.1 创建目录

PowerShell 打开：

```powershell
cd C:\Users\AL\Documents\HermesOS
mkdir worker
cd worker
```

### 17.2 创建 package.json

新建文件：

```text
C:\Users\AL\Documents\HermesOS\worker\package.json
```

内容：

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

### 17.3 创建 .env

新建：

```text
C:\Users\AL\Documents\HermesOS\worker\.env
```

内容：

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

### 17.4 创建 src 目录

```powershell
mkdir src
```

### 17.5 创建 src/config.js

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

### 17.6 创建 src/api.js

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

### 17.7 创建 src/shell.js

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

### 17.8 创建 src/git.js

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
  await git('fetch origin');

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

### 17.9 创建 src/prompts.js

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

### 17.10 创建 src/executors.js

```javascript
import { config } from './config.js';
import { mustRun } from './shell.js';
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
  const safePrompt = prompt.replace(/"/g, '\\"');
  const result = await mustRun(config.codexCommand, [
    `exec --cd "${config.projectDir}" "${safePrompt}"`
  ], { cwd: config.projectDir });
  return result.stdout.trim();
}

async function runClaude(prompt) {
  const safePrompt = prompt.replace(/"/g, '\\"');
  const result = await mustRun(config.claudeCommand, [
    `-p "${safePrompt}"`
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

export async function executeSync() {
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

export async function executeRollback() {
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

### 17.11 创建 src/index.js

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
        input: job.input,
        ...result,
      });
    } catch (error) {
      await reportJob({
        job_id: job.id,
        session_id: job.session_id,
        job_type: job.job_type,
        status: 'FAILED',
        input: job.input,
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

### 17.12 安装依赖

PowerShell：

```powershell
cd C:\Users\AL\Documents\HermesOS\worker
npm install
```

### 17.13 启动 Worker

```powershell
npm run start
```

如果看到：

```text
Hermes Worker started for HermesOS
```

说明启动成功。

---

## 18. 第十一步：测试 Level 1

### 18.1 测飞书项目状态

飞书发：

```text
项目状态
```

预期：

```text
收到 HermesOS 项目状态回复
```

### 18.2 测 Worker heartbeat

启动 Worker 后执行 SQL：

```sql
SELECT * FROM hermes_agent_state;
```

预期：

```text
status = IDLE
last_seen_at 有时间
```

### 18.3 测同步

飞书发：

```text
同步一下
```

预期：

```text
n8n 创建 SYNC Job
Worker 拉到 Job
Worker 执行 git status
Worker report
飞书收到完成汇报
```

查 SQL：

```sql
SELECT * FROM hermes_local_jobs ORDER BY id DESC LIMIT 5;
SELECT * FROM hermes_project_state;
```

---

## 19. 第十二步：测试 Level 2

### 19.1 测 dev.run

飞书发：

```text
给项目创建一个 README，说明 HermesOS 是 AI Developer OS
```

预期：

```text
创建 Session
创建 DEV_RUN Job
Worker 执行 Codex Plan
Worker 执行 Claude
Worker 执行 Codex Review
Session 状态 REVIEW_PENDING
Git 状态 DIRTY
```

查：

```sql
SELECT * FROM hermes_sessions ORDER BY id DESC LIMIT 3;
SELECT * FROM hermes_session_artifacts ORDER BY id DESC LIMIT 10;
```

### 19.2 测 dev.fix

飞书发：

```text
这里写得不够清楚，再高级一点
```

预期：

```text
创建 DEV_FIX Job
继续当前 Session
```

### 19.3 测 review

飞书发：

```text
review 一下
```

预期：

```text
创建 DEV_REVIEW Job
Codex Review 当前 diff
```

### 19.4 测确认提交

飞书发：

```text
确认提交
```

预期：

```text
Worker 检查 hermes/dev-* 分支
git add
git commit
git push
Session DONE
Project IDLE / CLEAN
```

### 19.5 测确认回滚

新建另一个任务并让它产生改动，然后飞书发：

```text
确认回滚
```

预期：

```text
Worker 检查 hermes/dev-* 分支
git reset --hard
git clean -fd
Session ROLLED_BACK
Project IDLE / CLEAN
```

---

## 20. 第十三步：Level 3 功能

### 20.1 Session 记忆

你前面已经把消息写入了：

```text
hermes_session_messages
```

DeepSeek 输入里已经包含最近 8 条消息。  
所以可以测试：

```text
刚才那个继续改
这个不要了
这里再高级一点
```

### 20.2 自动修复 3 轮

这个增强放在 Report workflow。

逻辑：

```text
如果 job_type = DEV_RUN 或 DEV_FIX
并且 review_result = FAIL
并且 session.fix_count < 3
则自动创建 DEV_FIX Job
否则 Session BLOCKED
```

你可以后续加一个 IF 节点：

```text
Value 1: {{ $json.body.review_result }}
equals FAIL
```

然后 MySQL 创建 DEV_FIX Job。

### 20.3 日报 Workflow

新建 Workflow：

```text
Name: Hermes Daily Report
Trigger: Schedule Trigger
Time: 每天 21:30
```

MySQL：

```sql
SELECT *
FROM hermes_project_events
WHERE project_key = 'HermesOS'
  AND created_at >= CURDATE()
ORDER BY created_at ASC;
```

Code 生成日报：

```javascript
const events = $input.all().map(i => i.json);
const lines = [];
lines.push('HermesOS 今日日报');
lines.push('');

if (!events.length) {
  lines.push('今天没有事件。');
} else {
  for (const e of events) {
    lines.push(`- ${e.created_at} ${e.title}`);
  }
}

return [{ json: { reply_text: lines.join('\n') } }];
```

然后发飞书。

### 20.4 健康检查 Workflow

新建 Workflow：

```text
Name: Hermes Health Monitor
Trigger: Schedule Trigger
每 10 分钟
```

MySQL 检查 Worker：

```sql
SELECT
  worker_key,
  status,
  last_seen_at,
  TIMESTAMPDIFF(MINUTE, last_seen_at, NOW()) AS minutes_since_seen
FROM hermes_agent_state
WHERE worker_key = 'HermesOS-Windows-Local';
```

如果：

```text
minutes_since_seen > 2
```

飞书告警：

```text
Hermes Worker 超过 2 分钟没有 heartbeat，请检查本地 Worker 是否运行。
```

---

## 21. 常见错误怎么处理

### 21.1 飞书验证失败

检查：

```text
Webhook workflow 是否 Active
URL 是否 /webhook/hermes/feishu
Respond Challenge 是否接 true 出口
Body 是否包含 challenge
```

### 21.2 飞书消息收不到

检查：

```text
机器人是否进群
事件订阅是否开
权限是否发布
n8n 域名是否公网可访问
```

### 21.3 DeepSeek 不输出 JSON

处理：

```text
temperature 改 0.1
System Prompt 强调只输出 JSON
Parse Action JSON 已经做了容错
```

### 21.4 Worker heartbeat 失败

检查：

```text
.env 里的 N8N_BASE_URL 是否正确
HERMES_WORKER_TOKEN 是否和 n8n 一样
n8n workflow 是否 Active
```

### 21.5 Worker 找不到 codex

PowerShell 测：

```powershell
codex --help
```

如果不行：

```text
把 Codex 命令加入 PATH
或在 .env 里 CODEX_COMMAND 写绝对路径
```

### 21.6 Worker 找不到 claude

PowerShell 测：

```powershell
claude --help
```

如果不行，同样处理 PATH。

### 21.7 commit 被拒绝

通常是因为当前分支不是：

```text
hermes/dev-*
```

这是安全规则。不要取消它。

---

## 22. 最终完成标准

全部打勾，才算最终完成。

```text
[ ] 阿里云 MySQL 表全部建好
[ ] 飞书机器人能收到消息
[ ] n8n Main Router Active
[ ] n8n Worker Heartbeat Active
[ ] n8n Worker Poll Active
[ ] n8n Worker Report Active
[ ] 本地 Worker 能启动
[ ] Worker heartbeat 成功
[ ] project.status 成功
[ ] project.sync 成功
[ ] dev.run 成功
[ ] Codex Plan 成功
[ ] Claude Execute 成功
[ ] Codex Review 成功
[ ] dev.fix 成功
[ ] dev.review 成功
[ ] 确认提交成功
[ ] 确认回滚成功
[ ] Session 能理解“这个 / 刚才那个”
[ ] 日报成功
[ ] 健康检查成功
[ ] main 分支不会被自动 reset
[ ] main 分支不会被自动 commit
```

---

## 23. 你实际应该按这个顺序做

不要跳。

```text
1. 建 MySQL 表
2. 初始化 HermesOS 数据
3. 配 n8n MySQL Credential
4. 配飞书机器人权限
5. 建 Main Router 到 project.status
6. 飞书验证 Webhook
7. 测“项目状态”
8. 建 Worker Heartbeat workflow
9. 建 Worker Poll workflow
10. 建 Worker Report workflow
11. 写本地 Worker
12. 启动本地 Worker
13. 测 heartbeat
14. 接 project.sync
15. 测“同步一下”
16. 接 dev.run
17. 测创建 Session 和 DEV_RUN
18. 修 Worker 的 Codex / Claude 命令
19. 测完整 DEV_RUN
20. 接 dev.fix
21. 接 dev.review
22. 接 dev.approve
23. 接 dev.rollback
24. 接日报
25. 接健康检查
26. 全部测试剧本跑一遍
```

完成第 26 步，就是 HermesOS 最终完整版本。
