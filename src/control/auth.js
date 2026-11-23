import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ControlError, check, snow } from './errors.js';
import { permissionsFor } from './rbac.js';
export const random = () => randomBytes(32).toString('base64url');
export const hash = (v) => createHash('sha256').update(v).digest('hex');
const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function controlOptions(env = process.env) {
  const origin = new URL(env.CONTROL_ORIGIN || 'http://127.0.0.1:4173');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  check(
    origin.href === origin.origin + '/' &&
      (origin.protocol === 'https:' || (local && origin.protocol === 'http:')),
    400,
    'Проверьте CONTROL_ORIGIN и HTTPS.',
  );
  const port = Number(env.SERVER_PORT || origin.port || 4173);
  check(Number.isInteger(port) && port >= 1 && port <= 65535, 400, 'Проверьте SERVER_PORT.');
  return {
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    host: local ? '127.0.0.1' : '0.0.0.0',
    port,
    guild: env.CONTROL_GUILD_ID || env.GUILD_ID,
    app: env.APPLICATION_ID,
    secret: env.DISCORD_CLIENT_SECRET,
  };
}
export function authentication(r, o, fetcher = fetch) {
  const db = r.store,
    redirect = o.origin + '/auth/callback',
    prefix = o.secure ? '__Host-karma-' : 'karma-',
    cache = new Map(),
    pending = new Map();
  const cookie = (key, v, seconds) =>
    prefix +
    key +
    '=' +
    v +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
    seconds +
    (o.secure ? '; Secure' : '');
  const getCookie = (req, key) =>
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(prefix + key + '='))
      ?.slice(prefix.length + key.length + 1) || '';
  const configured = () => !!(snow(o.guild) && snow(o.app) && o.secret);
  const clearSession = () => cookie('session', '', 0);
  const csrf = (token) => hash('csrf\0' + token);
  function start() {
    check(configured(), 503, 'Для входа настройте Discord OAuth2 и адрес сайта.');
    const state = random(),
      now = Date.now();
    db.run('DELETE FROM control_states WHERE expires<?', now);
    db.run('INSERT INTO control_states VALUES(?,?)', hash(state), now + 300000);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: o.app,
      redirect_uri: redirect,
      scope: 'identify',
      state,
    });
    return { url: 'https://discord.com/oauth2/authorize?' + params, cookie: cookie('state', state, 300) };
  }
  async function callback(req, params) {
    const state = params.get('state'),
      bound = getCookie(req, 'state');
    check(
      state &&
        same(state, bound) &&
        db.run('DELETE FROM control_states WHERE hash=? AND expires>?', hash(state), Date.now()).changes,
      400,
      'Срок входа истёк. Начните заново.',
    );
    check(configured() && params.get('code') && !params.get('error'), 400, 'Вход через Discord отменён.');
    const exchange = await fetcher('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: o.app,
        client_secret: o.secret,
        grant_type: 'authorization_code',
        code: params.get('code'),
        redirect_uri: redirect,
      }),
      signal: AbortSignal.timeout(10000),
    });
    check(exchange.ok, 502, 'Discord отклонил авторизацию. Начните вход заново.');
    const { access_token } = await exchange.json();
    check(typeof access_token === 'string' && access_token, 502, 'Discord не выдал доступ к профилю.');
    const response = await fetcher('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bearer ' + access_token },
      signal: AbortSignal.timeout(10000),
    });
    check(response.ok, 502, 'Discord не вернул профиль.');
    const u = await response.json();
    check(snow(u.id) && !u.bot, 403, 'Доступ ограничен.');
    const token = random(),
      now = Date.now(),
      profile = {
        id: u.id,
        name: String(u.global_name || u.username).slice(0, 96),
        username: String(u.username).slice(0, 64),
        avatar: /^(?:a_)?[0-9a-f]{32}$/.test(u.avatar)
          ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=96'
          : null,
      };
    db.run('DELETE FROM control_sessions WHERE expires<=? OR hash=?', now, hash(getCookie(req, 'session')));
    db.run(
      'INSERT INTO control_sessions VALUES(?,?,?,?,?)',
      hash(token),
      o.guild,
      u.id,
      JSON.stringify(profile),
      now + 8 * 3600000,
    );
    return [cookie('session', token, 8 * 3600), cookie('state', '', 0)];
  }
  function session(req) {
    const token = getCookie(req, 'session');
    const row =
      token &&
      db.one(
        'SELECT * FROM control_sessions WHERE hash=? AND guild=? AND expires>?',
        hash(token),
        o.guild || '',
        Date.now(),
      );
    return row ? { ...row, csrf: csrf(token), profile: JSON.parse(row.profile) } : null;
  }
  async function actor(s, fresh = false) {
    check(s, 401, 'Войдите через Discord.');
    check(r.client.isReady() && !r.stopping, 503, 'Бот временно вне сети.');
    const guild = r.client.guilds.cache.get(o.guild);
    check(guild && guild.available !== false, 503, 'Сервер временно недоступен.');
    let cached = cache.get(s.user),
      member;
    if (!fresh && cached && Date.now() - cached.time < 10000) member = cached.member;
    else {
      let work = pending.get(s.user);
      if (!work) {
        work = { result: guild.members.fetch({ user: s.user, force: true, cache: false }), invalid: false };
        pending.set(s.user, work);
      }
      try {
        member = await work.result;
        check(!work.invalid, 409, 'Доступ изменился. Повторите запрос.');
      } catch (e) {
        if (e instanceof ControlError) throw e;
        if ([10007, 10013].includes(e.code)) {
          db.run('DELETE FROM control_sessions WHERE guild=? AND user=?', o.guild, s.user);
          throw new ControlError(403, 'Участник покинул сервер.');
        }
        throw new ControlError(503, 'Не удалось проверить участие в сервере.');
      } finally {
        if (pending.get(s.user) === work) pending.delete(s.user);
      }
      check(member, 403, 'Доступ ограничен.');
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(s.user, { member, time: Date.now() });
    }
    check(
      db.one('SELECT 1 FROM control_sessions WHERE hash=? AND expires>?', s.hash, Date.now()),
      401,
      'Сеанс завершён.',
    );
    const permissions = permissionsFor(r.config, guild, member);
    check(permissions.has('dashboard.access'), 403, 'Доступ ограничен.');
    if (!db.one('SELECT 1 FROM guild_settings WHERE guild=?', guild.id)) db.guild(guild.id);
    return { guild, member, permissions, profile: s.profile, csrf: s.csrf };
  }
  function verify(req, s) {
    check(
      s && req.headers.origin === o.origin && same(req.headers['x-csrf-token'], s.csrf),
      403,
      'Проверка запроса не пройдена. Обновите страницу.',
    );
  }
  function logout(s, all = false) {
    if (all) db.run('DELETE FROM control_sessions WHERE guild=? AND user=?', s.guild, s.user);
    else db.run('DELETE FROM control_sessions WHERE hash=?', s.hash);
    cache.delete(s.user);
    return clearSession();
  }
  return {
    start,
    callback,
    session,
    actor,
    verify,
    logout,
    configured,
    clearSession,
    clearState: () => cookie('state', '', 0),
    invalidate: (id) => {
      cache.delete(id);
      const work = pending.get(id);
      if (work) work.invalid = true;
      pending.delete(id);
    },
  };
}
