import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits as P, PermissionsBitField as Perms, ChannelType } from 'discord.js';
import { runtime, interaction, ids } from './helpers/runtime.js';
import { closeTicket, materialize, reserve, ticketRow } from '../src/modules/tickets.js';
import { canReview } from '../src/core/access.js';
import { types } from '../src/core/catalog.js';
import { publishPanel } from '../src/services/publication.js';
import { card, row, button } from '../src/core/ui.js';
const signup = {
  key: 'join',
  policy: types.join,
  answers: { static: '007', nick: 'Тест', age: '22', online: '4 часа', source: 'друг' },
};
test('После потери ответа Discord очередь находит уже опубликованную панель', async (t) => {
  const r = runtime(t),
    db = r.store,
    ch = r.results;
  const id = Number(
    db.run(
      "INSERT INTO suggestions(guild,author,body,channel,state) VALUES(?,?,?,?,'pending')",
      ids.guild,
      ids.author,
      'Предложение',
      ch.id,
    ).lastInsertRowid,
  );
  const payload = card('Предложение', 'Текст', [row(button('vote:suggest:' + id + ':yes', 'За'))]);
  const original = ch.send;
  ch.send = async (body) => {
    const m = await original(body);
    m.components = [{ components: [{ customId: 'vote:suggest:' + id + ':yes' }] }];
    throw Error('lost response');
  };
  await assert.rejects(publishPanel(r, r.guild, 'suggest', id, payload));
  ch.send = original;
  db.run("UPDATE scheduled_tasks SET due=0 WHERE kind='publish'");
  r.scheduler.recover();
  await r.scheduler.tick();
  assert.equal(ch.saved.size, 1);
  assert.equal(db.one('SELECT message FROM suggestions WHERE id=?', id).message, ch.saved.first().id);
});
test('Повторная подтверждённая настройка привязывает уже созданную роль', async (t) => {
  const r = runtime(t);
  let creates = 0;
  r.guild.roles.create = async (data) => {
    creates++;
    const role = { ...data, id: '100000000000000098', guild: r.guild, managed: false };
    r.guild.roles.cache.set(role.id, role);
    return role;
  };
  const resource = { kind: 'role', key: 'trial', name: 'Испытательный срок' };
  const owner = () => interaction(r, { userId: ids.owner });
  await r.confirmations.get('setup.create')(owner(), resource);
  await r.confirmations.get('setup.create')(owner(), resource);
  assert.equal(creates, 1);
  assert.equal(r.config.bindings(ids.guild, 'role').trial, '100000000000000098');
});
test('Сбой API при обновлении закрытой панели восстанавливается из очереди', async (t) => {
  const r = runtime(t),
    db = r.store,
    id = reserve(r, interaction(r), signup),
    ch = await materialize(r, r.guild, ticketRow(db, ids.guild, id));
  const message = ch.saved.first(),
    edit = message.edit;
  message.edit = async () => {
    throw Error('test transport');
  };
  await assert.rejects(closeTicket(r, r.guild, ticketRow(db, ids.guild, id), ids.reviewer, 'Завершено'));
  assert.equal(ticketRow(db, ids.guild, id).state, 'closed');
  assert.ok(db.one("SELECT 1 FROM scheduled_tasks WHERE kind='ticketPanel'"));
  message.edit = edit;
  db.run("UPDATE scheduled_tasks SET due=0 WHERE kind='ticketPanel'");
  r.scheduler.recover();
  await r.scheduler.tick();
  assert.match(message.payload.embeds[0].description, /Закрыт/);
  assert.equal(db.one("SELECT 1 FROM scheduled_tasks WHERE kind='ticketPanel'"), undefined);
});
test('Приватная ветка требует доступа в родительский канал и приглашает автора', async (t) => {
  const r = runtime(t),
    db = r.store,
    parent = r.results,
    threadId = '100000000000000090';
  let input, invited;
  parent.threads = {
    fetchActive: async () => ({ threads: new Collection() }),
    create: async (opts) => {
      input = opts;
      const thread = {
        ...parent,
        id: threadId,
        isThread: () => true,
        members: {
          add: async (id) => {
            invited = id;
          },
        },
      };
      r.channels.set(threadId, thread);
      return thread;
    },
  };
  r.config.bind(ids.guild, 'channel', 'support', parent.id, ids.owner);
  const policy = { ...types.join, mode: 'thread' };
  db.run('INSERT INTO ticket_types VALUES(?,?,?)', ids.guild, 'join', JSON.stringify(policy));
  const id = reserve(r, interaction(r), { ...signup, policy });
  parent.permissionsFor = () => new Perms(0n);
  await assert.rejects(materialize(r, r.guild, ticketRow(db, ids.guild, id)));
  assert.equal(input, undefined);
  parent.permissionsFor = () => new Perms(P.Administrator);
  await materialize(r, r.guild, ticketRow(db, ids.guild, id));
  assert.equal(input.type, ChannelType.PrivateThread);
  assert.equal(input.invitable, false);
  assert.equal(invited, ids.author);
});
test('Обычная роль администратора не разрешает рассмотрение жалобы на администрацию', (t) => {
  const r = runtime(t),
    i = interaction(r, { userId: ids.reviewer });
  i.memberPermissions = new Perms(P.Administrator);
  const rec = { guild: ids.guild, type: 'staff', policy: JSON.stringify(types.staff) };
  assert.equal(canReview(i, rec, r.config), false);
  r.config.bind(ids.guild, 'role', 'leader', ids.staff, ids.owner);
  assert.equal(canReview(i, rec, r.config), true);
});
test('Восстановление самой старой из пяти копий сохраняет страховочную копию', (t) => {
  const r = runtime(t),
    db = r.store;
  const first = db.backup();
  for (let i = 0; i < 4; i++) {
    db.audit(ids.guild, 'sample', ids.owner, String(i));
    db.backup();
  }
  const safety = db.restore(first, ids.guild);
  assert.ok(db.listBackups().includes(safety));
  assert.ok(db.listBackups().includes(first));
  assert.ok(db.listBackups().length <= 5);
  assert.equal(db.one("SELECT 1 FROM audit_logs WHERE action='sample'"), undefined);
});
