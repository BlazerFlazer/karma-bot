import { Events, AuditLogEvent, PermissionFlagsBits as P } from 'discord.js';
import { cmd, sub } from '../core/router.js';
import { card, row, button, respond } from '../core/ui.js';
import { management } from '../core/access.js';
import { leaders } from '../core/catalog.js';
import { privateDestination } from '../services/transcript.js';
import { publicRole, reactionRole } from './roles.js';
import { voiceUpdate } from './activity.js';
const timed = new Map();
export function pulse(key, limit, ms, now = Date.now()) {
  const rec = timed.get(key);
  if (!rec || now - rec.start >= ms) {
    if (timed.size >= 4096) timed.delete(timed.keys().next().value);
    timed.set(key, { start: now, n: 1 });
    return limit === 1;
  }
  rec.n++;
  return rec.n === limit;
}
export function cleanWindows() {
  const now = Date.now();
  for (const [k, v] of timed) if (now - v.start > 600000) timed.delete(k);
}
export async function privatePost(r, g, key, payload, keys = leaders) {
  const id = r.config.bindings(g.id, 'channel')[key];
  if (!id) return false;
  const c = privateDestination(await g.channels.fetch(id), g, r.config.roleIds(g.id, keys));
  await c.send(payload);
  return true;
}
export function scrub(text) {
  return String(text || '')
    .replace(/(?:https?:\/\/[^\s/]+\/api(?:\/v\d+)?\/webhooks\/\d+\/)[^\s]+/gi, '[webhook]')
    .replace(/[\w-]{18,}\.[\w-]{5,}\.[\w-]{16,}/g, '[секрет]')
    .replace(/(?:token|password|пароль|токен|authorization|cookie)\s*[:=]\s*\S+/gi, '[секрет]')
    .slice(0, 500);
}
export function installSecurity(r) {
  r.command(
    cmd(
      'security',
      'Защита сервера',
      sub('lockdown', 'Ограничить запись в публичных семейных каналах'),
      sub('release', 'Снять аварийные ограничения'),
    ),
    (i) => {
      management(i);
      const action = i.options.getSubcommand();
      return r.preview(
        i,
        'security.lock',
        { action },
        action === 'release'
          ? 'Восстановить прежние права записи?'
          : 'Закрыть запись для @everyone в настроенных каналах объявлений, мероприятий, каптов и предложений?',
      );
    },
    { module: 'security' },
  );
  r.confirm('security.lock', async (i, { action }) => {
    management(i);
    r.enabled(i, 'security');
    return r.locks.with('lockdown:' + i.guildId, async () => {
      const b = r.config.bindings(i.guildId, 'channel'),
        db = r.store;
      const ids =
        action === 'release'
          ? db.all('SELECT channel FROM security_locks WHERE guild=?', i.guildId).map((x) => x.channel)
          : [
              ...new Set(
                ['family_announcements', 'events', 'captures', 'suggestions']
                  .map((k) => b[k])
                  .filter(Boolean),
              ),
            ];
      let count = 0;
      for (const id of ids) {
        const c = await i.guild.channels.fetch(id);
        if (!c?.permissionOverwrites) continue;
        const old = db.one('SELECT previous FROM security_locks WHERE guild=? AND channel=?', i.guildId, id);
        if (action === 'release') {
          if (!old) continue;
          await c.permissionOverwrites.edit(i.guild.roles.everyone, {
            SendMessages: old.previous === null ? null : !!old.previous,
          });
          db.run('DELETE FROM security_locks WHERE guild=? AND channel=?', i.guildId, id);
        } else {
          const o = c.permissionOverwrites.cache.get(i.guildId);
          if (!old)
            db.run(
              'INSERT INTO security_locks VALUES(?,?,?)',
              i.guildId,
              id,
              o?.allow.has(P.SendMessages) ? 1 : o?.deny.has(P.SendMessages) ? 0 : null,
            );
          await c.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
        }
        count++;
      }
      db.audit(i.guildId, 'security.' + action, i.user.id, i.guildId, { count });
      return respond(
        i,
        'Обработано каналов: ' + count + '. Индивидуальные разрешения Discord продолжают действовать.',
      );
    });
  });
}
export function connectGateway(r) {
  const on = (event, fn) =>
    r.client.on(event, (...args) => {
      if (r.stopping) return;
      r.gatewayBusy = (r.gatewayBusy || 0) + 1;
      Promise.resolve()
        .then(() => fn(...args))
        .catch((e) => r.log(event, e))
        .finally(() => r.gatewayBusy--);
    });
  async function alert(g, label, target) {
    r.store.audit(g.id, 'security.alert', r.client.user.id, target, { label });
    await privatePost(r, g, 'security_logs', card('KARMA Security', label + ' · ' + target));
  }
  on(Events.MessageCreate, async (m) => {
    if (!m.guild || m.author.bot) return;
    const db = r.store,
      t = db.one(
        "SELECT id,policy,author,first_response FROM tickets WHERE channel=? AND state='open'",
        m.channelId,
      );
    if (t) {
      db.run('UPDATE tickets SET updated=? WHERE id=?', Date.now(), t.id);
      const p = JSON.parse(t.policy);
      if (
        !t.first_response &&
        m.author.id !== t.author &&
        m.member &&
        (m.member.permissions.has(P.Administrator) ||
          r.config.roleIds(m.guildId, p.access).some((id) => m.member.roles.cache.has(id)))
      )
        db.run(
          'UPDATE tickets SET first_response=?,first_responder=? WHERE id=? AND first_response IS NULL',
          Date.now(),
          m.author.id,
          t.id,
        );
      if (p.autoClose)
        db.task(
          'autoclose:' + t.id,
          m.guildId,
          'autoclose',
          { id: t.id },
          Date.now() + p.autoClose * 3600000,
        );
    }
    if (!r.config.enabled(m.guildId, 'security')) return;
    const cfg = r.config.settings(m.guildId),
      u = m.author.id;
    if (
      m.member?.permissions.has(P.Administrator) ||
      cfg.trustedUsers.includes(u) ||
      cfg.trustedRoles.some((id) => m.member?.roles.cache.has(id))
    )
      return;
    const content = m.content.toLowerCase(),
      reason = [];
    if (pulse('flood:' + m.guildId + u, cfg.floodLimit || 8, 8000)) reason.push('Флуд');
    if (content && pulse('spam:' + m.guildId + u + content.slice(0, 60), 4, 15000))
      reason.push('Повтор сообщений');
    if (m.mentions.users.size + m.mentions.roles.size >= (cfg.mentionLimit || 6))
      reason.push('Массовые упоминания');
    if (cfg.antiInvite && /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(content))
      reason.push('Приглашение');
    if (cfg.bannedWords.some((w) => content.includes(w.toLowerCase()))) reason.push('Фильтр слов');
    const links = content.match(/https?:\/\/[^\s<>]+/gi) || [];
    if (
      links.slice(0, 16).some((s) => {
        try {
          const h = new URL(s).hostname;
          return cfg.blockedDomains.some((d) => h === d || h.endsWith('.' + d));
        } catch {
          return false;
        }
      })
    )
      reason.push('Фильтр ссылок');
    if (reason.length) {
      if (cfg.securityDelete && m.deletable) await m.delete();
      if (pulse('alert:' + m.guildId + u, 1, 30000)) await alert(m.guild, reason.join(', '), u);
    }
  });
  on(Events.GuildCreate, (g) => {
    r.store.guild(g.id);
    r.store.task('feed:' + g.id, g.id, 'auditFeed', {}, Date.now() + 15000);
    r.store.task('weekly:' + g.id, g.id, 'weekly', {}, Date.now() + 7 * 86400000);
  });
  on(Events.GuildMemberAdd, async (m) => {
    if (m.user.bot) return;
    const g = m.guild,
      cfg = r.config.settings(g.id),
      b = r.config.bindings(g.id, 'channel');
    r.store.guild(g.id);
    r.store.audit(g.id, 'member.join', m.id, m.id);
    if (r.config.enabled(g.id, 'security') && pulse('join:' + g.id, cfg.raidLimit || 10, 15000))
      await alert(g, 'Массовый вход участников', g.id);
    if (cfg.autoRole && r.config.enabled(g.id, 'roles'))
      await m.roles.add(await publicRole(r, g, cfg.autoRole));
    if (b.welcome && r.config.enabled(g.id, 'welcome')) {
      const c = await g.channels.fetch(b.welcome),
        payload = card(
          'Добро пожаловать в KARMA',
          (cfg.welcomeText || 'Добро пожаловать, {user}!').replaceAll('{user}', '<@' + m.id + '>') +
            '\nУчастников: ' +
            g.memberCount +
            (b.rules ? ' · Правила <#' + b.rules + '>' : ''),
          [row(button('tstart:join', 'Вступить в семью', 1), button('tstart:support', 'Поддержка'))],
          cfg,
        );
      payload.embeds[0].thumbnail = { url: m.user.displayAvatarURL() };
      await c.send(payload);
    }
  });
  on(Events.GuildMemberRemove, async (m) => {
    const g = m.guild;
    r.store.audit(g.id, 'member.leave', m.id, m.id);
    const b = r.config.bindings(g.id, 'channel');
    if (b.goodbye && r.config.enabled(g.id, 'welcome'))
      await (
        await g.channels.fetch(b.goodbye)
      ).send(
        card(
          'Участник покинул сервер',
          (r.config.settings(g.id).goodbyeText || '{user} покинул сервер.').replaceAll(
            '{user}',
            m.user.username,
          ),
        ),
      );
  });
  on(Events.VoiceStateUpdate, (_, state) => voiceUpdate(r, state));
  on(Events.GuildMemberUpdate, (before, after) => {
    const old = before.roles.cache,
      next = after.roles.cache;
    for (const id of next.keys())
      if (!old.has(id)) r.store.audit(after.guild.id, 'role.observed.add', 'discord', after.id, { role: id });
    for (const id of old.keys())
      if (!next.has(id))
        r.store.audit(after.guild.id, 'role.observed.remove', 'discord', after.id, { role: id });
  });
  on(Events.MessageReactionAdd, (reaction, user) => reactionRole(r, reaction, user, false));
  on(Events.MessageReactionRemove, (reaction, user) => reactionRole(r, reaction, user, true));
  const suspicious = new Map([
    [AuditLogEvent.ChannelCreate, 'создание каналов'],
    [AuditLogEvent.ChannelDelete, 'удаление каналов'],
    [AuditLogEvent.RoleUpdate, 'изменение ролей'],
    [AuditLogEvent.MemberBanAdd, 'баны'],
    [AuditLogEvent.MemberKick, 'исключения'],
  ]);
  on(Events.GuildAuditLogEntryCreate, async (entry, g) => {
    if (
      !r.config.enabled(g.id, 'security') ||
      entry.executorId === r.client.user.id ||
      !suspicious.has(entry.action)
    )
      return;
    if (r.config.settings(g.id).trustedUsers.includes(entry.executorId)) return;
    if (pulse('audit:' + g.id + ':' + entry.action, 4, 20000))
      await alert(g, 'Серия действий: ' + suspicious.get(entry.action), entry.executorId || g.id);
  });
  for (const event of [Events.MessageDelete, Events.MessageUpdate])
    on(event, (old, current) => {
      if (!old.guildId || old.author?.bot || !r.config.settings(old.guildId).logContent) return;
      const cfg = r.config.settings(old.guildId),
        id = r.store.audit(old.guildId, 'message.content', old.author?.id || 'unknown', old.id, {
          before: scrub(old.content),
          after: scrub(current?.content),
        });
      r.store.task(
        'content:' + id,
        old.guildId,
        'expireAudit',
        { id },
        Date.now() + Math.min(7, cfg.retentionDays) * 86400000,
      );
    });
}
