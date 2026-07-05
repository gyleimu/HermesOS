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
import { claudeExecutePrompt, codexPlanPrompt, codexReviewPrompt } from './prompts.js';

async function runCodex(prompt) {
  const result = await mustRun(
    config.codexCommand,
    ['--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec', '--cd', config.projectDir, prompt],
    {
      cwd: config.projectDir,
      timeoutMs: config.commandTimeoutMs,
    },
  );
  return result.stdout.trim();
}

async function runClaude(prompt) {
  const result = await mustRun(config.claudeCommand, ['-p', prompt], {
    cwd: config.projectDir,
    timeoutMs: config.commandTimeoutMs,
  });
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
  const readmePath = `${config.projectDir}\\README.md`;
  const line = 'HermesOS 初始化说明：本项目已接入 HermesOS 自动化开发流程。';
  const prefix = await fileExists(readmePath) ? '\n' : '# HermesOS\n\n';

  await appendFile(readmePath, `${prefix}${line}\n`, 'utf8');

  const files = await changedFiles();
  const stat = await diffStat();

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
    throw new Error(`Git is dirty before dev job:\n${before}`);
  }

  if (config.aiExecutionMode === 'mock') {
    return executeMockDevRun(job, branch);
  }

  const plan = await runCodex(codexPlanPrompt(job));
  const claudePrompt = claudeExecutePrompt(job, plan);
  const claudeResult = await runClaude(claudePrompt);
  const review = await runCodex(codexReviewPrompt(job));
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

export function executeDevFix(job) {
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

  await git(['add', '-A']);
  const title = job.session?.title || `Hermes session ${job.session_id}`;
  await git(['commit', '-m', `Hermes session ${job.session_id}: ${title}`]);
  await git(['push', 'origin', branch]);
  const hash = (await git(['rev-parse', 'HEAD'])).stdout.trim();

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
  await git(['reset', '--hard']);
  await git(['clean', '-fd']);

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
