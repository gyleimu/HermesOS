import { config } from './config.js';
import { mustRun, run } from './shell.js';

export function git(args, options = {}) {
  return mustRun('git', args, { cwd: options.projectDir || config.projectDir, ...options });
}

export function gitOptional(args, options = {}) {
  return run('git', args, { cwd: options.projectDir || config.projectDir, ...options });
}

export async function currentBranch(options = {}) {
  const result = await git(['branch', '--show-current'], options);
  return result.stdout.trim() || 'UNKNOWN';
}

export async function statusShort(options = {}) {
  const result = await git(['status', '--short'], options);
  return result.stdout.trim();
}

export async function diffStat(options = {}) {
  const result = await gitOptional(['diff', '--stat'], options);
  return result.stdout.trim();
}

export async function changedFiles(options = {}) {
  // git diff --name-only 只覆盖已跟踪文件的修改，漏掉新文件（untracked）。
  // 改用 git status --short 同时捕获 modified / added / untracked。
  const result = await gitOptional(['status', '--short'], options);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => {
      // git status --short 格式: "XY filename"，其中 XY 是两个状态字符+空格
      const m = line.match(/^..\s+(.+)$/);
      return m ? m[1].trim() : '';
    })
    .filter(Boolean);
}

export async function ensureDevBranch(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error('session_id is required for dev branch jobs');
  }

  const defaultBranch = options.defaultBranch || config.defaultBranch;
  const devBranchPrefix = options.devBranchPrefix || config.devBranchPrefix;
  const branch = `${devBranchPrefix}${sessionId}`;
  await gitOptional(['fetch', 'origin'], options);

  const localCheck = await gitOptional(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], options);
  if (localCheck.code === 0) {
    await git(['checkout', branch], options);
    return branch;
  }

  await git(['checkout', defaultBranch], options);
  await gitOptional(['pull', 'origin', defaultBranch], options);
  await git(['checkout', '-b', branch], options);
  return branch;
}

export function assertDevBranch(branch, options = {}) {
  const devBranchPrefix = options.devBranchPrefix || config.devBranchPrefix;
  if (!branch.startsWith(devBranchPrefix)) {
    throw new Error(`Refuse dangerous git operation on non-dev branch: ${branch}`);
  }
}
