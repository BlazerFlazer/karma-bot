import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField as Perms } from 'discord.js';
import { runtime, interaction, ids } from './helpers/runtime.js';
import { privateDestination } from '../src/services/transcript.js';
import { reserve, ticketRow } from '../src/modules/tickets.js';
import { types, defaults } from '../src/core/catalog.js';
import { validateSettings } from '../src/modules/dashboard.js';
import { voiceData, addPoints } from '../src/modules/activity.js';
import { hierarchy, assignable } from '../src/core/access.js';
import { pulse, scrub } from '../src/modules/security.js';
import { embedPayload, seedEmbed } from '../src/modules/embeds.js';
const answers = { static: '000123', nick: 'Иван', age: '25', source: 'личный ответ', online: 'вечером' };
const get = (r, i) => r.dispatch(i).then(() => i.replies.at(-1));
test('Панель → анкета → приватный канал → проверяющий → принятие → роли, профиль, результат и закрытые DM', async (t) => {
  const r = runtime(t),
    start = await get(r, interaction(r, { customId: 'tstart:join' }));
  assert.equal(start.components.length, 5);
  const result = await get(r, interaction(r, { customId: start.custom_id, fields: answers }));
  assert.match(result.embeds[0].description, /Обращение #1/);
  const ch = r.channels.get(ids.channel);
  assert.ok(ch.permissionOverwrites.cache.get(ids.guild).deny.has(P.ViewChannel));
  assert.ok(ch.permissionOverwrites.cache.get(ids.staff).allow.has(P.ViewChannel));
  assert.equal(ch.saved.first().payload.components.length, 2);
  const denied = await get(r, interaction(r, { customId: 'tact:1:accept' }));
  assert.match(denied.embeds[0].description, /нет доступа/);
  await get(r, interaction(r, { customId: 'tact:1:claim', userId: ids.reviewer }));
  const confirm = await get(r, interaction(r, { customId: 'tact:1:accept', userId: ids.reviewer }));
  const id = confirm.components[0].components[0].custom_id;
  const stolen = await get(r, interaction(r, { customId: id }));
  assert.match(stolen.embeds[0].description, /принадлежит/);
  const accepted = await get(r, interaction(r, { customId: id, userId: ids.reviewer }));
  assert.deepEqual(r.errors, []);
  assert.match(accepted.embeds[0].description, /Решение сохранено/);
  const db = r.store;
  assert.equal(db.one('SELECT static FROM family_members').static, '000123');
  assert.ok(r.people.get(ids.author).roles.cache.has(ids.member));
  assert.equal(ticketRow(db, ids.guild, 1).state, 'closed');
  assert.equal(r.logChannel.saved.size, 1);
  const replay = await get(r, interaction(r, { customId: id, userId: ids.reviewer }));
  assert.match(replay.embeds[0].description, /устарела/);
  await r.scheduler.tick();
  assert.equal(r.results.saved.size, 1);
  assert.doesNotMatch(r.results.saved.first().payload.embeds[0].description, /личный ответ|000123|Иван/);
  assert.ok(db.one("SELECT 1 FROM audit_logs WHERE action='dm.failed'"));
  assert.equal(db.one("SELECT count(*) n FROM application_history WHERE status='accepted'").n, 1);
});
test('Шесть вопросов продолжаются кнопкой, повторная отправка этапа отклоняется', async (t) => {
  const r = runtime(t);
  const p = {
    ...types.join,
    questions: [...types.join.questions, { key: 'extra', label: 'Дополнение', required: false }],
  };
  r.store.run('INSERT INTO ticket_types VALUES(?,?,?)', ids.guild, 'join', JSON.stringify(p));
  const a = await get(r, interaction(r, { customId: 'tstart:join' })),
    b = await get(r, interaction(r, { customId: a.custom_id, fields: answers }));
  const repeat = await get(r, interaction(r, { customId: a.custom_id, fields: answers }));
  assert.match(repeat.embeds[0].description, /Этап уже/);
  const next = await get(r, interaction(r, { customId: b.components[0].components[0].custom_id }));
  assert.equal(next.components.length, 1);
  await get(r, interaction(r, { customId: next.custom_id, fields: { extra: '' } }));
  assert.equal(r.store.one('SELECT state FROM tickets').state, 'open');
});
test('Приватный журнал отвергает постороннюю роль и явное разрешение пользователя', (t) => {
  const r = runtime(t),
    c = r.logChannel;
  for (const type of [0, 1]) {
    c.permissionOverwrites.cache.set('outsider', { id: 'outsider', type, allow: new Perms(P.ViewChannel) });
    assert.throws(() => privateDestination(c, r.guild, [ids.staff]));
  }
});
test('Сорванное создание восстанавливается планировщиком один раз', async (t) => {
  const r = runtime(t);
  const id = reserve(r, interaction(r), { key: 'join', policy: types.join, answers, context: {} });
  r.scheduler.recover();
  r.scheduler.recover();
  assert.equal(r.store.one("SELECT count(*) n FROM scheduled_tasks WHERE kind='createTicket'").n, 1);
  await r.scheduler.tick();
  assert.equal(ticketRow(r.store, ids.guild, id).state, 'open');
  assert.equal(r.channels.get(ids.channel).saved.size, 2);
});
test('Пять ошибок задачи видны в панели, повторный запуск сохраняет счётчик', async (t) => {
  const r = runtime(t);
  r.store.task('bad', ids.guild, 'unknown', {}, 0);
  for (let n = 0; n < 5; n++) {
    r.store.run("UPDATE scheduled_tasks SET due=0 WHERE key='bad'");
    await r.scheduler.tick();
    r.scheduler.recover();
  }
  assert.deepEqual(
    { ...r.store.one("SELECT state,attempts FROM scheduled_tasks WHERE key='bad'") },
    { state: 'failed', attempts: 5 },
  );
});
test('Очки за один источник начисляются один раз, списание не уводит в минус', (t) => {
  const r = runtime(t),
    db = r.store;
  const award = () =>
    db.tx(() => addPoints(db, ids.guild, ids.author, 100, 'staff', 'Посещение', 'event:1:u'));
  award();
  award();
  assert.equal(db.one('SELECT points FROM karma_points').points, 105);
  assert.equal(db.one('SELECT count(*) n FROM achievements').n, 1);
  assert.throws(() => db.tx(() => addPoints(db, ids.guild, ids.author, -120, 'staff', 'Минус', null)));
});
test('Голосовая сессия после рестарта завершается на последней отметке', (t) => {
  const r = runtime(t);
  r.store.run(
    'INSERT INTO voice_sessions(guild,user,started,last_seen) VALUES(?,?,?,?)',
    ids.guild,
    ids.author,
    100,
    500,
  );
  r.scheduler.recover();
  const x = voiceData(r.store, ids.guild, 300, ids.author);
  assert.equal(x[0].duration, 200);
  assert.equal(r.store.one('SELECT ended FROM voice_sessions').ended, 500);
});
test('Роли сотрудников и административные права недоступны публичной выдаче', (t) => {
  const r = runtime(t);
  assert.throws(() => assignable(r.guild, r.guild.roles.cache.get(ids.staff), r.config, true));
  const elevated = { ...r.guild.roles.cache.get(ids.member), permissions: new Perms(P.ManageRoles) };
  assert.throws(() => assignable(r.guild, elevated, r.config, true));
  const i = interaction(r);
  assert.throws(() => hierarchy(i, { id: ids.owner }));
  assert.throws(() => hierarchy(i, { id: ids.author }));
});
test('Проверка настроек и ограничений embed', () => {
  assert.equal(validateSettings(defaults), defaults);
  assert.throws(() => validateSettings({ ...defaults, timezone: 'x/y' }));
  assert.throws(() => validateSettings({ ...defaults, domains: ['*.youtube.com'] }));
  assert.throws(() => embedPayload({ ...seedEmbed, buttons: [{ url: 'javascript:1', label: 'x' }] }, {}));
  const p = embedPayload(seedEmbed, { username: 'Ник', family_name: 'KARMA' });
  assert.match(p.embeds[0].description, /Ник/);
});
test('Защита сообщает на пороге и очищает секреты перед логированием', () => {
  assert.equal(pulse('test-window', 2, 100, 0), false);
  assert.equal(pulse('test-window', 2, 100, 1), true);
  assert.equal(pulse('test-window', 2, 100, 2), false);
  assert.doesNotMatch(scrub('token=private-value'), /private-value/);
});
