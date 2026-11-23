import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Events } from 'discord.js';
import { authentication, controlOptions } from './auth.js';
import { ControlError, check, requirePermission, object, pageOffset } from './errors.js';
import { InputError } from '../core/ui.js';
import { roleMatrix, changeGrant, mappings } from './rbac.js';
import {
  getDraft,
  listDrafts,
  saveDraft,
  transition,
  prepublish,
  publish,
  applyConfig,
  renderDraft,
  validateBody,
  seeds,
  studioPerm,
  liveConfig,
  digest,
} from './studio.js';
import {
  overview,
  ticketList,
  ticketDetail,
  actOnTicket,
  createTicket,
  creatable,
  preferences,
  feed,
  roleChannels,
} from './operations.js';
import {
  tiers,
  tierOrder,
  familyList,
  calendar,
  settings,
  search,
  dispatchOperation,
  operationCatalog,
} from './resources.js';
import { guides, commandCatalog } from './guide.js';
const root = fileURLToPath(new URL('../../web/public/', import.meta.url));
const mime = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
const ok = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
async function body(req) {
  check(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Требуется JSON.');
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    check(size <= 64 * 1024, 413, 'Запрос слишком большой.');
    parts.push(part);
  }
  try {
    return object(JSON.parse(Buffer.concat(parts).toString('utf8')));
  } catch {
    throw new ControlError(400, 'Некорректный JSON.');
  }
}
export function controlServer(r, options = controlOptions(), deps = {}) {
  const auth = authentication(r, options, deps.fetch),
    limits = new Map();
  const tick = (key, limit) => {
    const now = Date.now(),
      v = limits.get(key) || { time: now, n: 0 };
    if (now - v.time > 60000) {
      v.time = now;
      v.n = 0;
    }
    if (limits.size > 4096) limits.delete(limits.keys().next().value);
    limits.set(key, v);
    check(++v.n <= limit, 429, 'Слишком много запросов. Повторите через минуту.');
  };
  const reset = (m) => {
    if (m.guild?.id === options.guild) auth.invalidate(m.id);
  };
  const leave = (m) => {
    reset(m);
    if (m.guild?.id === options.guild)
      r.store.run('DELETE FROM control_sessions WHERE guild=? AND user=?', options.guild, m.id);
  };
  r.client.on?.(Events.GuildMemberUpdate, reset);
  r.client.on?.(Events.GuildMemberRemove, leave);
  const server = createServer(
    { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      let actor,
        path,
        mutating = false;
      r.busy++;
      try {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
        const url = new URL(req.url, options.origin);
        path = url.pathname;
        const q = Object.fromEntries(url.searchParams);
        if (!path.startsWith('/api/') && !path.startsWith('/auth/')) {
          check(['GET', 'HEAD'].includes(req.method), 405, 'Метод недоступен.');
          const rel = path === '/' || path === '/app' ? 'index.html' : decodeURIComponent(path.slice(1));
          const file = resolve(root, rel);
          check(
            file.startsWith(resolve(root) + sep) &&
              Object.hasOwn(mime, extname(file)) &&
              !rel.split(/[\\/]/).some((x) => x.startsWith('.')),
            404,
            'Файл не найден.',
          );
          let stat;
          try {
            stat = statSync(file);
          } catch {}
          check(stat?.isFile(), 404, 'Файл не найден.');
          res.writeHead(200, {
            'Content-Type': mime[extname(file)],
            'Content-Length': stat.size,
            'Cache-Control': rel.startsWith('art/') ? 'public, max-age=86400' : 'no-cache',
          });
          if (req.method === 'HEAD') res.end();
          else
            createReadStream(file)
              .on('error', () => res.destroy())
              .pipe(res);
          return;
        }
        if (path === '/auth/login') {
          check(req.method === 'GET', 405, 'Метод недоступен.');
          tick('login:' + req.socket.remoteAddress, 20);
          const next = auth.start();
          res.writeHead(302, { Location: next.url, 'Set-Cookie': next.cookie });
          return res.end();
        }
        if (path === '/auth/callback') {
          check(req.method === 'GET', 405, 'Метод недоступен.');
          try {
            const cookies = await auth.callback(req, url.searchParams);
            res.writeHead(303, { Location: '/', 'Set-Cookie': cookies });
          } catch {
            res.writeHead(303, { Location: '/?auth=error', 'Set-Cookie': auth.clearState() });
          }
          return res.end();
        }
        const session = auth.session(req);
        const post = req.method === 'POST';
        check(post || req.method === 'GET', 405, 'Метод недоступен.');
        if (post) {
          mutating = true;
          if (!session && path === '/auth/logout') {
            check(req.headers.origin === options.origin, 403, 'Проверка запроса не пройдена.');
            res.setHeader('Set-Cookie', auth.clearSession());
            return ok(res, 200, { loggedOut: true });
          }
          check(session, 401, 'Сеанс завершён. Войдите через Discord.');
          auth.verify(req, session);
        }
        if (path === '/auth/logout' && post) {
          const b = await body(req);
          res.setHeader('Set-Cookie', auth.logout(session, b.all === true));
          return ok(res, 200, { loggedOut: true });
        }
        if (path === '/api/session' && !session)
          return ok(res, 200, { state: 'login', configured: auth.configured() });
        check(session, 401, 'Войдите через Discord.');
        tick(session.hash, post ? 180 : 360);
        const b = post ? await body(req) : {};
        try {
          actor = await auth.actor(session, post && path !== '/api/preview');
        } catch (e) {
          if (!post && path === '/api/session' && e.status === 403)
            return ok(res, 200, { state: 'denied', csrf: session.csrf });
          throw e;
        }
        const a = actor,
          g = a.guild.id,
          u = a.member.id,
          db = r.store;
        let value;
        if (!post) {
          switch (path) {
            case '/api/session':
              value = {
                state: 'active',
                profile: a.profile,
                csrf: a.csrf,
                guild: { id: g, name: a.guild.name },
                permissions: [...a.permissions],
                managementRoles:
                  a.guild.ownerId === a.member.id
                    ? ['Владелец сервера']
                    : [...mappings(r.config, a.guild)]
                        .filter(
                          ([id, permissions]) =>
                            permissions.length && a.member.roles.cache.has(id) && a.guild.roles.cache.has(id),
                        )
                        .map(([id]) => a.guild.roles.cache.get(id).name),
                roles: [...a.member.roles.cache.values()].filter((x) => x?.id !== g).map((x) => x.name),
                prefs: preferences(r, a),
              };
              break;
            case '/api/overview':
              requirePermission(a, 'dashboard.overview');
              value = overview(r, a);
              break;
            case '/api/inbox':
              check(
                ['tickets.view', 'recruitment.view', 'tiers.view'].some((p) => a.permissions.has(p)),
                403,
                'Раздел недоступен.',
              );
              value = ticketList(r, a, q);
              break;
            case '/api/ticket':
              value = await ticketDetail(r, a, Number(q.id));
              break;
            case '/api/drafts':
              value = listDrafts(r, a, q);
              break;
            case '/api/draft':
              value = getDraft(r, a, q.id);
              break;
            case '/api/config':
              check(Object.hasOwn(studioPerm, q.kind), 400, 'Неизвестный тип.');
              requirePermission(a, studioPerm[q.kind]);
              value = { config: liveConfig(r, g, q.kind, q.key), key: q.key };
              value.revision = digest(value.config);
              break;
            case '/api/assets': {
              check(
                [
                  'tickets.configure',
                  'embeds.create',
                  'tiers.configure',
                  'tickets.create',
                  'roles.manage',
                  'permissions.manage',
                  'events.manage',
                  'moderation.manage',
                  'recruitment.review',
                  'family.manage',
                  'settings.manage',
                ].some((k) => a.permissions.has(k)),
                403,
                'Каталог недоступен.',
              );
              const base = seeds(r, g);
              value = {
                ...roleChannels(r, a),
                bot: {
                  name: r.client.user?.username || 'KARMA SYSTEM',
                  avatar: r.client.user?.displayAvatarURL?.({ size: 64 }),
                },
                ...(a.permissions.has('tiers.configure') ? { tierPolicy: base.types.tier } : {}),
                ...(a.permissions.has('tickets.configure')
                  ? {
                      typeRevisions: Object.fromEntries(
                        Object.entries(base.types).map(([key, p]) => [key, digest(p)]),
                      ),
                    }
                  : {}),
                emptyRevision: digest(null),
                ...(a.permissions.has('tickets.configure') || a.permissions.has('tickets.create')
                  ? {
                      types: a.permissions.has('tickets.configure')
                        ? base.types
                        : Object.fromEntries(
                            Object.entries(base.types).filter(([k, p]) => creatable(r, a, k, p)),
                          ),
                    }
                  : {}),
                ...(a.permissions.has('tiers.configure') ? { tier: base.tier } : {}),
                ...(a.permissions.has('embeds.create') ||
                a.permissions.has('tickets.configure') ||
                a.permissions.has('tiers.configure')
                  ? { embed: base.embed, templates: base.templates }
                  : {}),
                savedEmbeds: a.permissions.has('embeds.create')
                  ? db
                      .all('SELECT name FROM embed_templates WHERE guild=? ORDER BY name LIMIT 100', g)
                      .map((x) => x.name)
                  : [],
              };
              break;
            }
            case '/api/ticket/tiers': {
              requirePermission(a, 'tickets.create');
              const type = r.config.types(g)[q.type];
              check(type?.kind === 'tier' && creatable(r, a, q.type, type), 403, 'Категория недоступна.');
              value = db
                .all('SELECT key,config FROM tier_definitions WHERE guild=? ORDER BY key LIMIT 150', g)
                .map((x) => ({ ...x, config: JSON.parse(x.config) }))
                .filter((x) => creatable(r, a, q.type, { ...type, access: x.config.reviewers }))
                .map((x) => ({
                  key: x.key,
                  title: x.config.title,
                  questions: x.config.questions || type.questions,
                }));
              break;
            }
            case '/api/tiers':
              value = tiers(r, a);
              break;
            case '/api/family':
              value = familyList(r, a, q);
              break;
            case '/api/events':
              value = calendar(r, a, q);
              break;
            case '/api/commands':
              value = commandCatalog(r, a);
              break;
            case '/api/operations':
              value = operationCatalog(r, a);
              break;
            case '/api/help':
              value = guides;
              break;
            case '/api/roles':
              value = roleMatrix(r, a);
              break;
            case '/api/settings':
              value = settings(r, a);
              break;
            case '/api/audit':
              requirePermission(a, 'audit.view');
              value = feed(r, a, q);
              break;
            case '/api/notifications':
              value =
                preferences(r, a).notifications === 'off' ? { items: [], more: false } : feed(r, a, q, true);
              break;
            case '/api/profile':
              value = {
                personal: feed(r, a, { own: '1' }, true).items,
                assigned: ticketList(r, a, { mine: '1' }).items,
              };
              break;
            case '/api/search':
              value = search(r, a, q.q);
              break;
            case '/api/analytics':
              requirePermission(a, 'analytics.view');
              value = overview(r, a);
              break;
            case '/api/moderation':
              requirePermission(a, 'moderation.view');
              value = db.all(
                'SELECT id,user,action,actor,created,reason FROM moderation_cases WHERE guild=? ORDER BY id DESC LIMIT 26 OFFSET ?',
                g,
                pageOffset(q.offset),
              );
              break;
            default:
              throw new ControlError(404, 'Маршрут не найден.');
          }
        } else {
          switch (path) {
            case '/api/draft':
              value = saveDraft(r, a, b, b.id);
              break;
            case '/api/draft/state':
              value = transition(r, a, b.id, b);
              break;
            case '/api/draft/apply':
              value = await r.locks.with('studio:' + b.id, () => applyConfig(r, a, b.id, b));
              break;
            case '/api/preview':
              check(Object.hasOwn(studioPerm, b.kind), 400, 'Неизвестный тип.');
              requirePermission(a, studioPerm[b.kind]);
              validateBody(b.kind, b.body, a, false);
              value = renderDraft(b.kind, b.body, a);
              break;
            case '/api/publish/preview':
              value = await prepublish(r, a, b.id, b);
              break;
            case '/api/publish/confirm':
              value = await publish(r, a, b.id, b);
              break;
            case '/api/ticket/create':
              value = await createTicket(r, a, b);
              break;
            case '/api/ticket/action':
              value = await actOnTicket(r, a, Number(b.id), b);
              break;
            case '/api/operation':
              value = await dispatchOperation(r, a, b);
              break;
            case '/api/tiers':
              value = tierOrder(r, a, b);
              break;
            case '/api/roles':
              value = changeGrant(r, a, b);
              break;
            case '/api/settings':
              value = settings(r, a, b);
              break;
            case '/api/profile':
              value = preferences(r, a, b);
              break;
            case '/api/notifications/read': {
              const events = feed(r, a, { offset: b.offset }, true).items.map((x) => x.id);
              for (const id of events.filter((id) => Array.isArray(b.ids) && b.ids.includes(id)))
                db.run('INSERT OR IGNORE INTO control_reads VALUES(?,?,?)', g, u, id);
              value = { saved: true };
              break;
            }
            default:
              throw new ControlError(404, 'Маршрут не найден.');
          }
        }
        ok(res, 200, value);
      } catch (e) {
        if (res.headersSent) return res.end();
        const status =
          e instanceof ControlError
            ? e.status
            : e instanceof InputError
              ? 400
              : e.code === 50013
                ? 403
                : e.code === 10003 || e.code === 10008
                  ? 404
                  : e.code === 'ERR_SQLITE_ERROR' && e.errcode === 5
                    ? 503
                    : 500;
        if (status >= 500) r.log('control.request', { name: e.name, code: e.code });
        if (mutating && actor && path !== '/api/preview')
          try {
            r.store.audit(actor.guild.id, 'control.request.failed', actor.member.id, path, {
              status,
              outcome: 'failed',
            });
          } catch {}
        ok(res, status, {
          error:
            e instanceof ControlError || e instanceof InputError
              ? e.message
              : status === 403
                ? 'Discord отказал в доступе.'
                : status === 404
                  ? 'Ресурс удалён или недоступен.'
                  : 'Операция не завершена. Проверьте соединение и журнал.',
        });
      } finally {
        r.busy--;
      }
    },
  );
  server.on('close', () => {
    r.client.off?.(Events.GuildMemberUpdate, reset);
    r.client.off?.(Events.GuildMemberRemove, leave);
  });
  return {
    server,
    auth,
    options,
    listen: () =>
      new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => {
          server.removeListener('error', reject);
          accept(server.address());
        });
      }),
    close: () =>
      new Promise((accept) => {
        server.close(accept);
        server.closeIdleConnections();
      }),
  };
}
