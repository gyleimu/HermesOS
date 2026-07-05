import { spawn } from 'node:child_process';

export function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: needsShell,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGTERM');
          resolve({
            code: 124,
            stdout,
            stderr: `${stderr}\nCommand timed out after ${options.timeoutMs}ms`.trim(),
          });
        }, options.timeoutMs)
      : null;

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr: error.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function mustRun(command, args = [], options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}
