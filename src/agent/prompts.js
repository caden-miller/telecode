export const SYSTEM_PROMPT_CONFIG = {
  type: 'preset',
  preset: 'claude_code',
  append: `
After completing your work, do NOT commit, push, or create PRs.
Only make the code changes. The orchestrator handles git operations.
Follow existing project patterns. Write production-ready code.`,
};

export function buildPrompt(prompt, issueData) {
  const parts = [prompt];

  if (issueData) {
    parts.push(`\nGitHub Issue #${issueData.number}: ${issueData.title}`);
    if (issueData.body) {
      parts.push(`\nIssue description:\n${issueData.body}`);
    }
    if (issueData.labels?.length) {
      parts.push(`Labels: ${issueData.labels.join(', ')}`);
    }
  }

  return parts.join('\n');
}
