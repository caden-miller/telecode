import config from './config.js';
import bot from './bot/bot.js';
import { register } from './bot/commands.js';
import express from 'express';
import * as sessions from './sessions/sessions.js';

// Register bot commands
register(bot);

// Drop any pending updates then start polling
await bot.api.deleteWebhook({ drop_pending_updates: true });

bot.start({
  onStart: () => {
    console.log(`Bot started. Projects: ${Object.keys(config.projects).join(', ')}`);
  },
});

// Graceful shutdown — release the polling lock
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received, stopping bot...`);
    bot.stop();
    process.exit(0);
  });
}

// Health-check HTTP server
const app = express();
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    activeSessions: sessions.listActive(),
    projects: Object.keys(config.projects),
  });
});

app.listen(config.port, () => {
  console.log(`Health endpoint on :${config.port}`);
});
