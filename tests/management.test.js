import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { runtime, ids, interaction } from './helpers/runtime.js';
import { types } from '../src/core/catalog.js';
import { reserve, materialize, ticketRow, openPanel } from '../src/modules/tickets.js';
import { finishDecision, decide } from '../src/modules/review.js';
import { endCommunity } from '../src/modules/community.js';
import { eventTime } from '../src/core/time.js';
import { updateRoles } from '../src/modules/roles.js';
const get = async (r, i) => {
  await r.dispatch(i);
  return i.replies.at(-1);
};
function options(sub, values = {}) {
  const getter = (k) => values[k] ?? null;
  return {
    getSubcommand: () => sub,
    getString: getter,
    getInteger: getter,
    getUser: getter,
    getRole: getter,
    getBoolean: getter,
    getChannel: getter,
  };
}
test('Манифест Discord и маршруты элементов укладываются в лимиты API', async (t) => {
  const r = runtime(t);
  assert.equal(new Set(r.commands.map((c) => c.name)).size, r.commands.length);
  function check(opts) {
    assert.ok(opts.length <= 25);
    let optional = false;
    for (const o of opts) {
      if (o.type === 1) check(o.options);
      else {
        if (!o.required) optional = true;
        else assert.equal(optional, false, o.name);
      }
      assert.ok(o.description.length <= 100 && o.description.length > 0);
      assert.ok(o.name.length <= 32);
      assert.ok((o.choices?.length || 0) <= 25);
    }
  }
  for (const c of r.commands) {
    assert.ok(r.routes.has('cmd.' + c.name));
    check(c.options || []);
    assert.deepEqual(c.contexts, [0]);
  }
  const i = interaction(r, { userId: ids.owner, commandName: 'dashboard' }),
    home = await get(r, i);
  assert.equal(home.flags, MessageFlags.Ephemeral);
  for (const section of home.components[0].components[0].options) {
    const payload = await get(
      r,
      interaction(r, { userId: ids.owner, customId: 'dsection', values: [section.value] }),
    );
    for (const row of payload.components) {
      assert.ok(row.components.length <= 5);
      for (const c of row.components) {
        assert.ok(r.routes.has(c.custom_id.split(':')[0]), c.custom_id);
        assert.ok(c.custom_id.length <= 100);
      }
    }
  }
  const status = await get(r, interaction(r, { commandName: 'bot' }));
  assert.ok(status.flags & MessageFlags.IsComponentsV2);
  assert.ok(status.flags & MessageFlags.Ephemeral);
  assert.ok(!status.embeds);
  assert.equal(openPanel(r, ids.guild).components[0].components[0].options.length, 10);
});
test('Тир удаляет только настроенные роли, сохраняет историю и отклоняет повторное решение', async (t) => {
  const r = runtime(t),
    db = r.store,
    old = '100000000000000050',
    untouched = '100000000000000051';
  const roles = r.guild.roles.cache;
  roles.set(old, { ...roles.get(ids.member), id: old });
  roles.set(untouched, { ...roles.get(ids.member), id: untouched });
  const m = r.people.get(ids.author);
  await m.roles.add(old);
  await m.roles.add(untouched);
  db.run(
    'INSERT INTO family_members(guild,user,static,nick,rank,joined,accepted) VALUES(?,?,?,?,?,?,?)',
    ids.guild,
    ids.author,
    '003',
    'Участник',
    'member',
    Date.now(),
    ids.owner,
  );
  for (const [key, role] of [
    ['one', ids.member],
    ['two', old],
  ])
    db.run(
      'INSERT INTO tier_definitions VALUES(?,?,?)',
      ids.guild,
      key,
      JSON.stringify({ title: key, role, order: 1, cooldown: 0, reviewers: ['high'] }),
    );
  r.config.bind(ids.guild, 'channel', 'cat_tier', ids.category, ids.owner);
  const i = interaction(r, { userId: ids.reviewer }),
    id = reserve(r, interaction(r), {
      key: 'tier',
      policy: types.tier,
      answers: {
        static: '003',
        nick: 'Участник',
        current: 'two',
        desired: 'one',
        proof: 'https://youtube.com/watch?v=123',
      },
    });
  await materialize(r, r.guild, ticketRow(db, ids.guild, id));
  await decide(r, i, ticketRow(db, ids.guild, id), 'accepted', 'Проверено');
  await finishDecision(r, r.guild, id);
  assert.ok(m.roles.cache.has(ids.member));
  assert.ok(m.roles.cache.has(untouched));
  assert.ok(!m.roles.cache.has(old));
  assert.equal(db.one('SELECT tier FROM family_members').tier, 'one');
  assert.equal(db.one("SELECT count(*) n FROM member_history WHERE action='tier'").n, 1);
  await assert.rejects(decide(r, i, ticketRow(db, ids.guild, id), 'accepted', 'Повтор'));
});
test('Запрет по статику отклоняет анкету до выдачи номера', (t) => {
  const r = runtime(t);
  r.store.run(
    "INSERT INTO blacklisted_members(guild,kind,value,reason,actor,created) VALUES(?,'static','004','Проверка',?,?)",
    ids.guild,
    ids.owner,
    Date.now(),
  );
  assert.throws(() =>
    reserve(r, interaction(r), { key: 'join', policy: types.join, answers: { static: '004', nick: 'А' } }),
  );
  assert.equal(r.store.one('SELECT COUNT(*) n FROM tickets').n, 0);
});
test('Анонимное голосование заменяет ответ и закрывается после восстановления планировщика', async (t) => {
  const r = runtime(t),
    db = r.store,
    g = ids.guild,
    ch = r.results;
  const msg = await ch.send({});
  const kind = 'poll';
  const id = Number(
    db.run(
      "INSERT INTO polls(guild,title,config,ends,state,channel,message) VALUES(?,?,?,?,'open',?,?)",
      g,
      'Вопрос',
      JSON.stringify({ options: ['А', 'Б'], anonymous: true, salt: 'test' }),
      Date.now() + 60000,
      ch.id,
      msg.id,
    ).lastInsertRowid,
  );
  for (const value of ['0', '1'])
    await get(r, interaction(r, { customId: 'ballot:' + id, values: [value], channel: ch, message: msg }));
  const rows = db.all('SELECT user,choice FROM ballots WHERE kind=?', kind);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].choice, '1');
  assert.notEqual(rows[0].user, ids.author);
  db.run('UPDATE polls SET ends=0 WHERE id=?', id);
  r.scheduler.recover();
  await r.scheduler.tick();
  assert.equal(db.one('SELECT state FROM polls').state, 'ended');
  assert.equal(msg.payload.components.length, 0);
});
test('Розыгрыш исключает бывшую обязательную роль и предыдущих победителей при повторе', async (t) => {
  const r = runtime(t),
    db = r.store,
    ch = r.results,
    msg = await ch.send({}),
    cfg = { role: ids.staff, excluded: [], winners: 1 };
  const id = Number(
    db.run(
      "INSERT INTO giveaways(guild,title,config,organizer,ends,state,channel,message) VALUES(?,?,?,?,0,'open',?,?)",
      ids.guild,
      'Приз',
      JSON.stringify(cfg),
      ids.owner,
      ch.id,
      msg.id,
    ).lastInsertRowid,
  );
  for (const uid of [ids.reviewer, ids.author])
    db.run("INSERT INTO ballots VALUES('giveaway',?,?,'join')", id, uid);
  await endCommunity(r, r.guild, 'giveaway', id);
  assert.deepEqual(JSON.parse(db.one('SELECT result FROM giveaways').result), [ids.reviewer]);
  await endCommunity(r, r.guild, 'giveaway', id, 'reroll');
  assert.deepEqual(JSON.parse(db.one('SELECT result FROM giveaways').result), []);
});
test('Часовой пояс сервера, явное смещение и неоднозначный час', () => {
  assert.equal(eventTime('2030-01-01 20:00', 'Asia/Tashkent', 0), Date.parse('2030-01-01T15:00:00Z'));
  assert.equal(eventTime('2030-01-01T20:00:00+05:00', 'UTC', 0), Date.parse('2030-01-01T15:00:00Z'));
  assert.throws(() => eventTime('2030-11-03 01:30', 'America/New_York', 0));
  assert.throws(() => eventTime('2030-02-30 09:00', 'UTC', 0));
});
test('Проверка доступа при выключении модулей и подтверждении опасной операции', async (t) => {
  const r = runtime(t),
    denied = await get(r, interaction(r, { commandName: 'dashboard' }));
  assert.match(denied.embeds[0].description, /администратора/);
  const preview = await get(r, interaction(r, { userId: ids.owner, customId: 'toggle', values: ['family'] }));
  const confirm = preview.components[0].components[0].custom_id;
  await get(r, interaction(r, { userId: ids.author, customId: confirm }));
  assert.ok(r.config.enabled(ids.guild, 'family'));
  await get(r, interaction(r, { userId: ids.owner, customId: confirm }));
  assert.equal(r.config.enabled(ids.guild, 'family'), false);
  const result = await get(r, interaction(r, { commandName: 'family', options: options('stats') }));
  assert.match(result.embeds[0].description, /отключён/);
});
test('Бронирование последнего места, резерв и однократные очки за явку', async (t) => {
  const r = runtime(t),
    db = r.store,
    ch = r.results,
    msg = await ch.send({});
  const id = Number(
    db.run(
      "INSERT INTO events(guild,title,details,start,capacity,state,organizer,channel,message) VALUES(?,?,?,?,1,'scheduled',?,?,?)",
      ids.guild,
      'Тренировка',
      JSON.stringify({ kind: 'training', location: 'Город' }),
      Date.now() + 60000,
      ids.owner,
      ch.id,
      msg.id,
    ).lastInsertRowid,
  );
  for (const u of [ids.author, ids.reviewer])
    await get(r, interaction(r, { customId: 'rsvp:' + id + ':yes', userId: u, message: msg, channel: ch }));
  assert.equal(
    db.one('SELECT status FROM event_attendance WHERE event=? AND user=?', id, ids.reviewer).status,
    'reserve',
  );
  db.run("UPDATE events SET state='started' WHERE id=?", id);
  for (let n = 0; n < 2; n++)
    await get(
      r,
      interaction(r, {
        userId: ids.owner,
        commandName: 'event',
        options: options('attendance', { id, user: { id: ids.author } }),
      }),
    );
  assert.equal(db.one('SELECT points FROM karma_points').points, 10);
});
test('Время временной роли хранится в SQLite и применяется после перезапуска очереди', async (t) => {
  const r = runtime(t);
  await updateRoles(r, r.guild, { roles: [ids.member], minutes: 1, max: 1 }, ids.author, [ids.member], false);
  assert.ok(r.people.get(ids.author).roles.cache.has(ids.member));
  r.store.run("UPDATE scheduled_tasks SET due=0 WHERE kind='temprole'");
  r.scheduler.recover();
  await r.scheduler.tick();
  assert.equal(r.people.get(ids.author).roles.cache.has(ids.member), false);
});
