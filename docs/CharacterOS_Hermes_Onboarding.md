# CharacterOS Hermes Onboarding

This document describes how to connect CharacterOS to HermesOS V1.

## CharacterOS Summary

CharacterOS is an API-only Character Physics / Explorer / Agent SDK project.
It is currently organized around V10 Core Kernel RC, V11 Explorer Platform RC, and V12 Agent SDK RC.

Important local path:

```text
C:\Users\AL\Documents\CharacterOS
```

Main verification commands:

```powershell
npm run build
npm test
npm run test:quality
npm run test:reality
npm run test:trend
npm run rc:verify
```

## Local Repository Notes

At onboarding time CharacterOS was on a Hermes dev branch and had a local `package.json` modification adding:

```json
"hermes:sync": "git status --short --branch"
```

Do not overwrite or clean this without explicit approval.

## Worker Configuration

To point Hermes Worker at CharacterOS, update `worker/.env`:

```env
PROJECT_KEY=CharacterOS
PROJECT_DIR=C:\Users\AL\Documents\CharacterOS
WORKER_KEY=CharacterOS-Windows-Local
DEFAULT_BRANCH=master
DEV_BRANCH_PREFIX=hermes/dev-
AI_EXECUTION_MODE=claude
PROJECT_INSTRUCTIONS_PATH=C:\Users\AL\Documents\HermesOS\worker\project-instructions\CharacterOS.md
```

Keep the existing n8n URL and worker token values.

## MySQL Registration

Run this in MySQL:

```sql
USE hermes;

INSERT INTO hermes_projects (
  project_key,
  project_name,
  repo_full_name,
  local_path,
  default_branch,
  dev_branch_prefix,
  enabled
) VALUES (
  'CharacterOS',
  'CharacterOS',
  'gyleimu/CharacterOS',
  'C:\\Users\\AL\\Documents\\CharacterOS',
  'master',
  'hermes/dev-',
  1
)
ON DUPLICATE KEY UPDATE
  project_name = VALUES(project_name),
  repo_full_name = VALUES(repo_full_name),
  local_path = VALUES(local_path),
  default_branch = VALUES(default_branch),
  dev_branch_prefix = VALUES(dev_branch_prefix),
  enabled = VALUES(enabled);

INSERT INTO hermes_project_state (
  project_key,
  project_status,
  git_state,
  last_message
) VALUES (
  'CharacterOS',
  'IDLE',
  'UNKNOWN',
  'CharacterOS 已初始化，等待本地 Worker 同步。'
)
ON DUPLICATE KEY UPDATE
  project_status = VALUES(project_status),
  git_state = VALUES(git_state),
  last_message = VALUES(last_message);

INSERT INTO hermes_agent_state (
  worker_key,
  project_key,
  status,
  enabled,
  last_message
) VALUES (
  'CharacterOS-Windows-Local',
  'CharacterOS',
  'OFFLINE',
  1,
  '等待本地 Worker heartbeat。'
)
ON DUPLICATE KEY UPDATE
  project_key = VALUES(project_key),
  enabled = VALUES(enabled),
  last_message = VALUES(last_message);
```

## n8n Notes

Hermes V1 still contains project-key assumptions in n8n. Before running CharacterOS tasks, update the workflow SQL and code nodes that currently hardcode `HermesOS` so they use:

```text
CharacterOS
```

At minimum check:

- `Build Action Input`
- `Load Project Context`
- `Create Session`
- `Create Dev Run Job`
- `Create Sync Job`
- `Set Project Running Dev`
- `Set Project Running Sync`
- `Query Project Status`
- `Query Worker Status`

## First Test

Start Worker:

```powershell
cd C:\Users\AL\Documents\HermesOS\worker
npm run start
```

Feishu smoke test:

```text
@Helion DevOS 项目状态
```

Expected result:

```text
CharacterOS 项目状态
Worker：IDLE
```

First safe development task:

```text
@Helion DevOS 新建一个任务：阅读 README.md、docs/latest_development_flow.md 和 docs/INDEX.md，整理一份 docs/hermes_characteros_project_brief.md，概括 CharacterOS 当前架构、开发边界、验证命令和下一步建议。不要改业务代码。
```
