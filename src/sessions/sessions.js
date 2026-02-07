const active = new Map();

export function create(project, { branchType, issueNumber }) {
  const session = {
    project,
    startTime: Date.now(),
    branchType,
    issueNumber,
    branchName: null,
    prUrl: null,
    editedFiles: new Set(),
    filesModified: 0,
    lastTool: null,
    issueTitle: null,
    abortController: new AbortController(),
  };
  active.set(project, session);
  return session;
}

export function get(project) {
  return active.get(project);
}

export function isActive(project) {
  return active.has(project);
}

export function remove(project) {
  active.delete(project);
}

export function cancel(project) {
  const session = active.get(project);
  if (!session) return false;
  session.abortController.abort();
  active.delete(project);
  return true;
}

export function listActive() {
  return Array.from(active.values()).map(s => ({
    project: s.project,
    elapsed: Math.floor((Date.now() - s.startTime) / 1000),
    filesModified: s.editedFiles.size,
    branchName: s.branchName,
  }));
}
