import { execFileSync } from 'child_process';
import { getMainBranch } from '../github/branches.js';

export function hasChanges(cwd) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return status.trim().length > 0;
}

export function getChangedFiles(cwd) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return status.trim().split('\n')
    .filter(Boolean)
    .map(line => line.substring(3).trim());
}

export function commitAll(cwd, prompt, issueNumber) {
  execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' });
  const msg = issueNumber ? `Fix #${issueNumber}: ${prompt}` : prompt;
  execFileSync('git', ['commit', '-m', msg], { cwd, stdio: 'pipe' });
}

export function push(cwd, branchName) {
  execFileSync('git', ['push', '-u', 'origin', branchName], { cwd, stdio: 'pipe' });
}

export function cleanupBranch(cwd, branchName) {
  const main = getMainBranch(cwd);
  execFileSync('git', ['checkout', main], { cwd, stdio: 'pipe' });
  execFileSync('git', ['branch', '-D', branchName], { cwd, stdio: 'pipe' });
}
