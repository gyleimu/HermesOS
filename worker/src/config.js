import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: resolve(workerDir, '.env') });
dotenv.config({ path: resolve(workerDir, 'HermesOS配置记录.env') });

function normalizeBaseUrl(value) {
  return value
    ?.replace(/\/+$/, '')
    .replace(/\/webhook-test\/feishu$/i, '')
    .replace(/\/webhook\/feishu$/i, '')
    .replace(/\/webhook-test$/i, '')
    .replace(/\/webhook$/i, '')
    .replace(/\/feishu$/i, '');
}

export const config = {
  workerDir,
  projectKey: process.env.PROJECT_KEY || 'HermesOS',
  workerKey: process.env.WORKER_KEY || 'HermesOS-Windows-Local',
  projectDir: process.env.PROJECT_DIR,
  n8nBaseUrl: normalizeBaseUrl(process.env.N8N_BASE_URL || process.env.N8N_URL),
  token: process.env.HERMES_WORKER_TOKEN,
  heartbeatPath: process.env.HEARTBEAT_PATH || '/webhook/hermes/worker/heartbeat',
  pollPath: process.env.POLL_PATH || '/webhook/hermes/worker/poll',
  reportPath: process.env.REPORT_PATH || '/webhook/hermes/worker/report',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || 10000),
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS || 180000),
  codexCommand: process.env.CODEX_COMMAND || 'codex',
  claudeCommand: process.env.CLAUDE_COMMAND || (process.platform === 'win32' ? 'claude.cmd' : 'claude'),
  aiExecutionMode: process.env.AI_EXECUTION_MODE || 'mock',
  projectInstructionsPath: process.env.PROJECT_INSTRUCTIONS_PATH,
  defaultBranch: process.env.DEFAULT_BRANCH || 'main',
  devBranchPrefix: process.env.DEV_BRANCH_PREFIX || 'hermes/dev-',
};
