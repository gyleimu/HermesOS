import { existsSync } from 'node:fs';
import { config } from './config.js';
import { heartbeat, pollJob, reportJob } from './api.js';
import { executeJob } from './executors.js';
import { mustRun, run } from './shell.js';

let currentJobId = null;
let busy = false;

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

async function selfCheck() {
  required('PROJECT_DIR', config.projectDir);
  required('N8N_BASE_URL', config.n8nBaseUrl);
  required('HERMES_WORKER_TOKEN', config.token);

  if (!existsSync(config.projectDir)) {
    throw new Error(`PROJECT_DIR does not exist: ${config.projectDir}`);
  }

  await mustRun('git', ['--version'], { cwd: config.projectDir });

  const codexCheck = await run(config.codexCommand, ['--help'], { cwd: config.projectDir });
  if (codexCheck.code !== 0) {
    console.warn(`codex command not available yet: ${config.codexCommand}`);
  }

  const claudeCheck = await run(config.claudeCommand, ['--help'], { cwd: config.projectDir });
  if (claudeCheck.code !== 0) {
    console.warn(`claude command not available yet: ${config.claudeCommand}`);
  }
}

async function sendHeartbeat(message = '') {
  try {
    await heartbeat(busy ? 'BUSY' : 'IDLE', currentJobId, message || (busy ? 'Worker busy' : 'Worker idle'));
  } catch (error) {
    console.error('heartbeat failed:', error.message);
  }
}

async function handleJob(job) {
  currentJobId = job.id;
  busy = true;
  await sendHeartbeat(`Running ${job.job_type}`);

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
    console.error(`job ${job.id} failed:`, error.message);
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
    await sendHeartbeat('Worker idle');
  }
}

async function tick() {
  if (busy) return;

  try {
    const response = await pollJob();
    if (!response.job) return;

    console.log(`Worker pulled job #${response.job.id} (${response.job.job_type})`);
    await handleJob(response.job);
  } catch (error) {
    console.error('poll failed:', error.message);
  }
}

async function main() {
  await selfCheck();
  await heartbeat('IDLE', null, 'Worker started');

  setInterval(() => {
    void sendHeartbeat();
  }, config.heartbeatIntervalMs);

  setInterval(() => {
    void tick();
  }, config.pollIntervalMs);

  void tick();
  console.log(`Hermes Worker started for ${config.projectKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
