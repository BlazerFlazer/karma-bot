import { PermissionFlagsBits as P, OverwriteType } from 'discord.js';
import { requireThat, safeMentions } from '../core/ui.js';
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function privateDestination(channel, guild, allowedRoles) {
  requireThat(
    channel?.type === 0 && channel.guild.id === guild.id,
    'Настройте закрытый текстовый канал журнала.',
  );
  const everyone = channel.permissionOverwrites.cache.get(guild.id);
  requireThat(
    everyone?.deny.has(P.ViewChannel) && !channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel),
    'В журнале нужен явный запрет просмотра для @everyone.',
  );
  for (const o of channel.permissionOverwrites.cache.values()) {
    if (!o.allow.has(P.ViewChannel)) continue;
    const privileged =
      o.type === OverwriteType.Role && guild.roles.cache.get(o.id)?.permissions.has(P.Administrator);
    requireThat(
      o.id === guild.client.user.id ||
        o.id === guild.ownerId ||
        privileged ||
        (o.type === OverwriteType.Role && allowedRoles.includes(o.id)),
      'В журнале есть посторонние разрешения просмотра. Проверьте доступ.',
    );
  }
  requireThat(
    channel.permissionsFor(guild.members.me).has([P.SendMessages, P.AttachFiles, P.ViewChannel]),
    'Боту нужен доступ для отправки файлов в журнал.',
  );
  return channel;
}
export async function transcript(r, t, channel) {
  const p = JSON.parse(t.policy),
    g = channel.guild,
    ids = r.config.bindings(g.id, 'channel');
  const dest = privateDestination(
    await g.channels.fetch(ids[p.log] || p.log).catch(() => null),
    g,
    r.config.roleIds(g.id, p.access),
  );
  const chunks = [];
  let before,
    bytes = 0,
    count = 0,
    limited = false;
  while (count < 300 && !limited) {
    const page = await channel.messages.fetch({ limit: 50, before, cache: false });
    if (!page.size) break;
    for (const m of page.values()) {
      const part =
        '<article><small>' +
        escapeHtml(m.createdAt.toISOString()) +
        ' · ' +
        escapeHtml(m.author.username) +
        '</small><p>' +
        escapeHtml((m.content || '').slice(0, 4000)) +
        '</p>' +
        [...m.attachments.values()]
          .slice(0, 5)
          .map((a) => '<span>Вложение: ' + escapeHtml(a.name) + '</span>')
          .join(' ') +
        '</article>';
      bytes += Buffer.byteLength(part);
      if (bytes > 480000) {
        limited = true;
        break;
      }
      chunks.push(part);
      count++;
    }
    before = page.last().id;
    if (page.size < 50) break;
  }
  const form = Object.entries(JSON.parse(t.answers))
    .map(
      ([k, v]) =>
        '<p><b>' +
        escapeHtml(p.questions.find((q) => q.key === k)?.label || k) +
        '</b><br>' +
        escapeHtml(v) +
        '</p>',
    )
    .join('');
  const html =
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>KARMA #' +
    t.id +
    '</title><style>body{background:#17181a;color:#eee;max-width:48rem;margin:3rem auto;padding:1rem;font:16px system-ui}article{border-top:1px solid #494949;padding:1rem 0}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#bbb}</style><h1>KARMA · Обращение #' +
    t.id +
    '</h1><p>Инициатор ' +
    escapeHtml(t.author) +
    '</p>' +
    form +
    '<p>Последние сообщения: ' +
    count +
    '. Текст доступен в пределах разрешений Discord.</p>' +
    chunks.reverse().join('') +
    '</html>';
  const msg = await dest.send({
    files: [{ attachment: Buffer.from(html), name: 'karma-' + t.id + '.html' }],
    allowedMentions: safeMentions,
  });
  r.store.run('UPDATE tickets SET transcript=? WHERE id=?', msg.id, t.id);
  const days = r.config.settings(g.id).retentionDays;
  r.store.task(
    'transcript:' + msg.id,
    g.id,
    'deleteMessage',
    { channel: dest.id, message: msg.id },
    Date.now() + days * 86400000,
  );
  return msg;
}
