import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

function projectInstructionsPath(job = {}) {
  const projectKey = job.project_key || job.project?.project_key || config.projectKey;
  if (job.project?.instructions_path) return job.project.instructions_path;
  if (job.instructions_path) return job.instructions_path;
  if (config.projectInstructionsPath) return config.projectInstructionsPath;
  if (projectKey === 'CharacterOS') {
    return resolve(config.workerDir, 'project-instructions', 'CharacterOS.md');
  }
  return '';
}

export function projectInstructionsBlock(job = {}) {
  const instructionsPath = projectInstructionsPath(job);
  if (!instructionsPath) return '';
  if (!existsSync(instructionsPath)) {
    return [
      '项目专用指令文件未找到。',
      `配置路径：${instructionsPath}`,
      '如果任务依赖项目边界，请先修正 PROJECT_INSTRUCTIONS_PATH。',
    ].join('\n');
  }

  return readFileSync(instructionsPath, 'utf8').trim();
}

export function codexPlanPrompt(job) {
  const projectInstructions = projectInstructionsBlock(job);
  return [
    '你是 HermesOS 的 Codex Planner。',
    '',
    '这一步只规划，不修改文件。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    projectInstructions ? '\n项目专用指令：\n' + projectInstructions : '',
    '',
    '请输出：任务理解、需要修改的文件、实施步骤、风险点、给 Claude CLI 的执行 Prompt。',
    '不要提交 git，不要 push，不要做无关重构。',
  ].join('\n');
}

export function claudeExecutePrompt(job, plan) {
  const projectInstructions = projectInstructionsBlock(job);
  return [
    '你是 HermesOS 的 Claude Executor。',
    '',
    '只允许完成用户明确要求的修改。不要提交 git，不要 push，不要做顺手优化。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    projectInstructions ? '\n项目专用指令：\n' + projectInstructions : '',
    '',
    'Codex Plan：',
    plan,
    '',
    '完成后输出：修改了哪些文件、实现了什么、有什么风险。',
  ].join('\n');
}

export function codexReviewPrompt(job) {
  const projectInstructions = projectInstructionsBlock(job);
  return [
    '你是 HermesOS 的 Codex Reviewer。',
    '',
    '请审查当前 git diff。只审查，不修改文件。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    projectInstructions ? '\n项目专用指令：\n' + projectInstructions : '',
    '',
    '输出格式必须包含：',
    'REVIEW_RESULT: PASS 或 FAIL',
    'RISK: LOW / MEDIUM / HIGH',
    '',
    '然后列出主要发现、风险、是否需要 Claude 修复。',
  ].join('\n');
}
