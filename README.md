<div align="center">

# telecode

**Autonomous coding agent you control from your phone.**

[![Node.js](https://img.shields.io/badge/Node.js-24+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Claude Agent SDK](https://img.shields.io/badge/Claude_Agent_SDK-0.1+-cc785c?logo=anthropic&logoColor=white)](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
[![Telegram](https://img.shields.io/badge/Telegram_Bot-grammy-26A5E4?logo=telegram&logoColor=white)](https://grammy.dev)
[![GitHub API](https://img.shields.io/badge/GitHub-Octokit-181717?logo=github&logoColor=white)](https://github.com/octokit/rest.js)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

Text a command from Telegram &rarr; Claude writes the code &rarr; commits, pushes, opens a PR &rarr; sends you the link.

</div>

## How It Works

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐     ┌──────────┐
│ Telegram │───▶│  grammy bot  │────▶│  Claude Agent SDK│───▶│  GitHub   │
│  (phone) │◀───│  commands.js │◀────│  agent.js        │◀───│  PR/Issue │
└──────────┘     └──────────────┘     └──────────────────┘     └──────────┘
                        │                      │
                        │              ┌───────┴───────┐
                        │              │  PostToolUse  │
                        │              │  hooks track  │
                        └──────────────│  file edits & │
                         progress msgs │  send updates │
                                       └───────────────┘
```

**Full pipeline for every request:**

1. You send a Telegram command (e.g. `/fix myapp 23`)
2. Bot fetches the GitHub issue, creates a branch (`fix/23`)
3. Claude Agent SDK runs autonomously in the project directory
4. PostToolUse hooks track every file edit and send you progress
5. Orchestrator commits, pushes, and opens a PR referencing the issue
6. You get a concise summary with the PR link

## Quick Start

```bash
# Clone & install
git clone https://github.com/caden-miller/claude-service.git
cd claude-service
npm install

# Configure
cp .env.example .env
# Fill in your tokens (see Configuration below)

# Run
npm start
```

## Configuration

Create a `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456:ABC...        # from @BotFather
TELEGRAM_CHAT_ID=your_user_id           # from @userinfobot
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=your-github-user
PORT=3000

# Projects — add as many as you want
# Format: PROJECT_NAME=C:\path\to\repo
PROJECT_MY_APP=C:\Users\you\projects\my-app
PROJECT_WEBSITE=C:\Users\you\projects\website
```

> **Tip:** Create a dedicated Telegram bot for this service. If you already use a bot token for something else (e.g. Home Assistant), Telegram will reject duplicate long-polling connections.

## Telegram Commands

| Command | Example | What happens |
|---------|---------|-------------|
| `/fix` | `/fix myapp 23` | Fetches issue #23, creates `fix/23` branch, fixes it, opens PR with `Closes #23` |
| `/feat` | `/feat myapp add dark mode` | Creates `feature/add-dark-mode` branch, implements it, opens PR |
| `/code` | `/code myapp refactor auth` | Auto-detects fix vs feature, implements, opens PR |
| `/status` | `/status` | Shows active sessions with elapsed time and file counts |
| `/cancel` | `/cancel myapp` | Aborts the running agent for that project |
| `/projects` | `/projects` | Lists all configured projects |

### What You'll See

```
Starting myapp...
Task: Fix #23

Branch: `fix/23`

[32s] Edit | 3 files

Done: myapp
Branch: `fix/23`
Files: 3
Time: 87s | Cost: $0.423
PR: https://github.com/you/myapp/pull/42
```

## Architecture

```
src/
├── index.js                 # Entry — boots bot + health server
├── config.js                # Env loading, project registry
├── bot/
│   ├── bot.js               # Grammy instance + auth middleware
│   ├── commands.js           # /fix, /feat, /code, /status, /cancel
│   └── formatter.js          # Concise Telegram message templates
├── agent/
│   ├── agent.js              # Core workflow orchestrator (SDK query)
│   ├── hooks.js              # PostToolUse file tracking + progress
│   └── prompts.js            # Prompt construction + system prompt
├── github/
│   ├── github.js             # Octokit — issues, PRs
│   └── branches.js           # Branch creation + main detection
├── git/
│   └── git.js                # Status, commit, push, cleanup
└── sessions/
    └── sessions.js           # Active session tracking + AbortController
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Agent SDK over CLI spawn** | Structured results (cost, turns, duration), hooks, abort support — no stdout parsing |
| **Grammy long polling** | No webhook, no ngrok, no public IP. Just works from any machine with internet |
| **Agent doesn't touch git** | System prompt tells Claude to only write code. Orchestrator handles branch/commit/push/PR deterministically |
| **PostToolUse hooks** | Get `tool_input.file_path` on every Write/Edit — 100% reliable vs regex on stdout |
| **execFileSync over execSync** | Prevents shell injection by avoiding shell interpretation of arguments |
| **AbortController per session** | `/cancel` cleanly stops a running agent mid-execution |

### Safety Limits

| Limit | Value |
|-------|-------|
| Max turns per run | 50 |
| Max cost per run | $5.00 |
| Concurrent sessions | 1 per project |
| Auth | Telegram chat ID whitelist |

## Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "running",
  "activeSessions": [],
  "projects": ["my-app", "website"]
}
```

## Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| AI Agent | `@anthropic-ai/claude-agent-sdk` | Autonomous coding with Claude |
| Telegram | `grammy` | Bot framework with long polling |
| GitHub | `@octokit/rest` | Issue fetching, PR creation |
| HTTP | `express` | Health check endpoint |
| Config | `dotenv` | Environment variables |
