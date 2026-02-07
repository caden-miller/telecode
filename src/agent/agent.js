import { query } from '@anthropic-ai/claude-agent-sdk';
import config from '../config.js';
import * as sessions from '../sessions/sessions.js';
import * as github from '../github/github.js';
import * as branches from '../github/branches.js';
import * as git from '../git/git.js';
import { buildPrompt, SYSTEM_PROMPT_CONFIG } from './prompts.js';
import { createHooks } from './hooks.js';
import * as fmt from '../bot/formatter.js';

export async function runWorkflow(parsed, sendMessage) {
  const { project, branchType, issueNumber, prompt: rawPrompt } = parsed;
  const projectPath = config.projects[project];

  const session = sessions.create(project, { branchType, issueNumber });

  try {
    // 1. Fetch issue if needed
    let issueData = null;
    if (issueNumber) {
      issueData = await github.getIssue(projectPath, issueNumber);
      session.issueTitle = issueData?.title;
    }

    // 2. Determine prompt
    const prompt = issueData
      ? `Fix issue #${issueNumber}: ${issueData.title}`
      : rawPrompt;

    // 3. Create branch
    const type = branchType || (prompt.match(/\b(add|implement|create)\b/i) ? 'feature' : 'fix');
    const branchName = await branches.create(projectPath, {
      branchType: type,
      issueNumber,
      prompt,
    });
    session.branchName = branchName;
    await sendMessage(fmt.branchCreated(branchName));

    // 4. Run Claude Agent SDK
    const hooks = createHooks(session, sendMessage);
    const enhancedPrompt = buildPrompt(prompt, issueData);

    let result = null;
    for await (const message of query({
      prompt: enhancedPrompt,
      options: {
        cwd: projectPath,
        systemPrompt: SYSTEM_PROMPT_CONFIG,
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Task'],
        maxTurns: 50,
        maxBudgetUsd: 5.0,
        hooks,
        abortController: session.abortController,
      }
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if ('name' in block) session.lastTool = block.name;
        }
      }
      if (message.type === 'result') {
        result = message;
      }
    }

    // 5. Check for changes
    if (!git.hasChanges(projectPath)) {
      await sendMessage('No changes made. Cleaning up branch.');
      git.cleanupBranch(projectPath, branchName);
      return;
    }

    const filesChanged = git.getChangedFiles(projectPath);
    session.filesModified = filesChanged.length;

    // 6. Commit, push, PR
    git.commitAll(projectPath, prompt, issueNumber);
    git.push(projectPath, branchName);

    const prUrl = await github.createPR(projectPath, branchName, {
      prompt,
      issueNumber,
      issueData,
      filesChanged,
    });
    session.prUrl = prUrl;

    // 7. Final summary
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
    await sendMessage(fmt.complete({
      project,
      branchName,
      prUrl,
      filesModified: filesChanged.length,
      elapsed,
      cost: result?.total_cost_usd || 0,
    }));

  } catch (err) {
    await sendMessage(fmt.error(err));
    throw err;
  } finally {
    sessions.remove(project);
  }
}
