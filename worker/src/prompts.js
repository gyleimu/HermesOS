export function codexPlanPrompt(job) {
  return [
    '你是 HermesOS 的 Codex Planner。',
    '',
    '这一步只规划，不修改文件。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    '',
    '请输出：任务理解、需要修改的文件、实施步骤、风险点、给 Claude CLI 的执行 Prompt。',
    '不要提交 git，不要 push，不要做无关重构。',
  ].join('\n');
}

export function claudeExecutePrompt(job, plan) {
  return [
    '你是 HermesOS 的 Claude Executor。',
    '',
    '只允许完成用户明确要求的修改。不要提交 git，不要 push，不要做顺手优化。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    '',
    'Codex Plan：',
    plan,
    '',
    '完成后输出：修改了哪些文件、实现了什么、有什么风险。',
  ].join('\n');
}

export function codexReviewPrompt(job) {
  return [
    '你是 HermesOS 的 Codex Reviewer。',
    '',
    '请审查当前 git diff。只审查，不修改文件。',
    `用户目标：${job.session?.user_goal || job.input?.instruction || job.input?.summary || ''}`,
    '',
    '输出格式必须包含：',
    'REVIEW_RESULT: PASS 或 FAIL',
    'RISK: LOW / MEDIUM / HIGH',
    '',
    '然后列出主要发现、风险、是否需要 Claude 修复。',
  ].join('\n');
}
