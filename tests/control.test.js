import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, ids } from './helpers/runtime.js';
import { authentication, hash } from '../src/control/auth.js';
import { permissionsFor, changeGrant } from '../src/control/rbac.js';
import {
  saveDraft,
  getDraft,
  transition,
  prepublish,
  publish,
  applyConfig,
  renderDraft,
} from '../src/control/studio.js';
import { controlServer } from '../src/control/server.js';
import { seedEmbed } from '../src/modules/embeds.js';
import { ticketList, preferences } from '../src/control/operations.js';
import { Collection, PermissionsBitField as Bits } from 'discord.js';
const opt = {
  origin: 'http://127.0.0.1:4173',
  app: ids.bot,
  guild: ids.guild,
  secret: 'test-fixture',
  port: 0,
  host: '127.0.0.1',
  secure: false,
};
function owner(r) {
  const member = r.people.get(ids.owner);
  return {
    guild: r.guild,
    member,
    permissions: permissionsFor(r.config, r.guild, member),
    profile: { id: ids.owner, username: 'Тест' },
  };
}
const input = () => ({
  kind: 'embed',
  title: 'Правила',
  body: {
    key: 'Правила',
    appearance: { ...seedEmbed, title: 'Обновление', description: 'Для {server}' },
    layout: 'embed',
  },
});
test('OAuth state привязан к браузеру, одноразовый, секреты не хранятся в сеансе', async (t) => {
  const r = runtime(t);
  let requests = 0;
  const auth = authentication(r, opt, async () => ({
    ok: true,
    json: async () =>
      ++requests === 1 ? { access_token: 'issued-for-test' } : { id: ids.owner, username: 'demo' },
  }));
  const go = auth.start(),
    params = new URL(go.url).searchParams;
  assert.equal(params.get('scope'), 'identify');
  params.set('code', 'callback-fixture');
  await assert.rejects(auth.callback({ headers: { cookie: '' } }, params));
  const req = { headers: { cookie: go.cookie.split(';')[0] } };
  const cookies = await auth.callback(req, params);
  await assert.rejects(auth.callback(req, params));
  const logged = { headers: { cookie: cookies[0].split(';')[0] } };
  const s = auth.session(logged);
  assert.equal(s.user, ids.owner);
  assert.doesNotMatch(JSON.stringify(s), /issued-for-test/);
  assert.throws(() => auth.verify(logged, s));
  auth.verify({ headers: { origin: opt.origin, 'x-csrf-token': s.csrf } }, s);
  auth.logout(s);
  assert.equal(auth.session(logged), null);
});
test('Веб-доступ учитывает настроенный ID роли, отзыв и удалённую роль', (t) => {
  const r = runtime(t),
    a = owner(r),
    m = r.people.get(ids.reviewer);
  changeGrant(r, a, {
    role: ids.staff,
    permissions: ['dashboard.access', 'recruitment.view'],
    confirm: true,
    revision: 0,
  });
  assert.ok(permissionsFor(r.config, r.guild, m).has('recruitment.view'));
  assert.ok(!permissionsFor(r.config, r.guild, m).has('recruitment.accept'));
  changeGrant(r, a, { role: ids.staff, permissions: [], confirm: true, revision: 1 });
  assert.ok(!permissionsFor(r.config, r.guild, m).size);
  r.guild.roles.cache.delete(ids.staff);
  assert.ok(!permissionsFor(r.config, r.guild, m).size);
});
test('Приватные черновики, явный общий доступ и конфликт версий', (t) => {
  const r = runtime(t),
    a = owner(r),
    other = { ...a, member: r.people.get(ids.reviewer) },
    d = saveDraft(r, a, input());
  assert.throws(() => getDraft(r, other, d.id));
  const shared = transition(r, a, d.id, {
    action: 'share',
    roles: [ids.staff],
    version: d.version,
    confirm: true,
  });
  assert.equal(getDraft(r, other, d.id).state, 'shared');
  assert.throws(() => saveDraft(r, other, { ...input(), version: d.version }, d.id));
  const edited = saveDraft(r, other, { ...input(), version: shared.version }, d.id);
  assert.equal(edited.version, 3);
  assert.equal(r.results.saved.size, 0);
  assert.ok(r.store.one("SELECT id FROM audit_logs WHERE action='control.draft.share'"));
});
test('Предпросмотр и сохранение не отправляют сообщений, повторное подтверждение возвращает один ID', async (t) => {
  const r = runtime(t),
    a = owner(r),
    d = saveDraft(r, a, input()),
    ch = r.results;
  ch.permissionsFor = () => new Bits('Administrator');
  const ready = transition(r, a, d.id, { action: 'ready', version: d.version });
  const preview = await prepublish(r, a, d.id, { channel: ch.id, version: ready.version });
  assert.equal(ch.saved.size, 0);
  assert.equal(preview.payload.embeds[0].title, 'Обновление');
  await assert.rejects(publish(r, a, d.id, { token: preview.token, confirm: false }));
  const one = await publish(r, a, d.id, { token: preview.token, confirm: true });
  const two = await publish(r, a, d.id, { token: preview.token, confirm: true });
  assert.equal(one.message, two.message);
  assert.equal(ch.saved.size, 1);
  assert.equal(getDraft(r, a, d.id).state, 'published');
});
test('Настройки студии сразу доступны боту и конфликтуют с последующим изменением из Discord', async (t) => {
  const r = runtime(t),
    a = owner(r),
    d = saveDraft(r, a, input());
  const saved = await applyConfig(r, a, d.id, { version: d.version, confirm: true });
  assert.match(
    r.store.one('SELECT config FROM embed_templates WHERE guild=? AND name=?', ids.guild, 'Правила').config,
    /Обновление/,
  );
  r.store.run("UPDATE embed_templates SET config='{}' WHERE guild=?", ids.guild);
  await assert.rejects(applyConfig(r, a, d.id, { version: saved.version, confirm: true }));
  assert.equal(r.results.saved.size, 0);
});
test('HTTP API закрыт без сессии и проверяет CSRF, права, формат и отзыв на записи', async (t) => {
  const r = runtime(t),
    service = controlServer(r, opt);
  await service.listen();
  t.after(() => service.close());
  const origin = 'http://127.0.0.1:' + service.server.address().port;
  const req = (path, params) => fetch(origin + path, params);
  assert.equal((await req('/api/inbox')).status, 401);
  assert.equal((await req('/api/session')).status, 200);
  const token = 'fixture-session';
  r.store.run(
    'INSERT INTO control_sessions VALUES(?,?,?,?,?)',
    hash(token),
    ids.guild,
    ids.reviewer,
    JSON.stringify({ id: ids.reviewer, username: 'QA' }),
    Date.now() + 60000,
  );
  const headers = { cookie: 'karma-session=' + token };
  const state = () => req('/api/session', { headers }).then((r) => r.json());
  assert.equal((await state()).state, 'denied');
  changeGrant(r, owner(r), {
    role: ids.staff,
    permissions: ['dashboard.access', 'dashboard.overview'],
    confirm: true,
    revision: 0,
  });
  const s = await state();
  assert.equal(s.state, 'active');
  assert.equal((await req('/api/settings', { headers })).status, 403);
  assert.equal((await req('/api/profile', { method: 'POST', headers, body: '{}' })).status, 403);
  const secure = {
    ...headers,
    origin: opt.origin,
    'content-type': 'application/json',
    'x-csrf-token': s.csrf,
  };
  assert.equal((await req('/api/profile', { method: 'POST', headers: secure, body: '{}' })).status, 400);
  changeGrant(r, owner(r), { role: ids.staff, permissions: [], confirm: true, revision: 1 });
  assert.equal((await req('/api/profile', { method: 'POST', headers: secure, body: '{}' })).status, 403);
});
