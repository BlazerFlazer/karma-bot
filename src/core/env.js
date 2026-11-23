import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ quiet: true });
export const dataDir = resolve(process.env.DATA_DIR || 'data');
export const membersIntent = process.env.MEMBERS_INTENT === 'true';
export const contentIntent = process.env.MESSAGE_CONTENT_INTENT === 'true';
export function credentials(deploy = false) {
  const token = process.env.DISCORD_TOKEN?.trim();
  const app = process.env.APPLICATION_ID?.trim();
  const guild = process.env.GUILD_ID?.trim();
  if (!token) throw new Error('Задайте DISCORD_TOKEN в окружении.');
  if (deploy && !/^\d{17,20}$/.test(app || '')) throw new Error('Проверьте APPLICATION_ID.');
  if (guild && !/^\d{17,20}$/.test(guild)) throw new Error('Проверьте GUILD_ID.');
  return { token, app, guild };
}
