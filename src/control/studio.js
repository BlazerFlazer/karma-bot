import { randomUUID, createHash } from 'node:crypto';
import { PermissionFlagsBits as P, ChannelType as C } from 'discord.js';
import { check, object, requirePermission, snow, string, pageOffset } from './errors.js';
import { embedPayload, seedEmbed } from '../modules/embeds.js';
import { validateStudioConfig, saveStudioConfig, tierSeed } from '../modules/dashboard.js';
import { types } from '../core/catalog.js';
import { row, button, select, safeMentions } from '../core/ui.js';
import { begin } from '../modules/tickets.js';
export const studioPerm = { ticket: 'tickets.configure', tier: 'tiers.configure', embed: 'embeds.create' };
const publishPerm = { ticket: 'tickets.publish', tier: 'tiers.publish', embed: 'embeds.publish' };
const template = (title, description) => ({ ...seedEmbed, title, description, color: '#7956db' });
export const embedTemplates = Object.entries({
  Объявление: 'Новости семьи KARMA',
  Набор: 'Приём заявок открыт',
  'Панель обращений': 'Связаться с сотрудниками',
  Тир: 'Требования к тиру',
  Мероприятие: 'Предстоящая встреча',
  Сотрудникам: 'Служебное сообщение',
  Правила: 'Правила семьи',
  Состав: 'Обновление состава',
  Приветствие: 'Добро пожаловать, {username}!',
  Предупреждение: 'Уведомление модерации',
}).map(([name, title]) => ({ name, config: template(title, '{family_name}') }));
export function digest(x) {
  return createHash('sha256')
    .update(JSON.stringify(x ?? null))
    .digest('hex');
}
export function liveConfig(r, g, kind, key) {
  if (kind === 'ticket') return r.config.types(g)[key] || null;
  const table = kind === 'tier' ? 'tier_definitions' : 'embed_templates',
    column = kind === 'tier' ? 'key' : 'name';
  const found = r.store.one('SELECT config FROM ' + table + ' WHERE guild=? AND ' + column + '=?', g, key);
  return found ? JSON.parse(found.config) : null;
}
export function seeds(r, g) {
  return { types: r.config.types(g), tier: tierSeed, embed: seedEmbed, templates: embedTemplates };
}
function allowed(r, a, d, edit = false) {
  if (!d || d.guild !== a.guild.id || !a.permissions.has(studioPerm[d.kind])) return false;
  if (d.owner === a.member.id) return true;
  return (
    JSON.parse(d.shared).some((id) => a.member.roles.cache.has(id)) &&
    (!edit || a.permissions.has('drafts.share'))
  );
}
export function draftRow(r, a, id, edit = false) {
  const d = r.store.one('SELECT * FROM control_drafts WHERE id=? AND guild=?', id, a.guild.id);
  check(allowed(r, a, d, edit), 404, 'Черновик недоступен.');
  return d;
}
const read = (d) => ({ ...d, body: JSON.parse(d.body), shared: JSON.parse(d.shared) });
export function listDrafts(r, a, q = {}) {
  const kinds = Object.keys(studioPerm).filter((k) => a.permissions.has(studioPerm[k]));
  return r.store
    .all(
      "SELECT id,owner,kind,title,shared,state,version,updated,(SELECT channel FROM control_publications p WHERE p.draft=d.id AND p.status='sent' ORDER BY updated DESC LIMIT 1) channel,(SELECT message FROM control_publications p WHERE p.draft=d.id AND p.status='sent' ORDER BY updated DESC LIMIT 1) message FROM control_drafts d WHERE guild=? AND kind IN (SELECT value FROM json_each(?)) AND (owner=? OR EXISTS(SELECT 1 FROM json_each(d.shared) WHERE value IN (SELECT value FROM json_each(?)))) AND (?='' OR instr(karma_lower(d.title),?)>0) ORDER BY updated DESC,id LIMIT 25 OFFSET ?",
      a.guild.id,
      JSON.stringify(kinds),
      a.member.id,
      JSON.stringify([...a.member.roles.cache.keys()]),
      String(q.q || '').toLowerCase(),
      String(q.q || '').toLowerCase(),
      pageOffset(q.offset),
    )
    .map((d) => {
      const visible =
        d.channel &&
        a.guild.channels.cache
          .get(d.channel)
          ?.permissionsFor(a.member)
          ?.has([P.ViewChannel, P.ReadMessageHistory]);
      return {
        ...d,
        shared: JSON.parse(d.shared),
        channel: visible ? d.channel : null,
        message: visible ? d.message : null,
      };
    });
}
function vars(a) {
  return {
    user: '<@' + a.member.id + '>',
    username: a.profile.username,
    server: a.guild.name,
    member_count: a.guild.memberCount,
    ticket_id: '—',
    family_name: 'KARMA',
    date: new Date().toLocaleDateString('ru-RU'),
  };
}
export function renderDraft(kind, b, a, id = 'preview') {
  const result = embedPayload(b.appearance, vars(a)),
    e = result.embeds[0];
  const action = kind === 'ticket' ? 'tstart:' + b.key : kind === 'tier' ? 'controltier:' + b.key : null;
  if (action) result.components.push(row(button(action, b.buttonLabel || 'Заполнить заявку', 1)));
  if (b.menu?.length) {
    if (kind === 'ticket')
      result.components.push(
        row(
          select(
            'tchoose',
            'Выберите обращение',
            b.menu.map((x) => [x.value, x.label]),
          ),
        ),
      );
    else
      result.components.push(
        row(
          select(
            'cinfo:' + id,
            'Подробнее',
            b.menu.map((x, n) => [n, x.label]),
          ),
        ),
      );
  }
  if (b.fileName || b.fileText)
    check(
      b.layout === 'v2' && /^[a-zA-Z0-9_-]{1,50}\.txt$/.test(b.fileName) && string(b.fileText, 1, 8000),
      400,
      'Для файла выберите Components V2, имя .txt и текст до 8000 символов.',
    );
  if (b.layout !== 'v2') return result;
  const components = [];
  if (e.author) components.push({ type: 10, content: e.author.name });
  const title = { type: 10, content: '## ' + (e.title || 'KARMA') };
  components.push(
    e.thumbnail
      ? { type: 9, components: [title], accessory: { type: 11, media: { url: e.thumbnail.url } } }
      : title,
  );
  if (b.separator !== false) components.push({ type: 14, divider: true, spacing: 1 });
  if (e.description) components.push({ type: 10, content: e.description });
  for (const f of e.fields) components.push({ type: 10, content: '**' + f.name + '**\n' + f.value });
  if (e.image) components.push({ type: 12, items: [{ media: { url: e.image.url } }] });
  if (e.url) components.push({ type: 10, content: '[Подробнее](' + e.url + ')' });
  if (e.footer || e.timestamp)
    components.push({
      type: 10,
      content:
        '-# ' +
        [e.footer?.text, e.timestamp ? '<t:' + Math.floor(Date.parse(e.timestamp) / 1000) + ':f>' : '']
          .filter(Boolean)
          .join(' · '),
    });
  if (b.fileName) components.push({ type: 13, file: { url: 'attachment://' + b.fileName } });
  components.push(...result.components);
  check(
    components.length +
      components.reduce((n, c) => n + (c.components?.length || 0) + (c.accessory ? 1 : 0), 1) <=
      40,
    400,
    'Для Components V2 доступно до 40 элементов.',
  );
  check(
    components.reduce(
      (n, c) => n + (c.content?.length || 0) + (c.type === 9 ? title.content.length : 0),
      0,
    ) <= 4000,
    400,
    'В макете V2 слишком много текста.',
  );
  return {
    flags: 32768,
    components: [{ type: 17, accent_color: e.color, components }],
    allowedMentions: safeMentions,
  };
}
export function validateBody(kind, b, a, strict = true) {
  object(b);
  check(
    Object.hasOwn(studioPerm, kind) && string(b.key, 1, kind === 'embed' ? 64 : 30),
    400,
    'Укажите код или название шаблона.',
  );
  if (kind !== 'embed')
    check(
      /^[a-z][a-z0-9_-]{0,29}$/.test(b.key) && !['constructor', 'prototype'].includes(b.key),
      400,
      'Код должен начинаться со строчной латинской буквы.',
    );
  const e = object(b.appearance);
  check(
    string(e.title, 0, 256) &&
      string(e.description, 0, 4096) &&
      string(e.author, 0, 256) &&
      string(e.footer, 0, 2048),
    400,
    'Проверьте длину текста.',
  );
  check(
    Array.isArray(e.fields) &&
      e.fields.every((f) => f && string(f.name, 1, 256) && string(f.value, 1, 1024)) &&
      Array.isArray(e.buttons) &&
      e.buttons.every((btn) => btn && string(btn.label, 1, 80)),
    400,
    'Заполните названия и значения элементов.',
  );
  check(!b.buttonLabel || string(b.buttonLabel, 1, 80), 400, 'Подпись кнопки слишком длинная.');
  check(
    !b.menu ||
      (Array.isArray(b.menu) &&
        b.menu.length <= 25 &&
        b.menu.every(
          (x) => x && string(x.label, 1, 100) && string(x.value, 1, kind === 'ticket' ? 30 : 500),
        ) &&
        (kind !== 'ticket' || new Set(b.menu.map((x) => x.value)).size === b.menu.length)),
    400,
    'Проверьте меню.',
  );
  check(!b.layout || ['v2', 'embed'].includes(b.layout), 400, 'Неизвестная компоновка.');
  if (strict && kind !== 'embed') validateStudioConfig(kind === 'ticket' ? 'type' : 'tier', b.key, b.config);
  renderDraft(kind, b, a);
}
export function getDraft(r, a, id) {
  return read(draftRow(r, a, id));
}
export function saveDraft(r, a, input, id) {
  object(input);
  const prior = id ? draftRow(r, a, id, true) : null,
    kind = prior?.kind || input.kind;
  check(Object.hasOwn(studioPerm, kind), 400, 'Неизвестный тип.');
  requirePermission(a, studioPerm[kind]);
  check(string(input.title, 1, 100), 400, 'Укажите название черновика.');
  validateBody(kind, input.body, a, false);
  const db = r.store,
    g = a.guild.id,
    u = a.member.id,
    now = Date.now();
  id = prior?.id || randomUUID();
  const body = { ...input.body };
  delete body.base;
  const old = prior ? JSON.parse(prior.body) : null;
  if (input.base !== undefined)
    check(
      typeof input.base === 'string' && /^[0-9a-f]{64}$/.test(input.base),
      400,
      'Неверная версия исходной конфигурации.',
    );
  body.base = old?.key === body.key ? old.base : (input.base ?? digest(liveConfig(r, g, kind, body.key)));
  db.tx(() => {
    if (prior) {
      check(prior.state !== 'archived', 409, 'Сначала создайте копию архива.');
      check(
        db.run(
          "UPDATE control_drafts SET title=?,body=?,updated=?,state=CASE WHEN shared='[]' THEN 'personal' ELSE 'shared' END,version=version+1 WHERE id=? AND version=?",
          input.title.trim(),
          JSON.stringify(body),
          now,
          id,
          input.version,
        ).changes,
        409,
        'Черновик уже изменился. Обновите страницу.',
      );
    } else
      db.run(
        'INSERT INTO control_drafts(id,guild,owner,kind,title,body,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        id,
        g,
        u,
        kind,
        input.title.trim(),
        JSON.stringify(body),
        now,
        now,
      );
    db.audit(g, 'control.draft.save', u, id, { kind, version: (prior?.version || 0) + 1, outcome: 'ok' });
  });
  return getDraft(r, a, id);
}
export function transition(r, a, id, input) {
  const d = draftRow(r, a, id, input.action !== 'duplicate'),
    db = r.store;
  check(d.version === input.version, 409, 'Версия черновика изменилась.');
  if (input.action === 'duplicate')
    return saveDraft(r, a, {
      kind: d.kind,
      title: (d.title + ' · копия').slice(0, 100),
      body: JSON.parse(d.body),
    });
  let state = d.state,
    shared = JSON.parse(d.shared);
  if (input.action === 'share') {
    requirePermission(a, 'drafts.share');
    check(d.owner === a.member.id && input.confirm === true, 403, 'Требуется подтверждение создателя.');
    shared = input.roles;
    check(
      Array.isArray(shared) &&
        shared.length <= 20 &&
        shared.every((id) => snow(id) && id !== a.guild.id && a.guild.roles.cache.has(id)),
      400,
      'Проверьте роли сотрудников.',
    );
    state = shared.length ? 'shared' : 'personal';
  } else if (input.action === 'ready') {
    check(d.state !== 'archived', 409, 'Черновик в архиве.');
    validateBody(d.kind, JSON.parse(d.body), a);
    state = 'ready';
  } else if (input.action === 'archive') {
    check(d.owner === a.member.id && input.confirm === true, 403, 'Подтвердите архивирование.');
    state = 'archived';
  } else if (input.action === 'delete') {
    check(d.owner === a.member.id && input.confirm === true, 403, 'Подтвердите удаление.');
    check(
      !db.one('SELECT 1 FROM control_publications WHERE draft=?', id),
      409,
      'Для опубликованного материала доступен архив.',
    );
    db.tx(() => {
      db.run('DELETE FROM control_previews WHERE draft=?', id);
      db.run('DELETE FROM control_drafts WHERE id=?', id);
      db.audit(a.guild.id, 'control.draft.delete', a.member.id, id);
    });
    return { deleted: true };
  } else check(false, 400, 'Неизвестное действие.');
  db.tx(() => {
    db.run(
      'UPDATE control_drafts SET state=?,shared=?,updated=?,version=version+1 WHERE id=?',
      state,
      JSON.stringify(shared),
      Date.now(),
      id,
    );
    db.audit(a.guild.id, 'control.draft.' + input.action, a.member.id, id, {
      before: d.state,
      after: state,
      roles: shared,
    });
  });
  return getDraft(r, a, id);
}
export async function applyConfig(r, a, id, input) {
  const d = draftRow(r, a, id, true),
    b = JSON.parse(d.body),
    g = a.guild.id;
  check(
    input.confirm === true && d.version === input.version && d.state !== 'archived',
    409,
    'Проверьте версию и подтвердите сохранение.',
  );
  validateBody(d.kind, b, a);
  check(
    b.base === digest(liveConfig(r, g, d.kind, b.key)),
    409,
    'Настройки изменились в Discord или другом черновике. Откройте свежую версию.',
  );
  const prior = liveConfig(r, g, d.kind, b.key);
  if (d.kind === 'tier' && a.member.id !== a.guild.ownerId) {
    const reward = a.guild.roles.cache.get(b.config.role);
    check(
      reward && a.member.roles.highest.comparePositionTo(reward) > 0,
      403,
      'Выберите выдаваемую роль ниже своей роли Discord.',
    );
  }
  if (d.kind === 'ticket' && !a.permissions.has('settings.manage')) {
    const source = prior || types[b.key] || types.support;
    check(
      ['access', 'allowed', 'log', 'category', 'parent', 'kind', 'mode'].every(
        (k) => digest(source[k]) === digest(b.config[k]),
      ),
      403,
      'Изменение доступа или назначения каналов требует права настройки сервера.',
    );
  }
  const guard = () =>
    check(
      draftRow(r, a, id, true).version === d.version && b.base === digest(liveConfig(r, g, d.kind, b.key)),
      409,
      'Конфигурация изменилась во время сохранения.',
    );
  const finish = () => {
    b.base = digest(liveConfig(r, g, d.kind, b.key));
    r.store.run(
      'UPDATE control_drafts SET body=?,version=version+1,updated=? WHERE id=?',
      JSON.stringify(b),
      Date.now(),
      id,
    );
    r.store.audit(g, 'control.config.apply', a.member.id, id, { kind: d.kind, key: b.key, after: b.base });
  };
  if (d.kind !== 'embed')
    await saveStudioConfig(
      r,
      { guild: a.guild, guildId: g, user: { id: a.member.id } },
      d.kind === 'ticket' ? 'type' : 'tier',
      b.key,
      b.config,
      guard,
      finish,
    );
  else
    r.store.tx(() => {
      guard();
      r.store.run(
        'INSERT OR REPLACE INTO embed_templates VALUES(?,?,?)',
        g,
        b.key,
        JSON.stringify(b.appearance),
      );
      finish();
    });
  return getDraft(r, a, id);
}
async function destination(a, id) {
  check(snow(id), 400, 'Выберите канал.');
  const ch = await a.guild.channels.fetch(id).catch(() => null);
  check(ch?.type === C.GuildText && ch.guild.id === a.guild.id, 404, 'Текстовый канал недоступен.');
  for (const member of [a.member, a.guild.members.me])
    check(
      ch.permissionsFor(member)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]),
      403,
      'Проверьте права сотрудника и бота в канале.',
    );
  return ch;
}
function publishable(r, a, id, version) {
  const d = draftRow(r, a, id, true),
    b = JSON.parse(d.body);
  requirePermission(a, publishPerm[d.kind]);
  check(
    d.version === version && ['ready', 'published'].includes(d.state),
    409,
    'Сначала подготовьте актуальную версию к публикации.',
  );
  validateBody(d.kind, b, a);
  if (d.kind !== 'embed')
    check(
      digest(liveConfig(r, a.guild.id, d.kind, b.key)) === digest(b.config),
      409,
      'Сначала сохраните конфигурацию для Discord.',
    );
  if (d.kind === 'ticket' && b.menu)
    check(
      b.menu.every((x) => Object.hasOwn(r.config.types(a.guild.id), x.value)),
      400,
      'Меню содержит неизвестную категорию.',
    );
  return { d, b };
}
export async function prepublish(r, a, id, input) {
  const { d, b } = publishable(r, a, id, input.version),
    ch = await destination(a, input.channel),
    pid = randomUUID();
  if (b.fileName)
    for (const who of [a.member, a.guild.members.me])
      check(ch.permissionsFor(who)?.has(P.AttachFiles), 403, 'Требуется право прикреплять файлы.');
  const payload = renderDraft(d.kind, b, a, id);
  r.store.run('DELETE FROM control_previews WHERE expires<=?', Date.now());
  r.store.run(
    'INSERT INTO control_previews VALUES(?,?,?,?,?,?,?,?)',
    pid,
    a.guild.id,
    a.member.id,
    id,
    d.version,
    ch.id,
    JSON.stringify(payload),
    Date.now() + 180000,
  );
  const previous = r.store.one(
    "SELECT message FROM control_publications WHERE draft=? AND channel=? AND status='sent' ORDER BY updated DESC LIMIT 1",
    id,
    ch.id,
  );
  return { token: pid, payload, channel: ch.name, channelId: ch.id, update: !!previous };
}
export async function publish(r, a, id, input) {
  requirePermission(a, 'dashboard.access');
  check(input.confirm === true, 400, 'Требуется итоговое подтверждение.');
  const db = r.store,
    g = a.guild.id,
    preview = db.one(
      'SELECT * FROM control_previews WHERE id=? AND draft=? AND guild=? AND user=? AND expires>?',
      input.token || '',
      id,
      g,
      a.member.id,
      Date.now(),
    );
  check(preview, 409, 'Предпросмотр устарел. Откройте его снова.');
  return r.locks.with('studio:' + id, async () => {
    const { d, b } = publishable(r, a, id, preview.version),
      ch = await destination(a, preview.channel),
      payload = JSON.parse(preview.payload);
    publishable(r, a, id, preview.version);
    if (b.fileName) {
      for (const who of [a.member, a.guild.members.me])
        check(ch.permissionsFor(who)?.has(P.AttachFiles), 403, 'Требуется право прикреплять файлы.');
      payload.files = [{ attachment: Buffer.from(b.fileText, 'utf8'), name: b.fileName }];
    }
    let job = db.one(
      'SELECT * FROM control_publications WHERE draft=? AND version=? AND channel=?',
      id,
      d.version,
      ch.id,
    );
    if (job?.status === 'sent') {
      const msg = await ch.messages.fetch(job.message);
      check(
        msg?.id && msg.author.id === r.client.user.id,
        404,
        'Опубликованное сообщение удалено. Создайте копию панели.',
      );
      return {
        channel: ch.id,
        message: job.message,
        url: 'https://discord.com/channels/' + g + '/' + ch.id + '/' + job.message,
      };
    }
    const previous = db.one(
      "SELECT message,snapshot FROM control_publications WHERE draft=? AND channel=? AND status='sent' ORDER BY updated DESC LIMIT 1",
      id,
      ch.id,
    );
    const jobId = job?.id || randomUUID(),
      nonce = jobId.replaceAll('-', '').slice(0, 24);
    if (!job)
      db.run(
        "INSERT INTO control_publications(id,guild,draft,version,channel,actor,status,updated,snapshot) VALUES(?,?,?,?,?,?,'sending',?,?)",
        jobId,
        g,
        id,
        d.version,
        ch.id,
        a.member.id,
        Date.now(),
        JSON.stringify(b),
      );
    try {
      let msg;
      if (previous) {
        const old = await ch.messages.fetch(previous.message);
        check(old?.author?.id === r.client.user.id, 409, 'Сообщение недоступно для обновления.');
        check(
          (JSON.parse(previous.snapshot).layout === 'v2') === (b.layout === 'v2'),
          409,
          'Для смены формата Discord создайте копию панели.',
        );
        publishable(r, a, id, preview.version);
        msg = await old.edit({ ...payload, attachments: [] });
      } else {
        if (job && job.status !== 'failed' && Date.now() - job.updated > 120000) {
          check(false, 409, 'Статус первой отправки неизвестен. Сверьте канал перед созданием новой копии.');
        }
        if (job?.status === 'failed')
          db.run("UPDATE control_publications SET status='sending',updated=? WHERE id=?", Date.now(), jobId);
        msg = await ch.send({ ...payload, nonce, enforceNonce: true });
      }
      check(msg?.id, 502, 'Discord не подтвердил отправку.');
      db.tx(() => {
        db.run(
          "UPDATE control_publications SET status='sent',message=?,updated=? WHERE id=?",
          msg.id,
          Date.now(),
          jobId,
        );
        db.run("UPDATE control_drafts SET state='published' WHERE id=? AND version=?", id, d.version);
        db.audit(g, 'control.publish.ok', a.member.id, id, {
          kind: d.kind,
          channel: ch.id,
          message: msg.id,
          outcome: 'ok',
        });
      });
      return {
        channel: ch.id,
        message: msg.id,
        url: 'https://discord.com/channels/' + g + '/' + ch.id + '/' + msg.id,
      };
    } catch (e) {
      if (Number.isInteger(e.status) && e.status >= 400 && e.status < 500)
        db.run("UPDATE control_publications SET status='failed',updated=? WHERE id=?", Date.now(), jobId);
      db.audit(g, 'control.publish.failed', a.member.id, id, {
        channel: ch.id,
        code: String(e.code || 'delivery'),
        outcome: 'failed',
      });
      throw e;
    }
  });
}
export function installControlComponents(r) {
  r.on('controltier', (i, [key]) => {
    r.enabled(i, 'tier');
    check(
      r.store.one('SELECT 1 FROM tier_definitions WHERE guild=? AND key=?', i.guildId, key),
      404,
      'Тир недоступен.',
    );
    return begin(r, i, 'tier', { desired: key });
  });
  r.on('cinfo', async (i, [id]) => {
    const row = r.store.one(
      "SELECT snapshot FROM control_publications WHERE guild=? AND draft=? AND channel=? AND message=? AND status='sent' ORDER BY updated DESC LIMIT 1",
      i.guildId,
      id,
      i.channelId,
      i.message.id,
    );
    check(row, 404, 'Панель недоступна.');
    const item = JSON.parse(row.snapshot).menu?.[Number(i.values[0])];
    check(item, 400, 'Пункт меню не найден.');
    return i.reply({ content: item.value, flags: 64, allowedMentions: safeMentions });
  });
}
