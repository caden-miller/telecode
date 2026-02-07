import { Octokit } from '@octokit/rest';
import { execFileSync } from 'child_process';
import config from '../config.js';
import { getMainBranch } from './branches.js';

const octokit = new Octokit({ auth: config.githubToken });

export function getRepoInfo(projectPath) {
  const remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: projectPath,
    encoding: 'utf8',
  }).trim();
  const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
  if (!match) throw new Error('Could not parse GitHub repo from remote URL');
  return { owner: match[1], repo: match[2] };
}

export async function getIssue(projectPath, issueNumber) {
  const { owner, repo } = getRepoInfo(projectPath);
  try {
    const { data } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
    return {
      number: data.number,
      title: data.title,
      body: data.body || 'No description provided',
      labels: data.labels.map(l => (typeof l === 'string' ? l : l.name)),
    };
  } catch (err) {
    console.error(`Failed to fetch issue #${issueNumber}:`, err.message);
    return null;
  }
}

export async function createPR(projectPath, branchName, { prompt, issueNumber, issueData, filesChanged }) {
  const { owner, repo } = getRepoInfo(projectPath);
  const mainBranch = getMainBranch(projectPath);

  const title = issueNumber
    ? `Fix #${issueNumber}: ${issueData?.title || prompt}`
    : (prompt.length > 72 ? prompt.substring(0, 69) + '...' : prompt);

  const body = [
    issueNumber ? `Closes #${issueNumber}` : null,
    '## Changes',
    filesChanged.map(f => `- \`${f}\``).join('\n'),
    '\n---\n_Automated by claude-service_',
  ].filter(Boolean).join('\n\n');

  try {
    const { data } = await octokit.pulls.create({
      owner, repo,
      title,
      head: branchName,
      base: mainBranch,
      body,
    });
    return data.html_url;
  } catch (err) {
    console.error('Failed to create PR:', err.message);
    return null;
  }
}
