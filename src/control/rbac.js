import { check, requirePermission, snow } from './errors.js';
export const permissionLabels = {
  'dashboard.access': 'Вход в KARMA CONTROL',
  'dashboard.overview': 'Обзор',
  'tickets.view': 'Просмотр обращений',
  'tickets.create': 'Создание от имени участника',
  'tickets.configure': 'Настройка типов и анкет',
  'tickets.claim': 'Назначения и приоритет',
  'tickets.close': 'Закрытие и возврат',
  'tickets.reply': 'Ответы и заметки',
  'tickets.publish': 'Публикация панели',
  'recruitment.view': 'Просмотр заявок набора',
  'recruitment.review': 'Рассмотрение и обзвон',
  'recruitment.accept': 'Принятие в семью',
  'recruitment.reject': 'Отклонение заявки',
  'tiers.view': 'Просмотр тиров',
  'tiers.configure': 'Настройка тиров',
  'tiers.review': 'Рассмотрение заявок на тир',
  'tiers.publish': 'Публикация панели тира',
  'family.view': 'Состав семьи',
  'family.manage': 'Управление профилями',
  'moderation.view': 'Журнал модерации',
  'moderation.manage': 'Модерация',
  'embeds.create': 'Конструктор сообщений',
  'embeds.publish': 'Публикация сообщений',
  'roles.manage': 'Просмотр ролей',
  'settings.manage': 'Настройки сервера',
  'permissions.manage': 'Делегирование доступа',
  'audit.view': 'Журнал действий',
  'analytics.view': 'Статистика',
  'events.view': 'Расписание',
  'events.manage': 'Управление мероприятиями',
  'drafts.share': 'Совместная работа',
};
const base = ['dashboard.access', 'dashboard.overview'];
const operations = [
  ...base,
  'tickets.view',
  'tickets.claim',
  'tickets.close',
  'tickets.reply',
  'recruitment.view',
  'recruitment.review',
  'recruitment.accept',
  'recruitment.reject',
  'tiers.view',
  'tiers.review',
  'family.view',
  'family.manage',
  'events.view',
  'events.manage',
  'moderation.view',
  'moderation.manage',
  'analytics.view',
];
export const presets = {
  owner: Object.keys(permissionLabels),
  leader: [
    ...operations,
    'tickets.create',
    'tickets.configure',
    'tickets.publish',
    'tiers.configure',
    'tiers.publish',
    'embeds.create',
    'embeds.publish',
    'roles.manage',
    'drafts.share',
  ],
  deputy_leader: operations,
  recruit: [...base, 'recruitment.view', 'recruitment.review'],
};
export function mappings(config, guild) {
  const bindings = config.bindings(guild.id, 'role'),
    map = new Map();
  for (const [key, perms] of Object.entries(presets)) {
    const id = bindings[key === 'recruit' ? 'control_recruit' : key];
    if (id && id !== guild.id) {
      const prior = map.get(id) || [];
      map.set(id, [...new Set([...prior, ...perms])]);
    }
  }
  for (const row of config.store.all('SELECT role,permissions FROM control_grants WHERE guild=?', guild.id))
    map.set(row.role, JSON.parse(row.permissions));
  return map;
}
export function permissionsFor(config, guild, member) {
  if (member.id === guild.ownerId) return new Set(presets.owner);
  const result = new Set();
  for (const [id, perms] of mappings(config, guild))
    if (guild.roles.cache.has(id) && member.roles.cache.has(id))
      for (const perm of perms) if (Object.hasOwn(permissionLabels, perm)) result.add(perm);
  return result;
}
export function ticketPermission(t, action) {
  const { kind } = JSON.parse(t.policy);
  if (kind === 'recruit')
    return ['accept', 'reject'].includes(action)
      ? 'recruitment.' + action
      : action === 'view'
        ? 'recruitment.view'
        : 'recruitment.review';
  if (kind === 'tier') return action === 'view' ? 'tiers.view' : 'tiers.review';
  if (action === 'view') return 'tickets.view';
  if (['close', 'reopen', 'archive', 'accept', 'reject'].includes(action)) return 'tickets.close';
  if (['reply', 'note', 'info', 'transcript'].includes(action)) return 'tickets.reply';
  return 'tickets.claim';
}
export function commandPermission(name, sub) {
  if (name === 'embed') return sub === 'send' ? 'embeds.publish' : 'embeds.create';
  if (name === 'ticket' && sub === 'panel') return 'tickets.publish';
  if (name === 'setup' || name === 'dashboard' || name === 'backup' || name === 'diagnostics')
    return 'settings.manage';
  if (name === 'staff') return 'analytics.view';
  if (name === 'family' && ['add', 'remove', 'promote', 'demote', 'inactive', 'note'].includes(sub))
    return 'family.manage';
  if (name === 'event' && ['create', 'edit', 'start', 'end', 'cancel', 'attendance'].includes(sub))
    return 'events.manage';
  if (
    [
      'warn',
      'unwarn',
      'timeout',
      'untimeout',
      'ban',
      'unban',
      'kick',
      'clear',
      'slowmode',
      'lock',
      'unlock',
      'nickname',
      'role',
    ].includes(name)
  )
    return 'moderation.manage';
  if (['mod', 'warnings'].includes(name)) return 'moderation.view';
  return null;
}
export function interactionPermission(key, args, i, data = {}) {
  if (key.startsWith('cmd.')) return commandPermission(key.slice(4), i.options?.getSubcommand?.(false));
  if (key === 'embed.publish') return 'embeds.publish';
  if (key === 'ticket.publish') return 'tickets.publish';
  if (key.startsWith('embed')) return 'embeds.create';
  if (
    key === 'tieredit' ||
    (['editkey', 'saveconfig', 'editconfig'].includes(key) && (args[0] || data.kind) === 'tier')
  )
    return 'tiers.configure';
  if (key === 'family.remove') return 'family.manage';
  if (key === 'moderation') return 'moderation.manage';
  if (key === 'auditopen' || key === 'auditread') return 'audit.view';
  if (
    [
      'sethome',
      'setgroup',
      'setback',
      'setkey',
      'setbind',
      'setnew',
      'setname',
      'setup.create',
      'typeedit',
      'typekeys',
      'editkey',
      'editconfig',
      'saveconfig',
      'toggle',
      'cfg',
      'cfgsave',
      'settingsgroup',
      'settingsedit',
      'jobs',
      'jobretry',
      'restore',
      'dgo',
      'dsection',
    ].includes(key)
  )
    return 'settings.manage';
  return null;
}
export function nativeAllowed(config, guild, member, permission) {
  if (!permission || guild.ownerId === member.id) return true;
  const map = mappings(config, guild);
  if (![...map.keys()].some((id) => guild.roles.cache.has(id) && member.roles.cache.has(id))) return true;
  return permissionsFor(config, guild, member).has(permission);
}
export function discordGate(config, guild, member, t, action) {
  const permissions = permissionsFor(config, guild, member);
  const managed = [...mappings(config, guild).keys()].some((id) => member.roles.cache.has(id));
  // Existing staff who have no Control mapping retain their Discord-only object ACL.
  return !managed || permissions.has(ticketPermission(t, action));
}
export function roleMatrix(r, a) {
  check(
    a.permissions.has('roles.manage') || a.permissions.has('permissions.manage'),
    403,
    'Раздел недоступен.',
  );
  const grants = mappings(r.config, a.guild);
  const rows = r.store.all('SELECT role,revision FROM control_grants WHERE guild=?', a.guild.id);
  return {
    labels: permissionLabels,
    presets,
    rows: [...grants].map(([id, permissions]) => ({
      id,
      name: a.guild.roles.cache.get(id)?.name || 'Удалённая роль',
      missing: !a.guild.roles.cache.has(id),
      permissions,
      revision: rows.find((x) => x.role === id)?.revision || 0,
    })),
  };
}
export function changeGrant(r, a, body) {
  requirePermission(a, 'permissions.manage');
  check(
    body.confirm === true && snow(body.role) && body.role !== a.guild.id,
    400,
    'Подтвердите изменение роли.',
  );
  const target = a.guild.roles.cache.get(body.role),
    old = mappings(r.config, a.guild).get(body.role) || [];
  const next = body.permissions;
  check(
    Array.isArray(next) &&
      next.length <= Object.keys(permissionLabels).length &&
      next.every((k) => Object.hasOwn(permissionLabels, k)),
    400,
    'Неверный список разрешений.',
  );
  check((target && !target.managed) || (!target && !next.length), 400, 'Роль недоступна.');
  if (a.member.id !== a.guild.ownerId) {
    check(
      body.role !== r.config.bindings(a.guild.id, 'role').owner &&
        !a.member.roles.cache.has(body.role) &&
        target &&
        a.member.roles.highest.comparePositionTo(target) > 0,
      403,
      'Эта роль защищена иерархией.',
    );
    check(
      [...old, ...next].every((k) => a.permissions.has(k)) &&
        !next.includes('permissions.manage') &&
        !next.includes('settings.manage'),
      403,
      'Нельзя делегировать эти разрешения.',
    );
  }
  const db = r.store;
  db.tx(() => {
    const rev =
      db.one('SELECT revision FROM control_grants WHERE guild=? AND role=?', a.guild.id, body.role)
        ?.revision || 0;
    check(rev === body.revision, 409, 'Роль изменилась. Обновите матрицу.');
    db.run(
      'INSERT OR REPLACE INTO control_grants VALUES(?,?,?,?)',
      a.guild.id,
      body.role,
      JSON.stringify([...new Set(next)]),
      rev + 1,
    );
    db.audit(a.guild.id, 'control.permissions', a.member.id, body.role, {
      before: old,
      after: next,
      outcome: 'ok',
    });
  });
  return { saved: true };
}
