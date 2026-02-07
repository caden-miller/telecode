import config from '../config.js';
import * as sessions from '../sessions/sessions.js';
import { runWorkflow } from '../agent/agent.js';
import * as fmt from './formatter.js';

function parseCommand(text, defaultBranchType) {
  if (!text?.trim()) {
    return { error: 'Usage: /fix <project> <issue#>\n/feat <project> <description>\n/code <project> <prompt>' };
  }

  const words = text.trim().split(/\s+/);
  const project = words[0];

  if (!config.projects[project]) {
    return { error: `Unknown project: ${project}\nAvailable: ${Object.keys(config.projects).join(', ')}` };
  }

  let branchType = defaultBranchType;
  let issueNumber = null;
  let promptWords = words.slice(1);

  // /fix project 23 → fix issue #23
  if (branchType === 'fix' && promptWords.length === 1 && /^\d+$/.test(promptWords[0])) {
    issueNumber = parseInt(promptWords[0], 10);
    return { project, branchType, issueNumber, prompt: null };
  }

  // /fix project some description → fix with description
  // /feat project some description → feature with description
  // /code project some description → auto-detect
  const prompt = promptWords.join(' ');
  if (!prompt && !issueNumber) {
    return { error: 'Need a prompt or issue number.\nE.g.: /fix gthrly 23\n/feat gthrly add dark mode' };
  }

  return { project, branchType, issueNumber, prompt };
}

export function register(bot) {
  bot.command('fix', async (ctx) => {
    const parsed = parseCommand(ctx.match, 'fix');
    await handleCodeCommand(ctx, parsed);
  });

  bot.command('feat', async (ctx) => {
    const parsed = parseCommand(ctx.match, 'feature');
    await handleCodeCommand(ctx, parsed);
  });

  bot.command('code', async (ctx) => {
    const parsed = parseCommand(ctx.match, null);
    await handleCodeCommand(ctx, parsed);
  });

  bot.command('status', async (ctx) => {
    const active = sessions.listActive();
    await ctx.reply(active.length ? fmt.status(active) : 'No active sessions.');
  });

  bot.command('cancel', async (ctx) => {
    const project = ctx.match?.trim();
    if (!project) return ctx.reply('Usage: /cancel <project>');
    const cancelled = sessions.cancel(project);
    await ctx.reply(cancelled ? `Cancelled ${project}.` : `No active session for ${project}.`);
  });

  bot.command('projects', async (ctx) => {
    await ctx.reply(fmt.projectList(config.projects));
  });
}

async function handleCodeCommand(ctx, parsed) {
  if (parsed.error) return ctx.reply(parsed.error);

  if (sessions.isActive(parsed.project)) {
    return ctx.reply(fmt.busy(parsed.project));
  }

  await ctx.reply(fmt.starting(parsed));

  const sendMessage = (msg) => ctx.reply(msg, { parse_mode: 'Markdown' });

  runWorkflow(parsed, sendMessage).catch(err => {
    console.error('Workflow failed:', err);
  });
}
