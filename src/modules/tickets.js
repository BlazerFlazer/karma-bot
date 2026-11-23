import { ChannelType as C, PermissionFlagsBits as P } from 'discord.js';
import { cmd, sub, str, menu, user, num } from '../core/router.js';
import { row, button, card, select, modal, field, respond, requireThat, ephemeral } from '../core/ui.js';
import { canReview, management } from '../core/access.js';
import {
  priorityLabels,
  statusLabels,
  ticketStates,
  validateAnswer,
  validateQuestion,
  blacklistMatch,
} from './forms.js';
import { transcript } from '../services/transcript.js';
const grant = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles];
export const ticketRow = (db, g, id) => {
  const t = db.one('SELECT * FROM tickets WHERE guild=? AND id=?', g, id);
  requireThat(t, 'Обращение не найдено.');
  return t;
};
export function ticketPanel(r, t) {
  const p = JSON.parse(t.policy),
    a = r.store.one('SELECT status FROM applications WHERE ticket=?', t.id);
  const answers = JSON.parse(t.answers);
  const id = String(t.id),
    ctl = [];
  if (t.state === 'open') {
    ctl.push(
      row(
        button('tact:' + id + ':claim', 'Взять тикет', 1),
        button('tact:' + id + ':transfer', 'Передать'),
        button('tact:' + id + ':add', 'Добавить участника'),
        button('tact:' + id + ':priority', 'Приоритет'),
        button('tact:' + id + ':close', 'Закрыть', 4),
      ),
    );
    const extra = [
      ['unclaim', 'Снять назначение'],
      ['remove', 'Убрать участника'],
      ['rename', 'Переименовать'],
      ['escalate', 'Повысить приоритет'],
      ['transcript', 'Создать транскрипт'],
    ];
    if (a && !['accepted', 'rejected', 'cancelled', 'expired'].includes(a.status))
      extra.unshift(
        ['accept', 'Принять'],
        ['reject', 'Отклонить'],
        ['info', p.kind === 'tier' ? 'Запросить новые доказательства' : 'Запросить сведения'],
        ['hold', 'Отложить'],
        ...(p.kind === 'recruit' ? [['interview', 'Пригласить на обзвон']] : []),
      );
    if (p.kind === 'tier') extra.push(['proof', 'Исправить доказательства']);
    ctl.push(row(select('tmore:' + id, 'Дополнительные действия', extra)));
  } else if (t.state === 'closed' || t.state === 'archived')
    ctl.push(
      row(
        button('tact:' + id + ':reopen', 'Открыть снова'),
        button('tact:' + id + ':archive', 'В архив'),
        button('tact:' + id + ':transcript', 'Транскрипт'),
        button('tact:' + id + ':delete', 'Удалить канал', 4),
      ),
    );
  if (Array.isArray(p.staffActions)) {
    for (const line of ctl) {
      line.components = line.components.filter(
        (c) =>
          !c.custom_id.startsWith('tact:') ||
          p.staffActions.includes(c.custom_id.split(':').at(-1)) ||
          c.custom_id.endsWith(':close') ||
          c.custom_id.endsWith(':delete'),
      );
      for (const c of line.components)
        if (c.options)
          c.options = c.options.filter((o) => p.staffActions.includes(o.value) || o.value === 'proof');
      line.components = line.components.filter((c) => !c.options || c.options.length);
    }
  }
  return card(
    p.title + ' · #' + id,
    [
      p.welcome,
      '<@' + t.author + '> · <t:' + Math.floor(t.created / 1000) + ':f>',
      'Статус: ' + (a ? statusLabels[a.status] + ' · ' : '') + ticketStates[t.state],
      'Ответственный: ' +
        (t.assignee ? '<@' + t.assignee + '>' : 'не назначен') +
        ' · Приоритет: ' +
        priorityLabels[t.priority],
      ...p.questions.map((q) => '**' + q.label + '**\n' + (answers[q.key] || '—').slice(0, 300)),
      ...(p.kind === 'tier' ? ['Доказательства: требуется ручная проверка.'] : []),
    ].join('\n'),
    ctl.filter((line) => line.components.length),
  );
}
export async function refreshTicket(r, t, ch) {
  const payload = ticketPanel(r, t);
  const m = t.panel
    ? await ch.messages.fetch(t.panel).catch((e) => {
        if (e.code !== 10008) throw e;
        return null;
      })
    : null;
  if (m) await m.edit(payload);
  else {
    const sent = await ch.send(payload);
    r.store.run('UPDATE tickets SET panel=? WHERE id=?', sent.id, t.id);
  }
}
function formPage(r, i, id) {
  const d = r.readDraft(i, id, 'ticket'),
    start = d.page * 5,
    qs = d.policy.questions.slice(start, start + 5);
  return i.showModal(
    modal(
      'tform:' + id + ':' + d.page,
      d.policy.title,
      ...qs.map((q) => {
        if (['select', 'user', 'role', 'channel'].includes(q.input))
          return {
            type: 18,
            label: q.label,
            ...(q.help ? { description: q.help } : {}),
            component: {
              type: { select: 3, user: 5, role: 6, channel: 8 }[q.input],
              custom_id: q.key,
              required: q.required,
              min_values: q.required ? 1 : 0,
              max_values: 1,
              ...(q.placeholder ? { placeholder: q.placeholder } : {}),
              ...(q.input === 'select' ? { options: q.options.map((v) => ({ label: v, value: v })) } : {}),
            },
          };
        return field(q.key, q.label, {
          required: q.required,
          value: d.answers[q.key],
          long: q.input
            ? q.input === 'long'
            : !['nick', 'age', 'static', 'target', 'desired'].includes(q.key),
          max: q.max || 500,
          placeholder: q.placeholder || q.help,
        });
      }),
    ),
  );
}
function allowedApplicant(r, g, policy, member) {
  if (policy.allowed?.length)
    requireThat(
      member && r.config.roleIds(g, policy.allowed).some((id) => member.roles.cache.has(id)),
      'Подача заявок этой категории ограничена ролями.',
    );
}
export function tierPolicy(r, g, key, desired) {
  const base = r.config.types(g)[key];
  if (!base || base.kind !== 'tier' || !desired) return base;
  const row = r.store.one('SELECT config FROM tier_definitions WHERE guild=? AND key=?', g, desired);
  requireThat(row, 'Желаемый тир не настроен.');
  const def = JSON.parse(row.config);
  return {
    ...base,
    questions: def.questions || base.questions,
    domains: def.domains?.length ? def.domains : r.config.settings(g).domains,
  };
}
export function begin(r, i, key, context = {}) {
  r.enabled(i, 'tickets');
  const catalog = r.config.types(i.guildId);
  requireThat(Object.hasOwn(catalog, key), 'Тип обращения недоступен.');
  const p = tierPolicy(r, i.guildId, key, context.desired);
  allowedApplicant(r, i.guildId, p, i.member);
  if (p.kind !== 'support') r.enabled(i, p.kind);
  if (key === 'staff')
    requireThat(p.mode === 'channel', 'Жалобы на администрацию требуют приватного канала.');
  const id = r.store.draft(i.guildId, i.user.id, 'ticket', {
    key,
    policy: p,
    page: 0,
    answers: {
      ...(context.target ? { target: context.target } : {}),
      ...(context.desired ? { desired: context.desired } : {}),
    },
    context,
  });
  return formPage(r, i, id);
}
export function reserve(r, i, d, draftId) {
  const db = r.store,
    g = i.guildId,
    u = i.user.id,
    now = Date.now(),
    p = d.policy;
  const current = tierPolicy(r, g, d.key, d.context?.desired);
  allowedApplicant(r, g, p, i.member);
  requireThat(
    current && JSON.stringify(current) === JSON.stringify(p),
    'Настройки анкеты изменились. Откройте её заново.',
  );
  const policy = { ...p };
  return db.tx(() => {
    if (draftId)
      requireThat(
        db.run(
          "DELETE FROM drafts WHERE id=? AND guild=? AND user=? AND kind='ticket' AND expires>?",
          draftId,
          g,
          u,
          now,
        ).changes,
        'Эта анкета уже отправлена или устарела.',
      );
    requireThat(
      !db.one(
        'SELECT 1 FROM cooldowns WHERE guild=? AND user=? AND key IN (?,?) AND until>?',
        g,
        u,
        d.key,
        'reject:' + p.kind,
        now,
      ),
      'Повторная подача пока недоступна.',
    );
    const active = db.one(
      "SELECT count(*) n FROM tickets WHERE guild=? AND author=? AND type=? AND state IN ('open','creating')",
      g,
      u,
      d.key,
    ).n;
    requireThat(active < p.limit, 'У вас уже есть открытое обращение этого типа.');
    if (active)
      requireThat(
        !db.one(
          "SELECT 1 FROM tickets WHERE guild=? AND author=? AND type=? AND state IN ('open','creating') AND answers=?",
          g,
          u,
          d.key,
          JSON.stringify(d.answers),
        ),
        'Такая анкета уже отправлена.',
      );
    if (p.kind === 'tier' || p.kind === 'recruit')
      requireThat(
        !blacklistMatch(db, g, u, d.answers),
        'Подача недоступна. Вы можете открыть обращение об обжаловании.',
      );
    if (p.kind === 'recruit')
      requireThat(
        !db.one(
          'SELECT 1 FROM family_members WHERE guild=? AND (user=? OR static=?)',
          g,
          u,
          d.answers.static,
        ),
        'Участник или статик уже зарегистрирован в семье.',
      );
    if (p.kind === 'tier') {
      const member = db.one(
        'SELECT tier FROM family_members WHERE guild=? AND user=? AND static=?',
        g,
        u,
        d.answers.static,
      );
      requireThat(member, 'Проверьте статик в профиле семьи.');
      requireThat(member.tier !== d.answers.desired, 'Этот тир уже назначен.');
      const tier = db.one(
        'SELECT config FROM tier_definitions WHERE guild=? AND key=?',
        g,
        d.answers.desired,
      );
      requireThat(tier, 'Желаемый тир не настроен.');
      const def = JSON.parse(tier.config);
      if (def.questions)
        for (const question of def.questions)
          validateQuestion(question, String(d.answers[question.key] || ''));
      if (def.domains?.length) validateAnswer('proof', d.answers.proof, { domains: def.domains }, 'tier');
      if (d.key === 'upgrade') {
        const prior = db.one('SELECT config FROM tier_definitions WHERE guild=? AND key=?', g, member.tier);
        requireThat(
          prior && JSON.parse(prior.config).order < def.order,
          'Для повышения выберите тир выше текущего.',
        );
      }
      policy.access = def.reviewers;
      if (def.domains?.length) policy.domains = def.domains;
      policy.tierRole = def.role;
      requireThat(
        !db.one(
          "SELECT 1 FROM tier_applications a JOIN tickets t ON t.id=a.ticket WHERE t.guild=? AND t.author=? AND a.tier=? AND (t.state IN ('open','creating') OR t.created>?)",
          g,
          u,
          d.answers.desired,
          now - def.cooldown * 1000,
        ),
        'Для этого тира уже есть заявка или действует интервал подачи.',
      );
    }
    if (p.kind === 'report') {
      requireThat(
        !db.one(
          "SELECT 1 FROM reports a JOIN tickets t ON t.id=a.ticket WHERE t.guild=? AND t.author=? AND a.target=? AND t.state IN ('open','creating')",
          g,
          u,
          d.answers.target,
        ),
        'Жалоба уже рассматривается.',
      );
      requireThat(
        db.one(
          'SELECT COUNT(*) n FROM reports a JOIN tickets t ON a.ticket=t.id WHERE t.guild=? AND t.author=? AND t.created>?',
          g,
          u,
          now - 3600000,
        ).n < 4,
        'Достигнут часовой лимит жалоб.',
      );
    }
    const id = Number(
      db.run(
        "INSERT INTO tickets(guild,type,author,state,priority,created,updated,policy,answers) VALUES(?,?,?,'creating',?,?,?,?,?)",
        g,
        d.key,
        u,
        p.priority,
        now,
        now,
        JSON.stringify(policy),
        JSON.stringify(d.answers),
      ).lastInsertRowid,
    );
    if (p.kind !== 'support')
      db.run("INSERT INTO applications(ticket,guild,status) VALUES(?,?,'pending')", id, g);
    if (p.kind === 'tier') db.run('INSERT INTO tier_applications VALUES(?,?)', id, d.answers.desired);
    if (p.kind === 'report')
      db.run('INSERT INTO reports VALUES(?,?,?,NULL)', id, d.answers.target, JSON.stringify(d.context));
    db.run('INSERT OR REPLACE INTO cooldowns VALUES(?,?,?,?)', g, u, d.key, now + p.cooldown * 1000);
    return id;
  });
}
export async function materialize(r, g, t) {
  const p = JSON.parse(t.policy),
    bindings = r.config.bindings(g.id, 'channel'),
    roles = r.config.roleIds(g.id, p.access);
  requireThat(roles.length > 0, 'Назначьте роли проверяющих через /setup.');
  for (const id of roles) requireThat(await g.roles.fetch(id), 'Роль проверяющего удалена.');
  const name = (p.naming || 'karma-{id}')
    .replaceAll('{id}', String(t.id))
    .replaceAll('{type}', t.type)
    .slice(0, 90);
  let channel = t.channel ? await g.channels.fetch(t.channel) : null;
  if (!channel && p.mode === 'channel') {
    const parent = await g.channels.fetch(bindings['cat_' + p.category] || p.category).catch(() => null);
    requireThat(parent?.type === C.GuildCategory, 'Привяжите категорию обращений через /setup.');
    const existing = (await g.channels.fetch()).find(
      (c) =>
        c?.type === C.GuildText &&
        c.topic === 'KARMA/' + g.id + '/' + t.id &&
        c.parentId === parent.id &&
        c.permissionOverwrites.cache.get(g.id)?.deny.has(P.ViewChannel) &&
        c.permissionOverwrites.cache.get(g.client.user.id)?.allow.has(P.ManageChannels) &&
        c.permissionOverwrites.cache.every(
          (o) => !o.allow.has(P.ViewChannel) || [g.client.user.id, t.author, ...roles].includes(o.id),
        ),
    );
    const target =
      p.kind === 'report' ? r.store.one('SELECT target FROM reports WHERE ticket=?', t.id)?.target : null;
    const excluded =
      target && ![t.author, g.client.user.id].includes(target)
        ? [{ id: target, type: 1, deny: [P.ViewChannel] }]
        : [];
    channel =
      existing ||
      (await g.channels.create({
        name,
        type: C.GuildText,
        parent: parent.id,
        topic: 'KARMA/' + g.id + '/' + t.id,
        permissionOverwrites: [
          { id: g.id, type: 0, deny: [P.ViewChannel] },
          { id: g.client.user.id, type: 1, allow: [...grant, P.ManageChannels, P.ManageRoles] },
          { id: t.author, type: 1, allow: grant },
          ...roles.map((id) => ({ id, type: 0, allow: grant })),
          ...excluded,
        ],
        reason: 'KARMA #' + t.id,
      }));
  } else if (!channel) {
    const parent = await g.channels.fetch(bindings[p.parent] || p.parent).catch(() => null);
    requireThat(parent?.type === C.GuildText, 'Требуется текстовый канал для приватных веток.');
    requireThat(
      parent.permissionsFor(await g.members.fetch(t.author)).has([P.ViewChannel, P.SendMessagesInThreads]),
      'Заявителю недоступны ветки в этом канале.',
    );
    requireThat(
      roles.every((id) => parent.permissionsFor(g.roles.cache.get(id)).has([P.ViewChannel, P.ManageThreads])),
      'Проверяющим нужны просмотр канала и управление ветками.',
    );
    const active = await parent.threads.fetchActive();
    channel =
      active.threads.find(
        (c) => c.name === name && c.type === C.PrivateThread && c.ownerId === g.client.user.id,
      ) ||
      (await parent.threads.create({
        name,
        type: C.PrivateThread,
        invitable: false,
        reason: 'KARMA #' + t.id,
      }));
  }
  r.store.run('UPDATE tickets SET channel=? WHERE id=?', channel.id, t.id);
  if (channel.isThread()) await channel.members.add(t.author);
  const opened = { ...t, state: 'open', channel: channel.id };
  await refreshTicket(r, opened, channel);
  const answers = JSON.parse(t.answers);
  const full = p.questions.map((q) => q.label + '\n' + (answers[q.key] || '—')).join('\n\n');
  if (full.length > 2800 || Object.values(answers).some((v) => v.length > 300)) {
    await channel.send({
      files: [{ attachment: Buffer.from(full), name: 'anketa-' + t.id + '.txt' }],
      nonce: 'form' + t.id,
      enforceNonce: true,
    });
  }
  r.store.tx(() => {
    r.store.run("UPDATE tickets SET state='open' WHERE id=?", t.id);
    r.store.audit(g.id, 'ticket.open', t.author, String(t.id));
    if (p.autoClose)
      r.store.task('autoclose:' + t.id, g.id, 'autoclose', { id: t.id }, Date.now() + p.autoClose * 3600000);
  });
  await channel
    .send({ content: roles.map((id) => '<@&' + id + '>').join(' '), allowedMentions: { roles, parse: [] } })
    .catch((e) => r.log('ticket.notify', e));
  if (p.kind === 'report') {
    const ctx = JSON.parse(r.store.one('SELECT context FROM reports WHERE ticket=?', t.id).context);
    if (ctx.message)
      await channel
        .send(card('Контекст сообщения', ctx.message + '\n' + (ctx.text || '')))
        .catch((e) => r.log('report.context', e));
  }
  return channel;
}
export async function closeTicket(r, g, t, actor, reason, appStatus = 'cancelled') {
  if (!t.operation) {
    r.store.run(
      "INSERT OR IGNORE INTO scheduled_tasks(key,guild,kind,payload,due) VALUES(?,?,'closeTicket',?,?)",
      'close:' + t.id,
      g.id,
      JSON.stringify({ id: t.id, actor, reason, appStatus }),
      Date.now() + 60000,
    );
  }
  const ch = await g.channels.fetch(t.channel);
  requireThat(ch, 'Канал обращения удалён.');
  if (!t.transcript || !t.operation) await transcript(r, t, ch);
  if (ch.isThread()) await ch.setLocked(true);
  else
    for (const id of [
      t.author,
      ...r.store.all('SELECT user FROM ticket_participants WHERE ticket=?', t.id).map((x) => x.user),
    ])
      await ch.permissionOverwrites.edit(id, { SendMessages: false, AddReactions: false });
  const now = Date.now();
  r.store.tx(() => {
    r.store.run(
      "UPDATE tickets SET state='closed',reason=?,closer=?,closed=?,updated=?,operation=NULL WHERE id=?",
      reason,
      actor,
      now,
      now,
      t.id,
    );
    const changed = r.store.run(
      "UPDATE applications SET status=?,reviewer=? WHERE ticket=? AND status NOT IN ('accepted','rejected','cancelled','expired')",
      appStatus,
      actor,
      t.id,
    );
    if (changed.changes)
      r.store.run(
        'INSERT INTO application_history(ticket,actor,status,detail,time) VALUES(?,?,?,?,?)',
        t.id,
        actor,
        appStatus,
        reason,
        now,
      );
    r.store.run('UPDATE reports SET decision=COALESCE(decision,?) WHERE ticket=?', reason, t.id);
    r.store.audit(g.id, 'ticket.close', actor, String(t.id), { reason });
    r.store.run('DELETE FROM scheduled_tasks WHERE key=?', 'autoclose:' + t.id);
    r.store.run('DELETE FROM scheduled_tasks WHERE key=?', 'close:' + t.id);
    r.store.task('panel:' + t.id, g.id, 'ticketPanel', { id: t.id }, Date.now() + 30000);
  });
  await syncTicket(r, ticketRow(r.store, g.id, t.id), ch);
}
export async function syncTicket(r, t, ch) {
  await refreshTicket(r, t, ch);
  if (ch.isThread() && ['closed', 'archived'].includes(t.state)) await ch.setArchived(true);
  r.store.run('DELETE FROM scheduled_tasks WHERE key=?', 'panel:' + t.id);
}
export function openPanel(r, g, key) {
  const p = r.config.types(g);
  if (key) {
    requireThat(Object.hasOwn(p, key), 'Неизвестный тип.');
    return card(
      p[key].title,
      p[key].description,
      [row(button('tstart:' + key, 'Заполнить анкету', 1))],
      r.config.settings(g),
    );
  }
  const menu = select(
    'tchoose',
    'Тип обращения',
    Object.entries(p)
      .slice(0, 25)
      .map(([k, v]) => [k, v.title]),
  );
  for (const option of menu.options) {
    const t = p[option.value];
    option.description = t.description.slice(0, 100);
    if (t.emoji) {
      const custom = /^<(a?):([\w]+):(\d{17,20})>$/.exec(t.emoji);
      option.emoji = custom ? { animated: !!custom[1], name: custom[2], id: custom[3] } : { name: t.emoji };
    }
  }
  return card(
    'KARMA Support',
    'Выберите тему обращения. Анкету увидят сотрудники, назначенные на эту категорию.',
    [row(menu)],
    r.config.settings(g),
  );
}
export function installTickets(r) {
  r.command(
    cmd(
      'ticket',
      'Обращения',
      sub('open', 'Заполнить анкету', str('type', 'Код типа обращения', false)),
      sub('panel', 'Опубликовать панель', str('type', 'Код категории', false)),
      sub('list', 'Мои обращения'),
    ),
    async (i) => {
      const action = i.options.getSubcommand(),
        key = i.options.getString('type');
      if (action === 'open') return key ? begin(r, i, key) : respond(i, openPanel(r, i.guildId));
      if (action === 'panel') {
        management(i);
        const payload = openPanel(r, i.guildId, key),
          id = r.store.draft(
            i.guildId,
            i.user.id,
            'confirm',
            { action: 'ticket.publish', data: { key, channel: i.channelId, payload } },
            180000,
          );
        return respond(i, {
          ...payload,
          content: 'Публикация панели в <#' + i.channelId + '>',
          components: [
            ...payload.components.map((line) => ({
              ...line,
              components: line.components.map((c) => ({ ...c, disabled: true })),
            })),
            row(button('confirm:' + id, 'Подтвердить публикацию', 1)),
          ],
        });
      }
      const list = r.store.all(
        'SELECT id,state,channel FROM tickets WHERE guild=? AND author=? ORDER BY id DESC LIMIT 20',
        i.guildId,
        i.user.id,
      );
      return respond(
        i,
        card(
          'Мои обращения',
          list
            .map(
              (x) =>
                '#' + x.id + ' · ' + ticketStates[x.state] + (x.channel ? ' · <#' + x.channel + '>' : ''),
            )
            .join('\n') || 'Обращений пока нет.',
        ),
      );
    },
    { module: 'tickets' },
  );
  r.confirm('ticket.publish', async (i, { key, channel, payload }) => {
    management(i);
    r.enabled(i, 'tickets');
    requireThat(
      i.channelId === channel && JSON.stringify(openPanel(r, i.guildId, key)) === JSON.stringify(payload),
      'Панель изменилась. Повторите предпросмотр.',
    );
    for (const who of [i.member, i.guild.members.me])
      requireThat(
        i.channel.permissionsFor(who)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks']),
        'Проверьте доступ к каналу.',
      );
    const m = await i.channel.send(payload);
    r.store.audit(i.guildId, 'panel.publish', i.user.id, channel, { message: m.id });
    return respond(i, 'Панель опубликована.');
  });
  r.on('tstart', (i, [key]) => begin(r, i, key));
  r.on('tchoose', (i) => begin(r, i, i.values[0]));
  r.on('tnext', (i, [id]) => formPage(r, i, id));
  r.on('tform', async (i, [draft, page]) => {
    r.enabled(i, 'tickets');
    const d = r.readDraft(i, draft, 'ticket');
    if (d.policy.kind !== 'support') r.enabled(i, d.policy.kind);
    requireThat(d.page === Number(page), 'Этап уже завершён.');
    for (const q of d.policy.questions.slice(d.page * 5, d.page * 5 + 5)) {
      let v =
        q.input === 'select'
          ? i.fields.getStringSelectValues(q.key)[0] || ''
          : ['user', 'role', 'channel'].includes(q.input)
            ? i.fields[
                { user: 'getSelectedUsers', role: 'getSelectedRoles', channel: 'getSelectedChannels' }[
                  q.input
                ]
              ](q.key)?.first()?.id || ''
            : i.fields.getTextInputValue(q.key).trim();
      if (q.key === 'desired' && d.context.desired) v = d.context.desired;
      validateQuestion(q, v);
      if (q.key === 'target' && d.context.target) v = d.context.target;
      requireThat(!q.required || v, 'Заполните поле «' + q.label + '».');
      const domains =
        q.key === 'proof' && d.policy.kind === 'tier' && d.answers.desired
          ? tierPolicy(r, i.guildId, d.key, d.answers.desired).domains
          : d.policy.domains;
      if (v) validateAnswer(q.key, v, domains ? { domains } : r.config.settings(i.guildId), d.policy.kind);
      d.answers[q.key] = v;
    }
    if (d.policy.kind === 'tier' && !d.context.desired && d.answers.desired) {
      const next = tierPolicy(r, i.guildId, d.key, d.answers.desired);
      if (JSON.stringify(next.questions) !== JSON.stringify(d.policy.questions)) {
        d.context.desired = d.answers.desired;
        d.policy = next;
        d.page = 0;
        r.store.run('UPDATE drafts SET data=? WHERE id=?', JSON.stringify(d), draft);
        return respond(
          i,
          card('Анкета тира', 'Заполните индивидуальную анкету выбранного тира.', [
            row(button('tnext:' + draft, 'Продолжить', 1)),
          ]),
        );
      }
    }
    if ((d.page + 1) * 5 < d.policy.questions.length) {
      d.page++;
      r.store.run('UPDATE drafts SET data=? WHERE id=?', JSON.stringify(d), draft);
      return respond(
        i,
        card('Анкета сохранена', 'Продолжите заполнение.', [row(button('tnext:' + draft, 'Продолжить', 1))]),
      );
    }
    const bindings = r.config.bindings(i.guildId, 'channel');
    const dest = d.policy.mode === 'thread' ? d.policy.parent : d.policy.category;
    requireThat(
      bindings[d.policy.mode === 'thread' ? dest : 'cat_' + dest] || /^\d{17,20}$/.test(dest),
      'Сотруднику нужно привязать категорию или канал через /setup.',
    );
    requireThat(
      r.config.roleIds(i.guildId, d.policy.access).length,
      'Сотруднику нужно привязать роли проверяющих через /setup.',
    );
    await i.deferReply({ flags: ephemeral });
    if (d.policy.kind === 'report') {
      requireThat(d.answers.target !== i.user.id, 'Выберите другого участника.');
      const target = await i.guild.members.fetch(d.answers.target).catch((e) => {
        if (e.code === 10007) return null;
        throw e;
      });
      const staffIds = r.config.roleIds(i.guildId, [
        'owner',
        'leader',
        'deputy_leader',
        'high',
        'moderator',
        'ticket_support',
      ]);
      if (
        d.key === 'complaint' &&
        target &&
        (target.permissions.has(P.Administrator) || staffIds.some((k) => target.roles.cache.has(k)))
      ) {
        d.key = 'staff';
        d.policy = r.config.types(i.guildId).staff;
        requireThat(
          d.policy.questions.every((q) => !q.required || d.answers[q.key]),
          'Для жалобы на сотрудника заполните анкету «Жалоба на администрацию».',
        );
      }
    }
    const id = reserve(r, i, d, draft);
    await r.locks.with('ticket:' + id, async () => {
      try {
        const ch = await materialize(r, i.guild, ticketRow(r.store, i.guildId, id));
        return respond(i, 'Обращение #' + id + ' открыто в <#' + ch.id + '>.');
      } catch (e) {
        r.store.task('create:' + id, i.guildId, 'createTicket', { id }, Date.now() + 60000);
        throw e;
      }
    });
  });
  r.command(
    cmd(
      'report',
      'Приватные жалобы',
      sub('user', 'Подать жалобу', user()),
      sub('status', 'Статус жалобы', num('id', 'Номер жалобы')),
      sub('history', 'Мои жалобы'),
    ),
    (i) => {
      const a = i.options.getSubcommand();
      if (a === 'user') return begin(r, i, 'complaint', { target: i.options.getUser('user').id });
      if (a === 'status') {
        const t = ticketRow(r.store, i.guildId, i.options.getInteger('id'));
        const report = r.store.one(
          'SELECT p.target,p.decision,a.status FROM reports p JOIN applications a ON a.ticket=p.ticket WHERE p.ticket=?',
          t.id,
        );
        requireThat(
          report && (t.author === i.user.id || (report.target !== i.user.id && canReview(i, t, r.config))),
          'Жалоба недоступна.',
        );
        return respond(
          i,
          'Жалоба #' +
            t.id +
            ' · ' +
            statusLabels[report.status] +
            ' · ' +
            priorityLabels[t.priority] +
            '\nОтветственный: ' +
            (t.assignee ? '<@' + t.assignee + '>' : 'не назначен') +
            '\n' +
            (report.decision || 'Идёт рассмотрение.'),
        );
      }
      const list = r.store.all(
        'SELECT t.id,t.state FROM tickets t JOIN reports p ON p.ticket=t.id WHERE t.guild=? AND t.author=? ORDER BY t.id DESC LIMIT 25',
        i.guildId,
        i.user.id,
      );
      return respond(
        i,
        card(
          'Ваши жалобы',
          list.map((x) => '#' + x.id + ' · ' + ticketStates[x.state]).join('\n') || 'Жалоб нет.',
        ),
      );
    },
    { module: 'report' },
  );
  r.command(
    menu('Пожаловаться на пользователя', 2),
    (i) => begin(r, i, 'complaint', { target: i.targetUser.id }),
    { module: 'report' },
  );
  r.command(
    menu('Пожаловаться на сообщение', 3),
    (i) =>
      begin(r, i, 'complaint', {
        target: i.targetMessage.author.id,
        message: i.targetMessage.url,
        text: i.targetMessage.content.slice(0, 500),
      }),
    { module: 'report' },
  );
}
