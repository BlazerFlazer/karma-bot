import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ids, runtime, interaction } from './helpers/runtime.js';
import { permissionsFor, presets, changeGrant, nativeAllowed } from '../src/control/rbac.js';
import {
  saveDraft,
  transition,
  applyConfig,
  renderDraft,
  prepublish,
  publish,
  getDraft,
} from '../src/control/studio.js';
import { tierSeed } from '../src/modules/dashboard.js';
import { seedEmbed } from '../src/modules/embeds.js';
import { createTicket, ticketList, ticketDetail, actOnTicket } from '../src/control/operations.js';
import { tierPolicy } from '../src/modules/tickets.js';
import { dispatchOperation, operationCatalog, tierOrder, tiers } from '../src/control/resources.js';
import { authentication, hash } from '../src/control/auth.js';
import { PermissionsBitField } from 'discord.js';
test('Копия бота версии 1 восстанавливается в схему 6 без возобновления сеансов', (t) => {
  const r = runtime(t),
    name = 'karma-2026-11-23T00-00-00-000Z-12345678.sqlite',
    dir = join(r.store.dir, 'backups');
  mkdirSync(dir, { recursive: true });
  const old = new DatabaseSync(join(dir, name));
  try {
    old.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)');
    for (let n = 1; n <= 4; n++) {
      const sql = readFileSync(
        new URL('../src/database/migrations/' + String(n).padStart(3, '0') + '.sql', import.meta.url),
        'utf8',
      );
      old.exec(sql);
      old.prepare('INSERT INTO schema_migrations VALUES(?)').run(n);
    }
    old.prepare('INSERT INTO guild_settings(guild) VALUES(?)').run(ids.guild);
    old
      .prepare('INSERT INTO audit_logs(guild,action,actor,target,detail,time) VALUES(?,?,?,?,?,?)')
      .run(ids.guild, 'old.entry', ids.owner, ids.guild, '{}', 1);
  } finally {
    old.close();
  }
  draft(r, as(r), 'embed', null);
  r.store.restore(name, ids.guild);
  assert.equal(r.store.one("SELECT count(*) n FROM audit_logs WHERE action='old.entry'").n, 1);
  assert.equal(r.store.one('SELECT max(version) v FROM schema_migrations').v, 6);
  assert.equal(r.store.one('SELECT count(*) n FROM control_drafts').n, 0);
  assert.equal(r.store.one('PRAGMA integrity_check').integrity_check, 'ok');
});
test('Публикация панели из Discord использует личный предпросмотр и одноразовое подтверждение', async (t) => {
  const r = runtime(t),
    request = interaction(r, {
      userId: ids.owner,
      commandName: 'ticket',
      options: { getSubcommand: () => 'panel', getString: () => 'support' },
    });
  await r.dispatch(request);
  assert.equal(r.results.saved.size, 0);
  const payload = request.replies.at(-1);
  assert.ok(payload.flags & 64);
  const customId = payload.components.at(-1).components[0].custom_id;
  await r.dispatch(interaction(r, { userId: ids.owner, customId }));
  assert.equal(r.results.saved.size, 1);
  await r.dispatch(interaction(r, { userId: ids.owner, customId }));
  assert.equal(r.results.saved.size, 1);
});
test('Одновременные чтения одного сеанса переиспользуют проверку участника', async (t) => {
  const r = runtime(t),
    token = 'concurrent-fixture',
    auth = authentication(r, { guild: ids.guild, origin: 'http://127.0.0.1' });
  r.store.run(
    'INSERT INTO control_sessions VALUES(?,?,?,?,?)',
    hash(token),
    ids.guild,
    ids.owner,
    JSON.stringify({ id: ids.owner }),
    Date.now() + 60000,
  );
  const s = auth.session({ headers: { cookie: 'karma-session=' + token } });
  let release,
    fetches = 0;
  r.guild.members.fetch = () => {
    fetches++;
    return new Promise((done) => (release = done));
  };
  const work = Promise.all([auth.actor(s), auth.actor(s)]);
  release(r.people.get(ids.owner));
  assert.equal((await work).length, 2);
  assert.equal(fetches, 1);
});
const as = (r, id = ids.owner) => {
  const member = r.people.get(id);
  return {
    member,
    guild: r.guild,
    permissions: permissionsFor(r.config, r.guild, member),
    profile: { id, username: 'QA' },
  };
};
const draft = (r, a, kind, config) =>
  saveDraft(r, a, {
    kind,
    title: 'Проверка',
    body: {
      key: kind === 'tier' ? 'silver' : kind === 'ticket' ? 'support' : 'notice',
      config,
      layout: 'embed',
      appearance: { ...seedEmbed },
    },
  });
