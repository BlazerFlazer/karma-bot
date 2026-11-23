import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField } from 'discord.js';
import { register } from '../src/core/app.js';
import { InteractionRouter } from '../src/core/router.js';
import { commandCatalog, guides } from '../src/control/guide.js';

function catalogFixture({ disabled = [], permissions = [], memberRoles = [], owner = false } = {}) {
  const runtime = register(new InteractionRouter({}));
  runtime.config = {
    bindings: () => ({ leader: 'role-leader' }),
    enabled: (_, module) => !disabled.includes(module),
  };
  const guild = { id: 'test-guild', ownerId: 'owner' };
  const member = {
    id: owner ? 'owner' : 'member',
    roles: { cache: new Set(memberRoles) },
    permissions: new PermissionsBitField(permissions),
  };
  return { runtime, actor: { guild, member, permissions: new Set(['dashboard.access']) } };
}

test('Справочник строится по маршрутам, включает контекстные команды и параметры подкоманд', () => {
  const { runtime, actor } = catalogFixture();
  const entries = commandCatalog(runtime, actor);
  const find = (name) => entries.find((entry) => entry.name === name);
  assert.equal(new Set(entries.map((entry) => entry.name)).size, entries.length);
  for (const def of runtime.commands) {
    const name = (def.type === 1 ? '/' : '') + def.name;
    assert.ok(
      entries.some((e) => e.name === name || e.name.startsWith(name + ' ')),
      name,
    );
  }
  const join = find('/ticket open');
  assert.equal(join.status, 'Доступна');
  assert.equal(join.arguments.find((a) => a.name === 'type').required, false);
  assert.equal(join.publishes, false);
  assert.equal(find('/ticket panel').publishes, true);
  assert.ok(find('Пожаловаться на сообщение').syntax.includes('Контекстное меню'));
  for (const doc of guides) {
    assert.ok(doc.intro && doc.steps.length && doc.commands.every((name) => find(name)), doc.id);
  }
  runtime.routes.delete('cmd.ticket');
  assert.ok(!commandCatalog(runtime, actor).some((e) => e.name.startsWith('/ticket ')));
});

test('Каталог различает выключенный модуль, права Discord и назначенную роль', () => {
  const { runtime, actor } = catalogFixture({
    disabled: ['report'],
    memberRoles: ['role-leader'],
    permissions: ['ManageMessages'],
  });
  const byName = new Map(commandCatalog(runtime, actor).map((entry) => [entry.name, entry]));
  assert.equal(byName.get('/report history').status, 'Отключена');
  assert.equal(byName.get('Пожаловаться на пользователя').status, 'Отключена');
  assert.equal(byName.get('/clear').status, 'Доступна');
  assert.equal(byName.get('/ban').status, 'Ограничена');
  assert.equal(byName.get('/family add').status, 'Доступна');
  assert.equal(byName.get('/backup restore').status, 'Ограничена');
  assert.equal(byName.get('/setup').status, 'Ограничена');
  assert.equal(byName.get('/embed create').publishes, false);
  assert.equal(byName.get('/embed send').publishes, true);
});
