import { requireThat } from '../core/ui.js';
export const publicationTables = {
  event: 'events',
  poll: 'polls',
  giveaway: 'giveaways',
  suggest: 'suggestions',
};
export async function deliverPanel(r, g, data, retry) {
  const { kind, id, payload } = data,
    key = 'publish:' + kind + ':' + id;
  requireThat(Object.hasOwn(publicationTables, kind), 'Неизвестный вид панели.');
  const table = publicationTables[kind],
    record = r.store.one('SELECT channel,message FROM ' + table + ' WHERE guild=? AND id=?', g.id, id);
  if (!record || record.message) return;
  const ch = await g.channels.fetch(record.channel);
  let existing;
  if (retry) {
    const marker = payload.components[0]?.components[0]?.custom_id;
    const recent = await ch.messages.fetch({ limit: 50, cache: false });
    existing = recent.find(
      (m) =>
        m.author.id === g.client.user.id &&
        marker &&
        m.components?.some((row) => row.components.some((c) => c.customId === marker)),
    );
  }
  const message = existing || (await ch.send({ ...payload, nonce: kind + id, enforceNonce: true }));
  r.store.tx(() => {
    r.store.run('UPDATE ' + table + ' SET message=? WHERE guild=? AND id=?', message.id, g.id, id);
    r.store.run('DELETE FROM scheduled_tasks WHERE key=?', key);
  });
}
export async function publishPanel(r, g, kind, id, payload) {
  const data = { kind, id, payload },
    key = 'publish:' + kind + ':' + id;
  r.store.task(key, g.id, 'publish', data, Date.now() + 30000);
  return r.locks.with(key, () => deliverPanel(r, g, data, false));
}