test('Черновик тира применяет роль, анкету и домены только после подтверждения', async (t) => {
  const r = runtime(t),
    a = as(r),
    cfg = {
      ...tierSeed,
      role: ids.member,
      reviewers: ['high'],
      domains: ['media.example'],
      questions: [
        ...r.config.types(ids.guild).tier.questions,
        { key: 'venue', label: 'Место', input: 'select', options: ['A', 'B'], required: true },
      ],
    };
  const d = draft(r, a, 'tier', cfg);
  assert.equal(tiers(r, a).length, 0);
  const saved = await applyConfig(r, a, d.id, { version: d.version, confirm: true });
  const policy = tierPolicy(r, ids.guild, 'tier', 'silver');
  assert.equal(saved.version, 2);
  assert.deepEqual(policy.questions, cfg.questions);
  assert.deepEqual(policy.domains, cfg.domains);
  assert.equal(r.results.saved.size, 0);
  const tier = tiers(r, a)[0];
  r.store.run(
    'INSERT INTO family_members(guild,user,static,nick,rank,tier,joined,accepted) VALUES(?,?,?,?,?,?,?,?)',
    ids.guild,
    ids.author,
    '1',
    'Игрок',
    'member',
    'silver',
    Date.now(),
    ids.owner,
  );
  assert.throws(() =>
    tierOrder(r, a, { key: 'silver', action: 'delete', revision: tier.revision, confirm: true }),
  );
});
test('Отложенная проверка роли учитывает новую редакцию черновика', async (t) => {
  const r = runtime(t),
    a = as(r),
    d = draft(r, a, 'tier', { ...tierSeed, role: ids.member });
  let unblock;
  r.guild.roles.fetch = () => new Promise((done) => (unblock = done));
  const applying = applyConfig(r, a, d.id, { version: 1, confirm: true });
  saveDraft(r, a, { kind: 'tier', title: 'Другая редакция', body: d.body, version: 1 }, d.id);
  unblock(r.guild.roles.cache.get(ids.member));
  await assert.rejects(applying, /изменилась/);
  assert.equal(tiers(r, a).length, 0);
});
test('Редактирование публикации обновляет то же сообщение, журнал и снимок файла V2', async (t) => {
  const r = runtime(t),
    a = as(r);
  let d = draft(r, a, 'embed', null);
  const changed = { ...d.body, layout: 'v2', fileName: 'rules.txt', fileText: 'Правила семьи' };
  d = saveDraft(r, a, { ...d, body: changed }, d.id);
  const send = async () => {
    d = transition(r, a, d.id, { version: d.version, action: 'ready' });
    const prev = await prepublish(r, a, d.id, { version: d.version, channel: ids.results });
    return publish(r, a, d.id, { confirm: true, token: prev.token });
  };
  const first = await send();
  d = getDraft(r, a, d.id);
  d = saveDraft(r, a, { ...d, body: { ...d.body, fileText: 'Новая редакция' } }, d.id);
  const second = await send();
  assert.equal(first.message, second.message);
  assert.equal(r.results.saved.size, 1);
  assert.equal(r.results.saved.first().payload.files[0].attachment.toString(), 'Новая редакция');
  assert.equal(r.store.one("SELECT count(*) n FROM audit_logs WHERE action='control.publish.ok'").n, 2);
  assert.throws(() => renderDraft('embed', { ...changed, fileName: '../secret' }, a));
});
test('Создание тикета с сайта, права канала и заметки используют один объект Discord', async (t) => {
  const r = runtime(t),
    a = as(r);
  r.config.bind(ids.guild, 'channel', 'cat_active', ids.category, ids.owner);
  r.config.bind(ids.guild, 'role', 'ticket_support', ids.staff, ids.owner);
  const res = await createTicket(r, a, {
    type: 'support',
    user: ids.author,
    answers: { reason: 'Проверка' },
    priority: 'high',
    confirm: true,
  });
  assert.equal(res.channel, ids.channel);
  assert.equal(ticketList(r, a).items[0].id, res.id);
  await actOnTicket(r, a, res.id, { action: 'note', value: 'Видно сотрудникам', confirm: true });
  const detail = await ticketDetail(r, a, res.id);
  assert.equal(detail.notes[0].body, 'Видно сотрудникам');
  assert.equal(detail.answers[0].value, 'Проверка');
  const ch = r.channels.get(ids.channel),
    before = ch.permissionsFor.bind(ch);
  ch.permissionsFor = (m) => (m.id === ids.owner ? new PermissionsBitField() : before(m));
  assert.equal(ticketList(r, a).items.length, 0);
  await assert.rejects(ticketDetail(r, a, res.id), /недоступно/);
});
test('Команды сайта вызывают обработчик бота и повторно проверяют параметры', async (t) => {
  const r = runtime(t),
    a = as(r);
  assert.ok(operationCatalog(r, a).some((o) => o.command === 'family' && o.action === 'add'));
  const data = {
    command: 'family',
    action: 'add',
    values: { user: ids.author, static: '123', nick: 'Участник' },
    confirm: true,
  };
  await dispatchOperation(r, a, data);
  assert.equal(r.store.one('SELECT static FROM family_members WHERE user=?', ids.author).static, '123');
  await assert.rejects(
    dispatchOperation(r, a, { ...data, values: { ...data.values, extra: 'invalid' } }),
    /параметр/,
  );
  changeGrant(r, a, { role: ids.staff, permissions: presets.recruit, revision: 0, confirm: true });
  assert.equal(nativeAllowed(r.config, r.guild, r.people.get(ids.reviewer), 'tickets.publish'), false);
});
test('Отзыв роли во время запроса Discord исключает устаревший результат из кеша', async (t) => {
  const r = runtime(t),
    a = as(r);
  changeGrant(r, a, { role: ids.staff, permissions: presets.recruit, revision: 0, confirm: true });
  const auth = authentication(r, { guild: ids.guild, origin: 'http://127.0.0.1' }),
    token = 'fixture-race';
  r.store.run(
    'INSERT INTO control_sessions VALUES(?,?,?,?,?)',
    hash(token),
    ids.guild,
    ids.reviewer,
    JSON.stringify({ id: ids.reviewer }),
    Date.now() + 60000,
  );
  const s = auth.session({ headers: { cookie: 'karma-session=' + token } });
  let resolve;
  r.guild.members.fetch = () => new Promise((done) => (resolve = done));
  const check = auth.actor(s, true);
  auth.invalidate(s.user);
  resolve(r.people.get(s.user));
  await assert.rejects(check, /изменился/);
});
