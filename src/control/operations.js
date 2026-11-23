import { PermissionFlagsBits as P, ChannelType as C } from 'discord.js';
import { check, object, pageOffset, requirePermission, snow, string } from './errors.js';
import { ticketPermission } from './rbac.js';
import { canReview } from '../core/access.js';
import { runTicketAction } from '../modules/ticket-actions.js';
import { reserve, materialize, ticketRow, tierPolicy } from '../modules/tickets.js';
import { priorityLabels, validateQuestion, validateAnswer } from '../modules/forms.js';
import { safeMentions } from '../core/ui.js';
export function context(r, a, ch) {
  return {
    guild: a.guild,
    guildId: a.guild.id,
    member: a.member,
    memberPermissions: a.member.permissions,
    channel: ch,
    channelId: ch?.id,
    user: { id: a.member.id, username: a.profile.username },
    client: r.client,
  };
}
const roleIds = (a) => [...a.member.roles.cache.keys()];
function channelVisible(a, ch) {
  if (!ch || !ch.permissionsFor(a.member)?.has(P.ViewChannel)) return false;
  if (
    ch.type === C.PrivateThread &&
    !ch.permissionsFor(a.member).has(P.ManageThreads) &&
    !ch.members?.cache.has(a.member.id)
  )
    return false;
  return true;
}
export function visible(r, a, t) {
  if (
    !t ||
    t.guild !== a.guild.id ||
    !a.permissions.has(ticketPermission(t, 'view')) ||
    !r.config.enabled(a.guild.id, 'tickets')
  )
    return false;
  const p = JSON.parse(t.policy);
  if (p.kind !== 'support' && !r.config.enabled(a.guild.id, p.kind)) return false;
  if (
    p.kind === 'report' &&
    r.store.one('SELECT target FROM reports WHERE ticket=?', t.id)?.target === a.member.id
  )
    return false;
  const ch = a.guild.channels.cache.get(t.channel);
  return channelVisible(a, ch) && canReview(context(r, a, ch), t, r.config);
}
function authorizedRow(r, a, id) {
  const t = ticketRow(r.store, a.guild.id, id);
  check(visible(r, a, t), 404, 'Обращение недоступно.');
  return t;
}
function ticketScope(r, a) {
  const channels = [...a.guild.channels.cache.values()]
    .filter((ch) => channelVisible(a, ch))
    .map((ch) => ch.id);
  const roles = roleIds(a),
    bindings = r.config.bindings(a.guild.id, 'role');
  const keys = [...roles, ...Object.keys(bindings).filter((k) => roles.includes(bindings[k]))];
  const kinds = [
    ['support', 'tickets.view'],
    ['report', 'tickets.view'],
    ['recruit', 'recruitment.view'],
    ['tier', 'tiers.view'],
  ]
    .filter(([k, p]) => a.permissions.has(p) && (k === 'support' || r.config.enabled(a.guild.id, k)))
    .map(([k]) => k);
  const owner = a.guild.ownerId === a.member.id;
  return {
    sql: `t.guild=? AND t.channel IN(SELECT value FROM json_each(?)) AND json_extract(t.policy,'$.kind') IN(SELECT value FROM json_each(?))
 AND (? OR (t.type<>'staff' AND ?) OR EXISTS(SELECT 1 FROM json_each(t.policy,'$.access') k WHERE k.value IN(SELECT value FROM json_each(?))))
 AND NOT EXISTS(SELECT 1 FROM reports rp WHERE rp.ticket=t.id AND rp.target=?)`,
    args: [
      a.guild.id,
      JSON.stringify(channels),
      JSON.stringify(r.config.enabled(a.guild.id, 'tickets') ? kinds : []),
      Number(owner),
      Number(a.member.permissions.has(P.Administrator)),
      JSON.stringify(keys),
      a.member.id,
    ],
  };
}
export function ticketList(r, a, q = {}) {
  const scope = ticketScope(r, a);
  let sql = scope.sql;
  const args = [...scope.args];
  if (q.kind) {
    sql += " AND json_extract(t.policy,'$.kind')=?";
    args.push(q.kind);
  }
  if (q.status) {
    sql += ' AND t.state=?';
    args.push(q.status);
  }
  if (q.mine === '1') {
    sql += ' AND t.assignee=?';
    args.push(a.member.id);
  }
  if (q.q) {
    sql +=
      " AND (CAST(t.id AS TEXT)=? OR t.author=? OR instr(karma_lower(json_extract(t.policy,'$.title')),?)>0)";
    args.push(q.q.replace(/^#/, ''), q.q, q.q.toLowerCase());
  }
  const rows = r.store.all(
    "SELECT t.id,t.type,t.state,t.priority,t.assignee,t.author,t.channel,t.created,t.updated,json_extract(t.policy,'$.title') title,a.status application FROM tickets t LEFT JOIN applications a ON a.ticket=t.id WHERE " +
      sql +
      ' ORDER BY t.id DESC LIMIT 26 OFFSET ?',
    ...args,
    pageOffset(q.offset),
  );
  return { items: rows.slice(0, 25), more: rows.length > 25 };
}
export async function ticketDetail(r, a, id) {
  const t = authorizedRow(r, a, id),
    ch = a.guild.channels.cache.get(t.channel),
    p = JSON.parse(t.policy);
  let messages = [],
    messageStatus = 'Для чтения переписки требуются права на историю.';
  if (
    ch.permissionsFor(a.member).has(P.ReadMessageHistory) &&
    ch.permissionsFor(a.guild.members.me).has(P.ReadMessageHistory)
  ) {
    try {
      const batch = await ch.messages.fetch({ limit: 25, cache: false });
      messages = [...batch.values()].reverse().map((m) => ({
        id: m.id,
        author: m.author.username,
        text: m.content || '',
        time: m.createdTimestamp || m.createdAt?.getTime(),
        files: [...m.attachments.values()].slice(0, 5).map((f) => ({ name: f.name, url: f.url })),
      }));
      messageStatus = '';
    } catch {
      messageStatus = 'Discord временно не вернул историю канала.';
    }
  }
  const actions = [
    'claim',
    'unclaim',
    'transfer',
    'priority',
    'close',
    'reopen',
    'reply',
    'note',
    'accept',
    'reject',
    'interview',
    'info',
    'hold',
    'escalate',
    'transcript',
    'archive',
    'add',
    'remove',
  ].filter(
    (k) =>
      a.permissions.has(ticketPermission(t, k)) &&
      (!['accept', 'reject', 'info', 'hold'].includes(k) || p.kind !== 'support') &&
      (k !== 'interview' || p.kind === 'recruit') &&
      (t.state === 'open'
        ? !['reopen', 'archive'].includes(k)
        : ['reopen', 'archive', 'transcript', 'note'].includes(k)) &&
      (!p.staffActions || ['note', 'reply', 'close'].includes(k) || p.staffActions.includes(k)),
  );
  let transcriptUrl = null;
  if (t.transcript) {
    const logId = r.config.bindings(a.guild.id, 'channel')[p.log] || p.log;
    const dest = a.guild.channels.cache.get(logId);
    if (channelVisible(a, dest) && dest.permissionsFor(a.member).has(P.ReadMessageHistory))
      transcriptUrl = 'https://discord.com/channels/' + a.guild.id + '/' + logId + '/' + t.transcript;
  }
  return {
    id: t.id,
    title: p.title,
    kind: p.kind,
    state: t.state,
    priority: t.priority,
    assignee: t.assignee,
    author: t.author,
    applicant: a.guild.members.cache.get(t.author)?.displayName || null,
    family: a.permissions.has('family.view')
      ? r.store.one(
          'SELECT nick,static,rank,tier FROM family_members WHERE guild=? AND user=?',
          a.guild.id,
          t.author,
        )
      : null,
    application: r.store.one('SELECT status,reviewer FROM applications WHERE ticket=?', id),
    related: ticketList(r, a, { q: t.author })
      .items.filter((x) => x.id !== id)
      .slice(0, 5),
    channel: t.channel,
    created: t.created,
    answers: p.questions.map((q) => ({ label: q.label, value: JSON.parse(t.answers)[q.key] || '—' })),
    notes: r.store.all(
      'SELECT actor,body,created FROM control_notes WHERE ticket=? ORDER BY id DESC LIMIT 25',
      id,
    ),
    timeline: r.store.all(
      "SELECT id,action,actor,time FROM audit_logs WHERE guild=? AND target=? AND (action LIKE 'ticket.%' OR action LIKE 'application.%' OR action LIKE 'control.ticket.%') ORDER BY id DESC LIMIT 25",
      a.guild.id,
      String(id),
    ),
    messages,
    messageStatus,
    transcriptUrl,
    actions,
  };
}
export async function actOnTicket(r, a, id, b) {
  const t = authorizedRow(r, a, id),
    ch = a.guild.channels.cache.get(t.channel),
    act = b.action;
  check(
    [
      'claim',
      'unclaim',
      'transfer',
      'priority',
      'close',
      'reopen',
      'reply',
      'note',
      'accept',
      'reject',
      'interview',
      'info',
      'hold',
      'escalate',
      'transcript',
      'archive',
      'add',
      'remove',
    ].includes(act),
    400,
    'Неизвестное действие.',
  );
  requirePermission(a, ticketPermission(t, act));
  check(b.confirm === true, 400, 'Подтвердите действие.');
  const policy = JSON.parse(t.policy);
  if (policy.staffActions && !['note', 'reply', 'close'].includes(act))
    check(policy.staffActions.includes(act), 403, 'Действие отключено у этого типа.');
  if (['close', 'reject', 'reply', 'note', 'info', 'hold', 'interview'].includes(act))
    check(string(b.value, 1, 800), 400, 'Заполните текст действия.');
  if (['transfer', 'add', 'remove'].includes(act)) check(snow(b.value), 400, 'Укажите ID участника.');
  if (act === 'reply') {
    check(
      t.state === 'open' &&
        ch.permissionsFor(a.member).has(ch.isThread() ? P.SendMessagesInThreads : P.SendMessages),
      403,
      'Отправка недоступна.',
    );
    const msg = await ch.send({
      content: '**Ответ сотрудника <@' + a.member.id + '>**\n' + b.value,
      allowedMentions: safeMentions,
    });
    r.store.audit(a.guild.id, 'control.ticket.reply', a.member.id, String(id), { message: msg.id });
    return { message: 'Ответ отправлен в Discord.' };
  }
  if (act === 'note') {
    r.store.tx(() => {
      r.store.run(
        'INSERT INTO control_notes(ticket,actor,body,created) VALUES(?,?,?,?)',
        id,
        a.member.id,
        b.value,
        Date.now(),
      );
      r.store.audit(a.guild.id, 'control.ticket.note', a.member.id, String(id));
    });
    return { message: 'Внутренняя заметка сохранена.' };
  }
  return { message: await runTicketAction(r, context(r, a, ch), id, act, b.value, b.extra) };
}
export function creatable(r, a, key, policy) {
  return (
    a.permissions.has('tickets.create') &&
    a.permissions.has(ticketPermission({ policy: JSON.stringify(policy) }, 'view')) &&
    canReview(context(r, a), { guild: a.guild.id, type: key, policy: JSON.stringify(policy) }, r.config)
  );
}
export async function createTicket(r, a, b) {
  requirePermission(a, 'tickets.create');
  check(b.confirm === true && snow(b.user), 400, 'Подтвердите создание и выберите участника.');
  const catalog = r.config.types(a.guild.id);
  check(Object.hasOwn(catalog, b.type), 400, 'Неизвестная категория.');
  const g = a.guild.id,
    desired = catalog[b.type].kind === 'tier' ? object(b.answers).desired : null,
    p = tierPolicy(r, g, b.type, desired);
  requirePermission(a, ticketPermission({ policy: JSON.stringify(p) }, 'view'));
  check(
    canReview(context(r, a), { guild: g, type: b.type, policy: JSON.stringify(p) }, r.config),
    403,
    'Категория недоступна.',
  );
  r.enabled({ guildId: g }, 'tickets');
  if (p.kind !== 'support') r.enabled({ guildId: g }, p.kind);
  const member = await a.guild.members.fetch({ user: b.user, force: true });
  check(member && !member.user.bot, 400, 'Участник недоступен.');
  if (b.internal)
    check(
      b.user === a.member.id && p.kind === 'support',
      400,
      'Для внутреннего обращения выберите себя и тип поддержки.',
    );
  if (desired) {
    const def = JSON.parse(
      r.store.one('SELECT config FROM tier_definitions WHERE guild=? AND key=?', g, desired).config,
    );
    check(creatable(r, a, b.type, { ...p, access: def.reviewers }), 403, 'Тир недоступен для сотрудника.');
  }
  const answers = {};
  object(b.answers);
  for (const q of p.questions) {
    const v = String(b.answers[q.key] ?? '').trim();
    validateQuestion(q, v);
    if (v) validateAnswer(q.key, v, p.domains ? { domains: p.domains } : r.config.settings(g), p.kind);
    answers[q.key] = v;
  }
  if (p.kind === 'report') {
    check(answers.target !== b.user, 400, 'Выберите другого нарушителя.');
    const target = await a.guild.members.fetch(answers.target).catch(() => null);
    const staff = r.config.roleIds(g, [
      'owner',
      'leader',
      'deputy_leader',
      'high',
      'moderator',
      'ticket_support',
    ]);
    if (!target || target.permissions.has(P.Administrator) || staff.some((id) => target.roles.cache.has(id)))
      check(b.type === 'staff', 403, 'Используйте закрытую категорию жалоб на администрацию.');
  }
  check(Object.hasOwn(priorityLabels, b.priority || p.priority), 400, 'Проверьте приоритет.');
  const bindings = r.config.bindings(g, 'channel'),
    parentId =
      p.mode === 'thread' ? bindings[p.parent] || p.parent : bindings['cat_' + p.category] || p.category;
  const parent = a.guild.channels.cache.get(parentId);
  check(
    parent && parent.type === (p.mode === 'thread' ? C.GuildText : C.GuildCategory),
    400,
    'Привяжите действующую категорию или родительский канал в /setup.',
  );
  const reviewers = r.config.roleIds(g, p.access);
  check(
    reviewers.some((id) => a.guild.roles.cache.has(id)),
    400,
    'Назначьте существующую роль проверяющих.',
  );
  const id = reserve(
    r,
    { guildId: g, user: { id: member.id }, member },
    { key: b.type, context: desired ? { desired } : {}, answers, policy: p },
  );
  r.store.run('UPDATE tickets SET priority=? WHERE id=?', b.priority || p.priority, id);
  r.store.audit(g, 'control.ticket.create', a.member.id, String(id), {
    author: member.id,
    internal: !!b.internal,
  });
  r.store.task('create:' + id, g, 'createTicket', { id }, Date.now() + 60000);
  const ch = await r.locks.with('ticket:' + id, () => materialize(r, a.guild, ticketRow(r.store, g, id)));
  return { id, channel: ch.id, url: 'https://discord.com/channels/' + g + '/' + ch.id };
}
export function overview(r, a) {
  const scope = ticketScope(r, a),
    db = r.store,
    g = a.guild.id;
  const counts = db.one(
    "SELECT count(*) total,coalesce(sum(t.state='open'),0) open,coalesce(sum(t.state='open' AND json_extract(t.policy,'$.kind')='recruit'),0) recruit,coalesce(sum(t.state='open' AND json_extract(t.policy,'$.kind')='tier'),0) tiers,coalesce(sum(t.state='open' AND ap.status='interview'),0) interviews FROM tickets t LEFT JOIN applications ap ON ap.ticket=t.id WHERE " +
      scope.sql,
    ...scope.args,
  );
  const days = db.all(
    "SELECT date(t.created/1000,'unixepoch') day,count(*) count FROM tickets t WHERE " +
      scope.sql +
      ' AND t.created>=? GROUP BY day ORDER BY day',
    ...scope.args,
    Date.now() - 7 * 86400000,
  );
  return {
    ...counts,
    days,
    members: a.permissions.has('family.view')
      ? db.one('SELECT count(*) n FROM family_members WHERE guild=?', g).n
      : null,
    events: a.permissions.has('events.view')
      ? db.one(
          "SELECT count(*) n FROM events WHERE guild=? AND start>? AND state='scheduled' AND channel IN(SELECT value FROM json_each(?))",
          g,
          Date.now(),
          JSON.stringify(roleChannels(r, a).channels.map((c) => c.id)),
        ).n
      : null,
    bot: r.client.isReady(),
    uptime: Math.floor(process.uptime()),
    assigned: ticketList(r, a, { mine: '1' }).items.slice(0, 5),
    feed: feed(r, a, {}, true).items.slice(0, 8),
  };
}
export function feed(r, a, q = {}, personal = false) {
  const scope = ticketScope(r, a),
    g = a.guild.id,
    u = a.member.id;
  // The predicate is shared by the activity feed and the notification centre; re-evaluate it on every read.
  const ticketActions =
    "(l.action LIKE 'ticket.%' OR l.action LIKE 'application.%' OR l.action LIKE 'control.ticket.%')";
  const draftActions =
    "(l.action LIKE 'control.draft.%' OR l.action LIKE 'control.publish.%' OR l.action='control.config.apply')";
  const filter = `(CASE WHEN ${ticketActions} THEN EXISTS(SELECT 1 FROM tickets t WHERE CAST(t.id AS TEXT)=l.target AND ${scope.sql})
 WHEN ${draftActions} THEN EXISTS(SELECT 1 FROM control_drafts d WHERE d.id=l.target AND d.guild=l.guild AND d.kind IN(SELECT value FROM json_each(?)) AND (d.owner=? OR EXISTS(SELECT 1 FROM json_each(d.shared) WHERE value IN(SELECT value FROM json_each(?)))))
 ELSE (l.actor=? OR (l.action='control.permissions' AND l.target IN(SELECT value FROM json_each(?))) OR ?) END)`;
  const kinds = ['ticket', 'embed', 'tier'].filter((k) =>
    a.permissions.has({ ticket: 'tickets.configure', tier: 'tiers.configure', embed: 'embeds.create' }[k]),
  );
  const prefs = JSON.parse(
    r.store.one('SELECT config FROM control_preferences WHERE guild=? AND user=?', g, u)?.config || '{}',
  );
  const filterAction = !personal && q.action === 'control.permissions';
  const rows = r.store.all(
    'SELECT l.id,l.action,l.actor,l.target,l.time,' +
      (!personal && a.permissions.has('audit.view') ? 'l.detail,' : '') +
      'EXISTS(SELECT 1 FROM control_reads v WHERE v.guild=l.guild AND v.user=? AND v.event=l.id) seen FROM audit_logs l WHERE l.guild=? AND ' +
      filter +
      (filterAction ? " AND l.action='control.permissions'" : '') +
      (q.own === '1' ? ' AND l.actor=?' : '') +
      (personal && prefs.notifications === 'assigned'
        ? ' AND (l.actor=? OR EXISTS(SELECT 1 FROM tickets t WHERE t.guild=l.guild AND CAST(t.id AS TEXT)=l.target AND t.assignee=?))'
        : '') +
      ' ORDER BY l.id DESC LIMIT 26 OFFSET ?',
    u,
    g,
    ...scope.args,
    JSON.stringify(kinds),
    u,
    JSON.stringify(roleIds(a)),
    u,
    JSON.stringify(roleIds(a)),
    Number(!personal && a.permissions.has('audit.view')),
    ...(q.own === '1' ? [u] : []),
    ...(personal && prefs.notifications === 'assigned' ? [u, u] : []),
    pageOffset(q.offset),
  );
  return { items: rows.slice(0, 25), more: rows.length > 25 };
}
export function preferences(r, a, b) {
  const db = r.store,
    g = a.guild.id,
    u = a.member.id;
  if (b) {
    object(b);
    check(
      ['dark', 'light'].includes(b.theme) &&
        ['all', 'assigned', 'off'].includes(b.notifications) &&
        typeof b.compact === 'boolean' &&
        typeof b.reducedMotion === 'boolean' &&
        ['system', 'editorial', 'mono'].includes(b.font) &&
        ['favorites', 'widgets', 'hidden', 'commands'].every(
          (k) => Array.isArray(b[k]) && b[k].length <= 140 && b[k].every((s) => string(s, 0, 100)),
        ),
      400,
      'Проверьте настройки профиля.',
    );
    const out = Object.fromEntries(
      [
        'theme',
        'notifications',
        'compact',
        'reducedMotion',
        'font',
        'favorites',
        'widgets',
        'hidden',
        'commands',
      ].map((k) => [k, b[k]]),
    );
    db.run('INSERT OR REPLACE INTO control_preferences VALUES(?,?,?)', g, u, JSON.stringify(out));
  }
  return {
    theme: 'dark',
    notifications: 'all',
    compact: false,
    reducedMotion: false,
    font: 'system',
    favorites: [],
    widgets: ['overview', 'activity', 'assigned'],
    hidden: [],
    commands: [],
    ...JSON.parse(
      db.one('SELECT config FROM control_preferences WHERE guild=? AND user=?', g, u)?.config || '{}',
    ),
  };
}
export function roleChannels(r, a) {
  const g = a.guild,
    channels = [...g.channels.cache.values()]
      .filter((ch) => channelVisible(a, ch))
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        send: !!ch.permissionsFor(a.member)?.has(P.SendMessages),
      }));
  return {
    roles: [...g.roles.cache.values()]
      .filter((role) => role.id !== g.id && !role.managed)
      .map((role) => ({ id: role.id, name: role.name, position: role.position })),
    channels,
    bindings: r.config.bindings(g.id, 'role'),
    channelBindings: Object.fromEntries(
      Object.entries(r.config.bindings(g.id, 'channel')).filter(([, id]) =>
        channels.some((c) => c.id === id),
      ),
    ),
  };
}
