import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { cmd, sub, str, user, num, role } from '../core/router.js';
import { card, respond, requireThat, ephemeral } from '../core/ui.js';
import { hierarchy, assignable } from '../core/access.js';
import { validId } from './forms.js';
import { mappings, permissionsFor } from '../control/rbac.js';
const spec = {
  ban: [P.BanMembers, 'Заблокировать участника'],
  unban: [P.BanMembers, 'Снять бан по Discord ID'],
  kick: [P.KickMembers, 'Исключить участника'],
  timeout: [P.ModerateMembers, 'Временно ограничить участника'],
  untimeout: [P.ModerateMembers, 'Снять тайм-аут'],
  warn: [P.ModerateMembers, 'Выдать предупреждение'],
  warnings: [P.ModerateMembers, 'Предупреждения участника'],
  clear: [P.ManageMessages, 'Удалить сообщения младше 14 дней'],
  slowmode: [P.ManageChannels, 'Настроить медленный режим'],
  lock: [P.ManageRoles, 'Закрыть запись для @everyone'],
  unlock: [P.ManageRoles, 'Восстановить режим записи'],
  nickname: [P.ManageNicknames, 'Изменить серверный никнейм'],
  role: [P.ManageRoles, 'Управление ролями'],
  mod: [P.ModerateMembers, 'Журнал модерации'],
};
const reason = str('reason', 'Основание действия', true, { max_length: 400 });
export function checkModeration(i, act) {
  const perm = spec[act][0];
  requireThat(
    i.memberPermissions.has(perm) && i.appPermissions.has(perm),
    'Проверьте права сотрудника и бота на это действие.',
  );
}
export function installModeration(r) {
  const db = r.store;
  async function apply(i, d) {
    r.enabled(i, 'moderation');
    checkModeration(i, d.act);
    const { act, u, n, reason, rid } = d,
      ch = i.channel;
    if (['mod', 'warnings'].includes(act)) {
      const list = db.all(
        'SELECT * FROM moderation_cases WHERE guild=? AND user=? ' +
          (act === 'warnings' ? "AND action='warn' " : '') +
          'ORDER BY id DESC LIMIT 20',
        i.guildId,
        u,
      );
      return respond(
        i,
        card(
          'Журнал модерации',
          list
            .map((x) => '#' + x.id + ' · ' + x.action + ' · ' + x.reason + ' · <@' + x.actor + '>')
            .join('\n') || 'Записей нет.',
        ),
      );
    }
    if (act === 'unban') {
      requireThat(validId(u) && u !== i.guild.ownerId, 'Проверьте Discord ID.');
      await i.guild.bans.remove(u, reason);
    } else if (u) {
      const m = await i.guild.members.fetch(u);
      hierarchy(i, m);
      if (act === 'ban') {
        requireThat(m.bannable, 'Бан недоступен.');
        await m.ban({ reason });
      }
      if (act === 'kick') {
        requireThat(m.kickable, 'Исключение недоступно.');
        await m.kick(reason);
      }
      if (act === 'timeout' || act === 'untimeout') {
        requireThat(m.moderatable, 'Тайм-аут недоступен.');
        await m.timeout(act === 'timeout' ? n * 60000 : null, reason);
      }
      if (act === 'nickname') await m.setNickname(d.nick, reason);
      if (act === 'role') {
        const role = assignable(i.guild, await i.guild.roles.fetch(rid), r.config);
        requireThat(
          i.guild.ownerId === i.user.id || i.member.roles.highest.comparePositionTo(role) > 0,
          'Эта роль равна вашей или выше.',
        );
        requireThat(i.memberPermissions.has(role.permissions), 'У роли есть права, отсутствующие у вас.');
        const grants = mappings(r.config, i.guild).get(role.id) || [],
          authority = permissionsFor(r.config, i.guild, i.member);
        requireThat(
          i.user.id === i.guild.ownerId ||
            grants.every(
              (key) => authority.has(key) && key !== 'permissions.manage' && key !== 'settings.manage',
            ),
          'Роль имеет расширенные полномочия KARMA CONTROL.',
        );
        if (d.mode === 'add') await m.roles.add(role, reason);
        else await m.roles.remove(role, reason);
      }
    } else {
      requireThat(ch.type === ChannelType.GuildText, 'Выберите обычный текстовый канал.');
      if (act === 'clear') {
        const deleted = await ch.bulkDelete(n, true);
        d.deleted = deleted.size;
      }
      if (act === 'slowmode') await ch.setRateLimitPerUser(n, reason);
      if (act === 'lock' || act === 'unlock') {
        requireThat(
          !db.one('SELECT 1 FROM security_locks WHERE guild=? AND channel=?', i.guildId, ch.id),
          'Сначала снимите аварийные ограничения через /security release.',
        );
        const key = 'lock:' + ch.id;
        const previous = db.one(
          "SELECT detail FROM audit_logs WHERE guild=? AND target=? AND action IN ('channel.lock','channel.unlock') ORDER BY id DESC LIMIT 1",
          i.guildId,
          key,
        );
        const state = previous ? JSON.parse(previous.detail) : {};
        if (act === 'lock') {
          requireThat(!state.locked, 'Канал уже закрыт ботом.');
          const o = ch.permissionOverwrites.cache.get(i.guildId),
            send = o?.allow.has(P.SendMessages) ? true : o?.deny.has(P.SendMessages) ? false : null;
          db.audit(i.guildId, 'channel.lock', i.user.id, key, { locked: true, send });
          try {
            await ch.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false }, { reason });
          } catch (e) {
            db.audit(i.guildId, 'channel.unlock', i.user.id, key, { locked: false });
            throw e;
          }
        } else {
          requireThat(state.locked, 'Канал не закрыт ботом.');
          await ch.permissionOverwrites.edit(
            i.guild.roles.everyone,
            { SendMessages: state.send },
            { reason },
          );
          db.audit(i.guildId, 'channel.unlock', i.user.id, key, { locked: false });
        }
      }
    }
    db.tx(() => {
      db.run(
        'INSERT INTO moderation_cases(guild,user,action,reason,actor,created) VALUES(?,?,?,?,?,?)',
        i.guildId,
        u || ch.id,
        act,
        reason,
        i.user.id,
        Date.now(),
      );
      db.audit(i.guildId, 'mod.' + act, i.user.id, u || ch.id, {
        reason,
        role: rid,
        amount: n,
        deleted: d.deleted,
      });
    });
    return respond(
      i,
      act === 'clear' ? 'Удалено сообщений: ' + d.deleted : 'Действие выполнено и записано в журнал.',
    );
  }
  const options = {
    ban: [user(), reason],
    unban: [str('id', 'Discord ID'), reason],
    kick: [user(), reason],
    timeout: [user(), num('minutes', 'Минуты', true, 1, 40320), reason],
    untimeout: [user(), reason],
    warn: [user(), reason],
    warnings: [user()],
    clear: [num('count', 'Количество', true, 1, 100), reason],
    slowmode: [num('seconds', 'Секунды', true, 0, 21600), reason],
    lock: [reason],
    unlock: [reason],
    nickname: [user(), str('nick', 'Новый никнейм', true, { max_length: 32 }), reason],
    role: [
      sub('add', 'Выдать роль', user(), role(), reason),
      sub('remove', 'Снять роль', user(), role(), reason),
    ],
    mod: [sub('history', 'История действий', user())],
  };
  for (const [name, [perm, label]] of Object.entries(spec)) {
    r.command(
      { ...cmd(name, label, ...options[name]), default_member_permissions: perm.toString() },
      async (i) => {
        checkModeration(i, name);
        const o = i.options;
        const d = {
          act: name,
          u: o.getUser('user')?.id || o.getString('id'),
          reason: o.getString('reason') || 'Просмотр',
          n: o.getInteger('minutes') ?? o.getInteger('seconds') ?? o.getInteger('count'),
          nick: o.getString('nick'),
          rid: o.getRole('role')?.id,
          mode: o.getSubcommand(false),
        };
        if (['ban', 'kick', 'clear', 'lock'].includes(name))
          return r.preview(
            i,
            'moderation',
            d,
            label + ' · ' + (d.u ? '<@' + d.u + '>' : chLabel(i)) + ' · ' + d.reason,
          );
        await i.deferReply({ flags: ephemeral });
        return r.locks.with('mod:' + i.guildId + ':' + (d.u || i.channelId), () => apply(i, d));
      },
      { module: 'moderation' },
    );
  }
  r.confirm('moderation', (i, d) =>
    r.locks.with('mod:' + i.guildId + ':' + (d.u || i.channelId), () => apply(i, d)),
  );
}
const chLabel = (i) => '<#' + i.channelId + '>';
