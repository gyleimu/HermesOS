import { config } from './config.js';

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function post(path, body) {
  const response = await fetch(joinUrl(config.n8nBaseUrl, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      token: config.token,
      worker_key: config.workerKey,
      project_key: config.projectKey,
      ...body,
    }),
  });

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok || data.ok === false) {
    throw new Error(`n8n ${path} failed: ${response.status} ${text}`);
  }

  return data;
}

export function heartbeat(status, currentJobId = null, message = '') {
  return post(config.heartbeatPath, {
    status,
    current_job_id: currentJobId,
    message,
  });
}

export function pollJob() {
  return post(config.pollPath, {});
}

export function reportJob(payload) {
  return post(config.reportPath, payload);
}
