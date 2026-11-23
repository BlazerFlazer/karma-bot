import { card } from '../core/ui.js';
import { leaders, moderators } from '../core/catalog.js';
import { privateDestination } from './transcript.js';
// Private destinations receive minimal metadata. Answers and evidence stay with the case.
const streams = [
  [/^(mod\.|channel\.)/, 'moderation_logs', moderators],
  [/^(family\.|member\.|role\.|strike\.|blacklist\.|verification)/, 'member_logs', leaders],
  [/^(security\.|task\.failed|settings|bind\.|backup\.|bot\.)/, 'security_logs', leaders],
];
export async function deliverAudit(r, g) {
  const db = r.store,
    bindings = r.config.bindings(g.id, 'channel');
  const cursor = db.one('SELECT cursor FROM audit_delivery WHERE guild=?', g.id)?.cursor || 0;
  const records = db.all(
    'SELECT id,action,actor,target,time FROM audit_logs WHERE guild=? AND id>? ORDER BY id LIMIT 30',
    g.id,
    cursor,
  );
  if (!records.length) return;
  const batches = new Map();
  for (const rec of records) {
    let route = streams.find(([match]) => match.test(rec.action));
    if (/^(ticket|application)\./.test(rec.action)) {
      const ticket = db.one('SELECT policy FROM tickets WHERE guild=? AND id=?', g.id, rec.target);
      if (ticket) {
        const p = JSON.parse(ticket.policy);
        route = [null, p.log, p.access];
      }
    }
    if (!route) continue;
    const [, key, access] = route;
    const channel = bindings[key] || (/^\d{17,20}$/.test(key) ? key : null);
    if (!channel) continue;
    const group = JSON.stringify([channel, access]);
    if (!batches.has(group)) batches.set(group, { channel, access, rows: [] });
    batches.get(group).rows.push(rec);
  }
  for (const { channel, access, rows } of batches.values()) {
    const dest = privateDestination(await g.channels.fetch(channel), g, r.config.roleIds(g.id, access));
    await dest.send({
      ...card(
        'Журнал KARMA',
        rows
          .map(
            (x) =>
              '#' +
              x.id +
              ' · <t:' +
              Math.floor(x.time / 1000) +
              ':t> · ' +
              x.action +
              ' · ' +
              x.actor +
              ' → ' +
              x.target,
          )
          .join('\n'),
      ),
      nonce: 'a' + rows.at(-1).id,
      enforceNonce: true,
    });
  }
  db.run('INSERT OR REPLACE INTO audit_delivery VALUES(?,?)', g.id, records.at(-1).id);
}
