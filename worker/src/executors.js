import { appendFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { config } from './config.js';
import { mustRun } from './shell.js';
import {
  assertDevBranch,
  changedFiles,
  currentBranch,
  diffStat,
  ensureDevBranch,
  git,
  statusShort,
} from './git.js';
import {
  claudeExecutePrompt,
  codexPlanPrompt,
  codexReviewPrompt,
  projectInstructionsBlock,
} from './prompts.js';

function projectContext(job = {}) {
  const project = job.project || {};
  return {
    projectKey: job.project_key || project.project_key || config.projectKey,
    projectDir: project.local_path || job.local_path || config.projectDir,
    defaultBranch: project.default_branch || job.default_branch || config.defaultBranch,
    devBranchPrefix: project.dev_branch_prefix || job.dev_branch_prefix || config.devBranchPrefix,
  };
}

async function runCodex(prompt, context) {
  const result = await mustRun(
    config.codexCommand,
    ['--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec', '--cd', context.projectDir, prompt],
    {
      cwd: context.projectDir,
      timeoutMs: config.commandTimeoutMs,
    },
  );
  return result.stdout.trim();
}

async function runClaude(prompt, context) {
  console.log('=== Claude Prompt ===');
  console.log(prompt);
  console.log('=== End Claude Prompt ===');

  const result = await mustRun(
    config.claudeCommand,
    [
      '--print',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Bash',
    ],
    {
      cwd: context.projectDir,
      timeoutMs: config.commandTimeoutMs,
      stdin: `${prompt}\n`,
    },
  );

  console.log('=== Claude Result ===');
  console.log(result.stdout);
  console.log('=== End Claude Result ===');

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

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function executeMockDevRun(job, branch) {
  const context = projectContext(job);
  const readmePath = `${context.projectDir}\\README.md`;
  const line = 'HermesOS 初始化说明：本项目已接入 HermesOS 自动化开发流程。';
  const prefix = await fileExists(readmePath) ? '\n' : '# HermesOS\n\n';

  await appendFile(readmePath, `${prefix}${line}\n`, 'utf8');

  const files = await changedFiles(context);
  const stat = await diffStat(context);

  return {
    session_status: 'REVIEW_PENDING',
    project_status: 'REVIEW_PENDING',
    git_state: files.length ? 'DIRTY' : 'CLEAN',
    branch,
    summary: '测试模式已完成 README 初始化说明写入，等待用户审核。',
    changed_files: files,
    diff_stat: stat,
    review_result: 'PASS',
    risk_level: 'LOW',
    artifacts: [
      {
        artifact_type: 'PLAN',
        title: 'Mock Plan',
        content: `测试模式：根据用户目标写入 README。\n用户目标：${job.session?.user_goal || job.input?.instruction || ''}`,
      },
      {
        artifact_type: 'REVIEW_REPORT',
        title: 'Mock Review',
        content: 'REVIEW_RESULT: PASS\nRISK: LOW\n测试模式已验证 DEV_RUN 链路。',
      },
    ],
  };
}

async function executeClaudeDevRun(job, branch) {
  const context = projectContext(job);
  // 诊断日志：打印 job 结构以便排查数据传递问题
  console.log('=== Job Structure ===');
  console.log('job.id:', job.id);
  console.log('job.job_type:', job.job_type);
  console.log('job.session_id:', job.session_id);
  console.log('job.session:', JSON.stringify(job.session, null, 2));
  console.log('job.input:', JSON.stringify(job.input, null, 2));
  console.log('=== End Job Structure ===');

  const userGoal = job.session?.user_goal || job.input?.instruction || job.input?.summary || '';
  const projectInstructions = projectInstructionsBlock(job);

  const prompt = [
    '你是 HermesOS 的 Claude Executor。',
    '',
    '请直接在当前仓库完成用户明确要求的修改。',
    '不要提交 git，不要 push。',
    '不要做无关重构。',
    '',
    `用户目标：${userGoal}`,
    projectInstructions ? '\n项目专用指令：\n' + projectInstructions : '',
    '',
    '重要：请先用 Bash 工具运行 git status 和 dir/ls 了解当前仓库状态。',
    '如果用户目标提到某个文件（如 README.md），请先用 Read 工具查看该文件，再用 Edit 工具修改。',
    '完成后请用 Bash 运行 git diff --stat 确认改动。',
    '最后简短输出：修改了哪些文件、实现了什么、有什么风险。',
  ].join('\n');

  const claudeResult = await runClaude(prompt, context);
  const files = await changedFiles(context);
  const stat = await diffStat(context);

  return {
    session_status: 'REVIEW_PENDING',
    project_status: 'REVIEW_PENDING',
    git_state: files.length ? 'DIRTY' : 'CLEAN',
    branch,
    summary: files.length
      ? 'Claude 已完成代码修改，等待用户审核。'
      : 'Claude 执行完成，但没有产生文件改动。',
    changed_files: files,
    diff_stat: stat,
    review_result: 'UNKNOWN',
    risk_level: 'UNKNOWN',
    artifacts: [
      { artifact_type: 'CLAUDE_PROMPT', title: 'Claude Prompt', content: prompt },
      { artifact_type: 'CLAUDE_RESULT', title: 'Claude Result', content: claudeResult },
    ],
  };
}

export async function executeSync(job = {}) {
  const context = projectContext(job);
  const branch = await currentBranch(context);
  const short = await statusShort(context);

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
  const context = projectContext(job);
  const branch = await ensureDevBranch(job.session_id, context);
  const before = await statusShort(context);

  // 只拦截已跟踪文件的修改/删除，untracked 文件（??）不阻塞
  const dirtyTracked = before
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('??'))
    .join('\n')
    .trim();

  if (dirtyTracked) {
    throw new Error(`Git is dirty before dev job:\n${dirtyTracked}`);
  }

  if (config.aiExecutionMode === 'mock') {
    return executeMockDevRun(job, branch);
  }

  if (config.aiExecutionMode === 'claude') {
    return executeClaudeDevRun(job, branch);
  }

  const plan = await runCodex(codexPlanPrompt(job), context);
  const claudePrompt = claudeExecutePrompt(job, plan);
  const claudeResult = await runClaude(claudePrompt, context);
  const review = await runCodex(codexReviewPrompt(job), context);
  const parsed = parseReview(review);
  const files = await changedFiles(context);
  const stat = await diffStat(context);

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

export function executeDevFix(job) {
  return executeDevRun(job);
}

export async function executeReview(job) {
  const context = projectContext(job);
  const branch = await currentBranch(context);
  const review = await runCodex(codexReviewPrompt(job), context);
  const parsed = parseReview(review);
  const files = await changedFiles(context);
  const stat = await diffStat(context);

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
  const context = projectContext(job);
  const branch = await currentBranch(context);
  assertDevBranch(branch, context);

  const short = await statusShort(context);
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

  await git(['add', '-A'], context);
  const title = job.session?.title || `Hermes session ${job.session_id}`;
  await git(['commit', '-m', `Hermes session ${job.session_id}: ${title}`], context);
  await git(['push', 'origin', branch], context);
  const hash = (await git(['rev-parse', 'HEAD'], context)).stdout.trim();

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

export async function executeRollback(job = {}) {
  const context = projectContext(job);
  const branch = await currentBranch(context);
  assertDevBranch(branch, context);
  await git(['reset', '--hard'], context);
  await git(['clean', '-fd'], context);

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

export function executeJob(job) {
  if (job.job_type === 'SYNC') return executeSync(job);
  if (job.job_type === 'DEV_RUN') return executeDevRun(job);
  if (job.job_type === 'DEV_FIX') return executeDevFix(job);
  if (job.job_type === 'DEV_REVIEW') return executeReview(job);
  if (job.job_type === 'APPROVE') return executeApprove(job);
  if (job.job_type === 'ROLLBACK') return executeRollback(job);
  throw new Error(`Unsupported job_type: ${job.job_type}`);
}
