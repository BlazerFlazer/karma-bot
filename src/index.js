import { Events } from 'discord.js';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from './core/app.js';
import { credentials } from './core/env.js';
import { connectGateway } from './modules/security.js';
async function main() {
  const { token } = credentials(),
    r = app();
  let started = false,
    control;
  if (process.env.WEB_DASHBOARD_ENABLED === 'true') {
    const { controlServer } = await import('./control/server.js');
    control = controlServer(r);
    await control.listen();
    r.log('control.listening');
  }
  r.connect();
  connectGateway(r);
  r.client.once(Events.ClientReady, () => {
    try {
      r.scheduler.start();
      started = true;
      for (const g of r.client.guilds.cache.values())
        r.store.audit(g.id, 'bot.ready', r.client.user.id, g.id);
      r.log('ready');
    } catch (e) {
      r.log('startup', e);
      void stop(1);
    }
  });
  r.client.on(Events.Error, (e) => r.log('discord', e));
  r.client.on(Events.ShardDisconnect, () => {
    r.store.run('UPDATE voice_sessions SET ended=last_seen WHERE ended IS NULL');
  });
  r.client.on(Events.ShardResume, () => {
    if (started && !r.scheduler.running) r.scheduler.recover();
  });
  async function stop(code = 0) {
    if (r.stopping) return;
    r.stopping = true;
    r.scheduler.stop();
    if (control) await control.close();
    r.client.removeAllListeners(Events.InteractionCreate);
    const deadline = Date.now() + 20000;
    while ((r.busy || r.scheduler.running || r.gatewayBusy) && Date.now() < deadline) await delay(100);
    await r.client.destroy();
    r.store.run('UPDATE voice_sessions SET ended=last_seen WHERE ended IS NULL');
    r.store.close();
    r.log('shutdown');
    process.exitCode = code;
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  process.on('unhandledRejection', (e) => {
    r.log('unhandled', e);
    void stop(1);
  });
  try {
    await r.client.login(token);
  } catch (e) {
    r.log('login', e);
    await stop(1);
  }
}
main().catch((e) => {
  console.error(
    e.message?.startsWith('Задайте') || e.message?.startsWith('Проверьте')
      ? e.message
      : 'Ошибка запуска KARMA SYSTEM.',
  );
  process.exitCode = 1;
});
