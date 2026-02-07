export function starting({ project, branchType, prompt, issueNumber }) {
  const task = issueNumber ? `Fix #${issueNumber}` : prompt;
  return `Starting ${project}...\nTask: ${task}`;
}

export function branchCreated(branchName) {
  return `Branch: \`${branchName}\``;
}

export function progress({ elapsed, filesModified, currentActivity }) {
  return `[${elapsed}s] ${currentActivity || 'Working...'}\nFiles: ${filesModified}`;
}

export function complete({ project, branchName, prUrl, filesModified, elapsed, cost }) {
  return [
    `Done: ${project}`,
    `Branch: \`${branchName}\``,
    `Files: ${filesModified}`,
    `Time: ${elapsed}s | Cost: $${cost.toFixed(3)}`,
    prUrl ? `PR: ${prUrl}` : null,
  ].filter(Boolean).join('\n');
}

export function error(err) {
  return `Error: ${err.message || err}`;
}

export function busy(project) {
  return `${project} already has an active session.`;
}

export function status(activeSessions) {
  return activeSessions.map(s =>
    `${s.project}: ${s.elapsed}s, ${s.filesModified} files${s.branchName ? ` (${s.branchName})` : ''}`
  ).join('\n');
}

export function projectList(projects) {
  return Object.keys(projects).join(', ');
}
