import { Bot } from 'grammy';
import config from '../config.js';

const bot = new Bot(config.telegramToken);

// Only respond to authorized chat
bot.use(async (ctx, next) => {
  if (String(ctx.chat?.id) !== config.chatId) return;
  await next();
});

export default bot;
