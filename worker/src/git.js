import { config } from './config.js';
import { mustRun, run } from './shell.js';

export function git(args, options = {}) {
  return mustRun('git', args, { cwd: config.projectDir, ...options });
}

export function gitOptional(args, options = {}) {
  return run('git', args, { cwd: config.projectDir, ...options });
}

export async function currentBranch() {
  const result = await git(['branch', '--show-current']);
  return result.stdout.trim() || 'UNKNOWN';
}

export async function statusShort() {
  const result = await git(['status', '--short']);
  return result.stdout.trim();
}

export async function diffStat() {
  const result = await gitOptional(['diff', '--stat']);
  return result.stdout.trim();
}

export async function changedFiles() {
  // git diff --name-only 只覆盖已跟踪文件的修改，漏掉新文件（untracked）。
  // 改用 git status --short 同时捕获 modified / added / untracked。
  const result = await gitOptional(['status', '--short']);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => {
      // git status --short 格式: "XY filename"，其中 XY 是两个状态字符+空格
      const m = line.match(/^..\s+(.+)$/);
      return m ? m[1].trim() : '';
    })
    .filter(Boolean);
}

export async function ensureDevBranch(sessionId) {
  if (!sessionId) {
    throw new Error('session_id is required for dev branch jobs');
  }

  const branch = `${config.devBranchPrefix}${sessionId}`;
  await gitOptional(['fetch', 'origin']);

  const localCheck = await gitOptional(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (localCheck.code === 0) {
    await git(['checkout', branch]);
    return branch;
  }

  await git(['checkout', config.defaultBranch]);
  await gitOptional(['pull', 'origin', config.defaultBranch]);
  await git(['checkout', '-b', branch]);
  return branch;
}

export function assertDevBranch(branch) {
  if (!branch.startsWith(config.devBranchPrefix)) {
    throw new Error(`Refuse dangerous git operation on non-dev branch: ${branch}`);
  }
}
