import { randomUUID } from 'node:crypto';
import { check, requirePermission, snow, string, object, pageOffset } from './errors.js';
import { context, roleChannels, ticketList } from './operations.js';
import { digest, listDrafts, embedTemplates } from './studio.js';
import { validateSettings } from '../modules/dashboard.js';
import { commandCatalog } from './guide.js';
export function tiers(r, a) {
  requirePermission(a, 'tiers.view');
  return r.store
    .all(
      "SELECT key,config FROM tier_definitions WHERE guild=? ORDER BY json_extract(config,'$.order'),key LIMIT 150",
      a.guild.id,
    )
    .map((row) => {
      const config = JSON.parse(row.config);
      return {
        ...row,
        config,
        revision: digest(config),
        roleName: a.guild.roles.cache.get(config.role)?.name || null,
      };
    });
}
export function tierOrder(r, a, b) {
  requirePermission(a, 'tiers.configure');
  check(b.confirm === true && ['delete', 'reorder'].includes(b.action), 400, 'Подтвердите изменение тиров.');
  const all = tiers(r, a),
    row = all.find((x) => x.key === b.key);
  check(row && row.revision === b.revision, 409, 'Тир изменился.');
  const db = r.store,
    g = a.guild.id;
  db.tx(() => {
    if (b.action === 'delete') {
      check(
        !db.one(
          "SELECT 1 FROM family_members WHERE guild=? AND tier=? UNION ALL SELECT 1 FROM tier_applications a JOIN tickets t ON t.id=a.ticket WHERE t.guild=? AND a.tier=? AND t.state IN ('open','creating') LIMIT 1",
          g,
          b.key,
          g,
          b.key,
        ),
        409,
        'Тир назначен участнику или используется действующей заявкой.',
      );
      db.run('DELETE FROM tier_definitions WHERE guild=? AND key=?', g, b.key);
    } else {
      const from = all.indexOf(row),
        to = b.to;
      check(Number.isInteger(to) && to >= 0 && to < all.length, 400, 'Неверная позиция.');
      all.splice(from, 1);
      all.splice(to, 0, row);
      for (const [n, x] of all.entries())
        db.run(
          'UPDATE tier_definitions SET config=? WHERE guild=? AND key=?',
          JSON.stringify({ ...x.config, order: n + 1 }),
          g,
          x.key,
        );
    }
    db.audit(g, 'control.tier.' + (b.action === 'delete' ? 'delete' : 'reorder'), a.member.id, b.key, {
      before: row.config,
      after: b.action === 'delete' ? null : b.to,
    });
  });
  return { saved: true };
}
export function familyList(r, a, q = {}) {
  requirePermission(a, 'family.view');
  const term = String(q.q || '')
    .slice(0, 100)
    .toLowerCase();
  return r.store.all(
    'SELECT user,nick,static,rank,tier,active,joined FROM family_members WHERE guild=? AND (instr(karma_lower(nick),?)>0 OR static=? OR user=?) ORDER BY nick,user LIMIT 26 OFFSET ?',
    a.guild.id,
    term,
    term,
    term,
    pageOffset(q.offset),
  );
}
export function calendar(r, a, q = {}) {
  requirePermission(a, 'events.view');
  const channelIds = roleChannels(r, a).channels.map((x) => x.id);
  return r.store
    .all(
      'SELECT id,title,start,state,organizer,capacity,message,channel,details FROM events WHERE guild=? AND channel IN(SELECT value FROM json_each(?)) ORDER BY start DESC LIMIT 26 OFFSET ?',
      a.guild.id,
      JSON.stringify(channelIds),
      pageOffset(q.offset),
    )
    .map((x) => ({ ...x, details: JSON.parse(x.details) }));
}
export function settings(r, a, b) {
  requirePermission(a, 'settings.manage');
  const current = r.config.settings(a.guild.id);
  if (b) {
    check(
      b.confirm === true && b.revision === digest(current),
      409,
      'Настройки изменились. Обновите страницу.',
    );
    object(b.values);
    check(
      Object.keys(b.values).every((k) => Object.hasOwn(current, k)),
      400,
      'Неизвестный параметр.',
    );
    r.config.save(a.guild.id, validateSettings({ ...current, ...b.values }), a.member.id);
  }
  const values = r.config.settings(a.guild.id);
  return { values, revision: digest(values) };
}
export function search(r, a, query) {
  const q = String(query || '')
    .trim()
    .slice(0, 80)
    .toLowerCase();
  if (!q) return [];
  const results = [];
  for (const c of commandCatalog(r, a)
    .filter((c) => [c.name, c.description].join(' ').toLowerCase().includes(q))
    .slice(0, 6))
    results.push({ title: c.name, detail: c.description, route: 'commands', query: c.name });
  if (a.permissions.has('family.view'))
    for (const m of familyList(r, a, { q }).slice(0, 4))
      results.push({ title: m.nick, detail: m.static, route: 'family', query: m.nick });
  if (a.permissions.has('tiers.view'))
    for (const t of tiers(r, a)
      .filter((t) => (t.key + ' ' + t.config.title).toLowerCase().includes(q))
      .slice(0, 4))
      results.push({ title: t.config.title, detail: t.key, route: 'tiers', query: t.key });
  for (const t of ticketList(r, a, { q }).items.slice(0, 6))
    results.push({
      title: '#' + t.id + ' · ' + t.title,
      detail: t.state,
      route: t.type === 'join' ? 'recruitment' : 'inbox',
      id: t.id,
    });
  for (const d of listDrafts(r, a, { q }).slice(0, 5))
    results.push({ title: d.title, detail: 'Черновик', route: 'publishing', id: d.id });
  if (a.permissions.has('embeds.create')) {
    for (const t of embedTemplates.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 4))
      results.push({ title: t.name, detail: 'Шаблон сообщения', route: 'embed', template: t.name });
    for (const t of r.store.all(
      'SELECT name FROM embed_templates WHERE guild=? AND instr(karma_lower(name),?)>0 LIMIT 4',
      a.guild.id,
      q,
    ))
      results.push({ title: t.name, detail: 'Сохранённый шаблон', route: 'embed', key: t.name });
  }
  return results;
}
const allowedCommands = {
  family: { permission: 'family.manage', actions: ['add', 'promote', 'demote', 'inactive', 'note'] },
  event: { permission: 'events.manage', actions: ['create', 'edit', 'start', 'end', 'cancel', 'attendance'] },
  warn: { permission: 'moderation.manage', actions: ['warn'] },
};
export function operationCatalog(r, a) {
  const rows = [];
  for (const [command, group] of Object.entries(allowedCommands)) {
    if (!a.permissions.has(group.permission)) continue;
    const def = r.commands.find((c) => c.name === command);
    for (const action of group.actions) {
      const sub = def.options.find((o) => o.type === 1 && o.name === action);
      rows.push({
        command,
        action,
        title: sub?.description || def.description,
        options: sub?.options || def.options,
      });
    }
  }
  return rows;
}
export async function dispatchOperation(r, a, b) {
  const group = Object.hasOwn(allowedCommands, b.command) && allowedCommands[b.command];
  check(
    group && group.actions.includes(b.action) && b.confirm === true,
    400,
    'Подтвердите поддерживаемую операцию.',
  );
  requirePermission(a, group.permission);
  const def = r.commands.find((c) => c.name === b.command),
    sub = def.options.find((x) => x.type === 1 && x.name === b.action);
  const fields = sub?.options || def.options;
  const data = object(b.values),
    resolved = {};
  check(
    Object.keys(data).every((k) => fields.some((o) => o.name === k)),
    400,
    'Неизвестный параметр команды.',
  );
  for (const opt of fields) {
    const val = data[opt.name];
    if (val === undefined || val === null || val === '') {
      check(!opt.required, 400, 'Заполните «' + opt.description + '».');
      continue;
    }
    if (opt.type === 3)
      check(
        string(val, 1, opt.max_length || 1000) && (!opt.choices || opt.choices.some((c) => c.value === val)),
        400,
        'Проверьте «' + opt.description + '».',
      );
    if (opt.type === 4)
      check(
        Number.isInteger(val) && val >= (opt.min_value ?? 0) && val <= (opt.max_value ?? 1000000),
        400,
        'Проверьте число.',
      );
    if (opt.type === 5) check(typeof val === 'boolean', 400, 'Ожидается логическое значение.');
    if (opt.type === 6) {
      check(snow(val), 400, 'Нужен Discord ID участника.');
      const member = await a.guild.members.fetch({ user: val, force: true });
      check(member, 404, 'Участник недоступен.');
      resolved[opt.name] = member.user;
    }
    if (opt.type === 8) {
      check(snow(val) && a.guild.roles.cache.has(val), 400, 'Роль недоступна.');
      resolved[opt.name] = a.guild.roles.cache.get(val);
    }
  }
  const ch = b.channel ? a.guild.channels.cache.get(b.channel) : null;
  if (b.command === 'warn')
    check(ch && ch.permissionsFor(a.member)?.has('ViewChannel'), 403, 'Выберите доступный канал.');
  if (b.command === 'event') {
    const e =
      b.action === 'create'
        ? null
        : r.store.one('SELECT channel FROM events WHERE guild=? AND id=?', a.guild.id, data.id);
    const id =
      e?.channel || r.config.bindings(a.guild.id, 'channel')[data.kind === 'capture' ? 'captures' : 'events'];
    const dest = a.guild.channels.cache.get(id);
    check(
      dest && dest.permissionsFor(a.member)?.has(['ViewChannel', 'SendMessages']),
      403,
      'Нет доступа к каналу мероприятия.',
    );
  }
  const scope = context(r, a, ch);
  let result;
  const i = {
    ...scope,
    id: randomUUID(),
    commandName: b.command,
    deferred: true,
    appPermissions: ch?.permissionsFor(a.guild.members.me) || a.guild.members.me.permissions,
    options: {
      getSubcommand: () => (sub ? b.action : null),
      getUser: (k) => resolved[k] || null,
      getRole: (k) => resolved[k] || null,
      getString: (k) => data[k] ?? null,
      getInteger: (k) => data[k] ?? null,
      getBoolean: (k) => data[k] ?? null,
      getChannel: () => ch,
    },
    deferReply: async () => {},
    editReply: async (p) => {
      result = p.embeds?.[0]?.description || p.content;
    },
  };
  const route = r.routes.get('cmd.' + b.command);
  if (route.module) r.enabled(i, route.module);
  await route.fn(i);
  check(result, 502, 'Операция не подтверждена.');
  return { message: result };
}
