import 'dotenv/config';

const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN'];

function loadProjects() {
  const projects = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PROJECT_')) {
      const name = key.replace('PROJECT_', '').toLowerCase().replace(/_/g, '-');
      projects[name] = value;
    }
  }
  return projects;
}

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const projects = loadProjects();
if (!Object.keys(projects).length) {
  console.error('No PROJECT_* vars defined in .env');
  process.exit(1);
}

export default Object.freeze({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  githubToken: process.env.GITHUB_TOKEN,
  githubUsername: process.env.GITHUB_USERNAME,
  port: parseInt(process.env.PORT || '3000', 10),
  projects,
});
