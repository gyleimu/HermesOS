# HermesOS Multi-Project Switching

This document upgrades HermesOS V1 from one hardcoded project to a switchable project router.

## Goal

In Feishu:

```text
@Helion DevOS 切换项目 CharacterOS
@Helion DevOS 项目状态
@Helion DevOS 新建一个任务：整理 README
```

The Feishu chat remembers the selected project. Later commands use that project until switched again.

## Database Table

Run once:

```sql
USE hermes;

CREATE TABLE IF NOT EXISTS hermes_chat_project_binding (
  chat_id VARCHAR(128) NOT NULL PRIMARY KEY,
  project_key VARCHAR(64) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_project_key (project_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Optional default binding for the current Feishu group:

```sql
INSERT INTO hermes_chat_project_binding (
  chat_id,
  project_key
) VALUES (
  '你的飞书群 chat_id',
  'CharacterOS'
)
ON DUPLICATE KEY UPDATE
  project_key = VALUES(project_key);
```

## n8n Node: Parse Project Command

Place this Code node immediately after `Build Action Input`.

Name:

```text
Parse Project Command
```

Code:

```js
const input = $('Build Action Input').first().json;
const text = String(input.text || '').trim();

const knownProjects = ['HermesOS', 'CharacterOS'];

let explicitProjectKey = '';
let isProjectSwitch = false;

const switchMatch = text.match(/(?:切换项目|使用项目|选择项目|项目切换到)\s*([A-Za-z0-9_-]+)/i);
if (switchMatch) {
  explicitProjectKey = switchMatch[1];
  isProjectSwitch = true;
}

if (!explicitProjectKey) {
  const direct = knownProjects.find((projectKey) =>
    new RegExp(`(^|\\s)${projectKey}(\\s|$)`, 'i').test(text)
  );
  if (direct) explicitProjectKey = direct;
}

return [
  {
    json: {
      ...input,
      explicit_project_key: explicitProjectKey,
      is_project_switch: isProjectSwitch,
    },
  },
];
```

## n8n Node: Resolve Project

Place this MySQL node after `Parse Project Command`.

Name:

```text
Resolve Project
```

SQL:

```sql
SELECT
  p.project_key,
  p.project_name,
  p.repo_full_name,
  p.local_path,
  p.default_branch,
  p.dev_branch_prefix
FROM hermes_projects p
WHERE p.enabled = 1
  AND p.project_key = COALESCE(
    NULLIF({{ JSON.stringify($('Parse Project Command').first().json.explicit_project_key || '') }}, ''),
    (
      SELECT b.project_key
      FROM hermes_chat_project_binding b
      WHERE b.chat_id = {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }}
      LIMIT 1
    ),
    'HermesOS'
  )
LIMIT 1;
```

## n8n Node: Is Project Switch

Place this IF node after `Resolve Project`.

Condition:

```js
{{ $('Parse Project Command').first().json.is_project_switch }}
```

Compare as boolean `true`.

True branch goes to `Save Project Binding`.

False branch continues to `Load Project Context`.

## n8n Node: Save Project Binding

MySQL node on the true branch.

Name:

```text
Save Project Binding
```

SQL:

```sql
INSERT INTO hermes_chat_project_binding (
  chat_id,
  project_key
) VALUES (
  {{ JSON.stringify($('Build Action Input').first().json.feishu.chat_id) }},
  {{ JSON.stringify($('Resolve Project').first().json.project_key) }}
)
ON DUPLICATE KEY UPDATE
  project_key = VALUES(project_key),
  updated_at = CURRENT_TIMESTAMP;
```

Then connect to a Code node:

Name:

```text
Format Project Switch Reply
```

Code:

```js
const project = $('Resolve Project').first().json;
const feishu = $('Build Action Input').first().json.feishu;

return [
  {
    json: {
      reply_text: `已切换项目：${project.project_name || project.project_key}`,
      feishu_message_id: feishu.message_id,
      feishu_chat_id: feishu.chat_id,
    },
  },
];
```

Connect it to the existing Feishu reply chain.

## Replace Hardcoded Project Key

In Workflow 1, replace hardcoded:

```sql
'HermesOS'
```

with:

```sql
{{ JSON.stringify($('Resolve Project').first().json.project_key) }}
```

At minimum update these nodes:

- `Load Project Context`
- `Load Current Session`
- `Load Recent Messages`
- `Create Session`
- `Query Created Session`
- `Set Session Branch`
- `Create Dev Run Job`
- `Query Created Dev Run Job`
- `Set Project Running Dev`
- `Create Sync Job`
- `Query Created Sync Job`
- `Set Project Running Sync`
- `Query Project Status`
- `Query Worker Status`
- `Set Worker Enabled`
- `Set Worker Disabled`
- `Create Review Job`
- `Create Approve Job`
- `Create Rollback Job`

## Build Action Input Update

In `Build Action Input`, keep `project_key` dynamic:

```js
project_key: $('Resolve Project').first().json.project_key
```

If `Build Action Input` must stay before `Resolve Project`, then add/update project key in a new Code node after `Resolve Project`:

```js
const input = $('Build Action Input').first().json;
const project = $('Resolve Project').first().json;

return [
  {
    json: {
      ...input,
      project_key: project.project_key,
      context: {
        ...input.context,
        project,
      },
    },
  },
];
```

Name that node:

```text
Build Routed Action Input
```

Then downstream nodes should read from `Build Routed Action Input`.

## Worker Poll Response Requirement

Workflow 3 `Hermes Worker - Poll` must include project fields in the job response:

```json
{
  "job": {
    "id": 1,
    "project_key": "CharacterOS",
    "project": {
      "project_key": "CharacterOS",
      "local_path": "C:\\Users\\AL\\Documents\\CharacterOS",
      "default_branch": "master",
      "dev_branch_prefix": "hermes/dev-"
    }
  }
}
```

Update `Query Next Job` to join `hermes_projects`:

```sql
SELECT
  j.*,
  p.local_path,
  p.default_branch,
  p.dev_branch_prefix
FROM hermes_local_jobs j
JOIN hermes_projects p
  ON p.project_key = j.project_key
WHERE j.status = 'PENDING'
  AND p.enabled = 1
ORDER BY j.id ASC
LIMIT 1;
```

Update `Build Poll Response` so each returned job contains:

```js
project_key: job.project_key,
project: {
  project_key: job.project_key,
  local_path: job.local_path,
  default_branch: job.default_branch,
  dev_branch_prefix: job.dev_branch_prefix,
}
```

Hermes Worker now supports this structure and will execute in the correct local repository.

## Smoke Test

1. Start Worker:

```powershell
cd C:\Users\AL\Documents\HermesOS\worker
npm run start
```

2. Feishu:

```text
@Helion DevOS 切换项目 CharacterOS
```

3. Feishu:

```text
@Helion DevOS 项目状态
```

Expected: `CharacterOS 项目状态`.

4. First safe task:

```text
@Helion DevOS 新建一个任务：阅读 README.md、docs/latest_development_flow.md 和 docs/INDEX.md，整理一份 docs/hermes_characteros_project_brief.md，概括 CharacterOS 当前架构、开发边界、验证命令和下一步建议。不要改业务代码。
```
