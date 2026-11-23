import { PermissionFlagsBits as P } from 'discord.js';
import { requireThat } from './ui.js';
import { mappings } from '../control/rbac.js';
export const admin = (i) => i.guild?.ownerId === i.user.id || i.memberPermissions?.has(P.Administrator);
export function management(i) {
  requireThat(admin(i), 'Требуются права администратора сервера.');
}
export function staff(i, config, keys) {
  return admin(i) || config.roleIds(i.guildId, keys).some((id) => i.member.roles.cache.has(id));
}
export function needStaff(i, config, keys) {
  requireThat(staff(i, config, keys), 'У вас нет доступа к этому разделу.');
}
export function canReview(i, t, config) {
  if (t.guild !== i.guildId) return false;
  const keys = JSON.parse(t.policy).access;
  if (t.type === 'staff')
    return (
      i.user.id === i.guild.ownerId ||
      config.roleIds(i.guildId, keys).some((id) => i.member.roles.cache.has(id))
    );
  return staff(i, config, keys);
}
export const safeRolePermissions =
  P.ViewChannel |
  P.SendMessages |
  P.ReadMessageHistory |
  P.AddReactions |
  P.Connect |
  P.Speak |
  P.UseApplicationCommands |
  P.AttachFiles |
  P.EmbedLinks |
  P.UseExternalEmojis |
  P.ChangeNickname |
  P.UseVAD |
  P.Stream;
export function assignable(guild, role, config, publicRole = false, removing = false) {
  requireThat(
    role && role.id !== guild.id && role.editable && !role.managed,
    'Роль недоступна боту. Проверьте иерархию.',
  );
  if (publicRole) {
    const restricted = config.roleIds(guild.id, [
      'owner',
      'leader',
      'deputy_leader',
      'high',
      'moderator',
      'ticket_support',
      'blacklisted',
    ]);
    const policies = Object.values(config.types(guild.id)).flatMap((t) => t.access);
    const tierRoles = config.store
      .all('SELECT config FROM tier_definitions WHERE guild=?', guild.id)
      .flatMap((t) => JSON.parse(t.config).reviewers || []);
    requireThat(
      !(role.permissions.bitfield & ~safeRolePermissions) &&
        ![
          ...restricted,
          ...(removing
            ? []
            : [...mappings(config, guild)].filter(([, perms]) => perms.length).map(([id]) => id)),
          ...config.roleIds(guild.id, [...policies, ...tierRoles]),
        ].includes(role.id),
      'Эту роль нельзя выдавать через публичный интерфейс.',
    );
  }
  return role;
}
export function hierarchy(i, member) {
  requireThat(
    member && member.id !== i.guild.ownerId && member.id !== i.user.id && member.id !== i.client.user.id,
    'Защищённый участник.',
  );
  requireThat(
    i.user.id === i.guild.ownerId || i.member.roles.highest.comparePositionTo(member.roles.highest) > 0,
    'Роль участника равна вашей или выше.',
  );
  requireThat(member.manageable, 'Роль участника недоступна боту.');
}
export class Locks {
  active = new Set();
  async with(key, fn) {
    requireThat(!this.active.has(key), 'Операция уже выполняется.');
    this.active.add(key);
    try {
      return await fn();
    } finally {
      this.active.delete(key);
    }
  }
}
