import { execFileSync } from 'child_process';

export function getMainBranch(projectPath) {
  try {
    const branches = execFileSync('git', ['branch', '-a'], { cwd: projectPath, encoding: 'utf8' });
    if (branches.includes('remotes/origin/main')) return 'main';
    if (branches.includes('remotes/origin/master')) return 'master';
    return 'main';
  } catch {
    return 'main';
  }
}

function slugify(text, maxLen = 40) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, maxLen)
    .replace(/-$/, '');
}

export async function create(projectPath, { branchType, issueNumber, prompt }) {
  const main = getMainBranch(projectPath);

  execFileSync('git', ['checkout', main], { cwd: projectPath, stdio: 'pipe' });
  try {
    execFileSync('git', ['pull', 'origin', main], { cwd: projectPath, stdio: 'pipe' });
  } catch { /* offline is fine */ }

  let branchName;
  if (issueNumber) {
    branchName = `fix/${issueNumber}`;
  } else {
    const slug = slugify(prompt);
    branchName = `${branchType}/${slug || 'update'}`;
  }

  // Handle pre-existing branch (fixes conflict from commit eadcab8)
  try {
    execFileSync('git', ['rev-parse', '--verify', branchName], { cwd: projectPath, stdio: 'pipe' });
    execFileSync('git', ['branch', '-D', branchName], { cwd: projectPath, stdio: 'pipe' });
  } catch { /* doesn't exist, good */ }

  execFileSync('git', ['checkout', '-b', branchName], { cwd: projectPath, stdio: 'pipe' });
  return branchName;
}
