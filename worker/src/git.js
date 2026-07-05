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
  const result = await gitOptional(['diff', '--name-only']);
  return result.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
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
