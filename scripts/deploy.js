import { REST, Routes } from 'discord.js';
import { register } from '../src/core/app.js';
import { credentials } from '../src/core/env.js';
import { InteractionRouter } from '../src/core/router.js';
try {
  const { token, app, guild } = credentials(true);
  const r = register(new InteractionRouter({}));
  const rest = new REST({ version: '10', retries: 2 }).setToken(token);
  await rest.put(guild ? Routes.applicationGuildCommands(app, guild) : Routes.applicationCommands(app), {
    body: guild ? r.commands.map(({ contexts, integration_types, ...definition }) => definition) : r.commands,
  });
  console.log('Зарегистрировано команд:', r.commands.length);
} catch (e) {
  console.error(
    e.message?.startsWith('Задайте') || e.message?.startsWith('Проверьте')
      ? e.message
      : 'Регистрация не удалась. Проверьте Application ID, токен и установку бота.',
    e.code || '',
  );
  process.exitCode = 1;
}
