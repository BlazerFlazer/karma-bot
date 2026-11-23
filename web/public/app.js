import { h, div, bar, btn, api, post, client, toast, dialog, icon, prefAttrs, input, empty } from './ui.js';
import { renderIdentity } from './identity.js';
const routes = [
  ['overview', 'Обзор', 'Пространство', 'dashboard.overview'],
  ['inbox', 'Входящие', 'Пространство', 'tickets.view|tiers.view|recruitment.view'],
  ['recruitment', 'Набор', 'Пространство', 'recruitment.view'],
  ['family', 'Состав семьи', 'Пространство', 'family.view'],
  ['events', 'Мероприятия', 'Пространство', 'events.view'],
  ['ticket', 'Студия тикетов', 'Студии', 'tickets.configure'],
  ['tiers', 'Студия тиров', 'Студии', 'tiers.view|tiers.configure'],
  ['embed', 'Студия сообщений', 'Студии', 'embeds.create'],
  ['publishing', 'Публикации', 'Студии', 'embeds.create|tiers.configure|tickets.configure'],
  ['analytics', 'Аналитика', 'Управление', 'analytics.view'],
  ['roles', 'Роли и права', 'Управление', 'roles.manage|permissions.manage'],
  ['moderation', 'Модерация', 'Управление', 'moderation.view'],
  ['audit', 'Журнал действий', 'Управление', 'audit.view'],
  ['settings', 'Настройки сервера', 'Управление', 'settings.manage'],
  ['commands', 'Команды', 'Справка'],
  ['help', 'Руководство', 'Справка'],
  ['profile', 'Мой профиль'],
  ['notifications', 'Уведомления'],
];
const root = document.getElementById('root');
let serial = 0,
  refreshTimer,
  loadId = 0;
const app = {
  s: null,
  can: (p) => !p || p.split('|').some((x) => app.s.permissions.includes(x)),
  routes: () => routes.filter((r) => app.can(r[3])),
  go: (key, q = {}) => {
    const hash = key + (Object.keys(q).length ? '?' + new URLSearchParams(q) : '');
    if (location.hash.slice(1) === hash) return render();
    location.hash = hash;
  },
  reload: () => render(),
  prefs: async (p) => {
    app.s.prefs = await post('profile', p);
    prefAttrs(app.s.prefs);
  },
};
async function logout(all = false) {
  await post('/auth/logout', { all });
  history.replaceState(null, '', '/');
  await init();
}
app.logout = logout;
function avatar() {
  return app.s.profile.avatar
    ? h('img', { class: 'avatar', src: app.s.profile.avatar, alt: '' })
    : div('avatar', app.s.profile.name.slice(0, 1));
}
function palette() {
  const q = input('', {
      placeholder: 'Страница, команда, участник или номер тикета…',
      'aria-label': 'Поиск',
    }),
    results = div('list'),
    d = dialog('Поиск по пространству', q, results);
  let token = 0,
    timer;
  async function find() {
    const id = ++token,
      term = q.value.trim().toLowerCase();
    const links = app
      .routes()
      .filter((x) => x[1].toLowerCase().includes(term))
      .map((x) => ({ title: x[1], detail: 'Раздел', route: x[0] }));
    try {
      if (term) links.push(...(await api('search', { q: term })));
      if (id !== token || !d.open) return;
      results.replaceChildren(
        ...links.slice(0, 25).map((x) =>
          btn(
            div('result', h('b', {}, x.title), h('small', {}, x.detail)),
            () => {
              d.close();
              app.go(
                x.route,
                x.id
                  ? { id: x.id }
                  : x.template
                    ? { template: x.template }
                    : x.key
                      ? { key: x.key }
                      : x.query
                        ? { q: x.query }
                        : {},
              );
            },
            'rowbtn',
          ),
        ),
      );
      if (!links.length) results.append(empty('Совпадений нет.'));
    } catch (e) {
      if (id === token) results.replaceChildren(empty(e.message));
    }
  }
  q.oninput = () => {
    token++;
    clearTimeout(timer);
    timer = setTimeout(find, 230);
  };
  d.addEventListener('keydown', (e) => {
    const buttons = [...results.querySelectorAll('button')],
      at = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(e.key) && buttons.length) {
      e.preventDefault();
      buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    } else if (e.key === 'Enter' && document.activeElement === q) buttons[0]?.click();
  });
  find();
  q.focus();
}
function navLink(r, key) {
  return h(
    'a',
    {
      class: 'navlink ' + (r[0] === key ? 'active' : ''),
      href: '#' + r[0],
      'aria-current': r[0] === key ? 'page' : null,
    },
    icon(r[0]),
    r[1],
  );
}
function shell(key, name) {
  const available = app.routes();
  const sidebar = h(
    'aside',
    { class: 'sidebar', id: 'navigation' },
    h(
      'a',
      { class: 'wordmark', href: '#' + available[0][0] },
      h('img', { src: '/art/mark.svg', alt: '' }),
      div('', h('b', {}, 'KARMA'), h('small', {}, 'CONTROL')),
    ),
  );
  const nav = h('nav', { 'aria-label': 'Разделы' });
  const favorites = available.filter((r) => app.s.prefs.favorites.includes(r[0]));
  if (favorites.length) nav.append(h('h3', {}, 'Избранное'), ...favorites.map((r) => navLink(r, key)));
  for (const group of ['Пространство', 'Студии', 'Управление', 'Справка']) {
    const items = available.filter((r) => r[2] === group);
    if (items.length) nav.append(h('h3', {}, group), ...items.map((r) => navLink(r, key)));
  }
  sidebar.append(nav, div('sidebar-foot', h('i', { class: 'dot' }), app.s.guild.name));
  const navbtn = btn(
    icon('menu'),
    () => {
      sidebar.classList.toggle('expanded');
      scrim.hidden = !sidebar.classList.contains('expanded');
      navbtn.setAttribute('aria-expanded', String(!scrim.hidden));
    },
    'iconbtn mobile',
  );
  navbtn.setAttribute('aria-label', 'Открыть меню');
  navbtn.setAttribute('aria-controls', 'navigation');
  const scrim = h('button', { class: 'scrim', 'aria-label': 'Закрыть меню', onclick: () => navbtn.click() });
  scrim.hidden = true;
  const bell = btn(icon('notifications'), () => app.go('notifications'), 'iconbtn');
  bell.setAttribute('aria-label', 'Уведомления');
  const top = h(
    'header',
    { class: 'top' },
    bar(navbtn, h('span', { class: 'crumb' }, 'KARMA CONTROL', h('i', {}, '/'), h('strong', {}, name))),
    bar(
      btn([icon('search'), h('span', {}, 'Поиск'), h('kbd', {}, 'Ctrl K')], palette, 'searchbtn'),
      bell,
      h(
        'details',
        { class: 'profilemenu' },
        h('summary', { 'aria-label': 'Меню профиля' }, avatar(), h('span', {}, app.s.profile.name)),
        div(
          'menubody',
          h('strong', {}, app.s.profile.name),
          h('small', {}, (app.s.managementRoles || []).join(' · ')),
          btn('Мой профиль', () => app.go('profile')),
          btn('Выйти', () => logout()),
        ),
      ),
    ),
  );
  const content = h('main', { id: 'main', tabindex: '-1' }),
    layout = div(
      'shell',
      h(
        'a',
        {
          class: 'skip',
          href: '#main',
          onclick: (e) => {
            e.preventDefault();
            content.focus();
          },
        },
        'К содержанию',
      ),
      sidebar,
      scrim,
      div('workspace', top, content),
    );
  return { layout, content };
}
async function render() {
  clearTimeout(refreshTimer);
  if (app.s?.state !== 'active') return;
  const n = ++serial,
    [raw, params] = location.hash.slice(1).split('?'),
    q = Object.fromEntries(new URLSearchParams(params)),
    r = app.routes().find((x) => x[0] === raw) || app.routes()[0];
  const key = r[0];
  document.title = r[1] + ' · KARMA CONTROL';
  const { layout, content } = shell(key, r[1]);
  root.replaceChildren(layout);
  content.append(div('loading', 'Загрузка…'));
  try {
    const mod = await import(
      ['ticket', 'tiers', 'embed', 'publishing'].includes(key) ? './studio.js' : './workspace.js'
    );
    const result = await mod.page(app, key, q);
    if (n !== serial) return;
    content.replaceChildren(result);
    if (['overview', 'analytics', 'inbox', 'recruitment', 'events', 'notifications', 'audit'].includes(key)) {
      const schedule = () => {
        refreshTimer = setTimeout(async () => {
          if (n !== serial) return;
          if (
            document.hidden ||
            document.querySelector('dialog[open]') ||
            ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName) ||
            scrollY > 8
          )
            return schedule();
          try {
            const s = await api('session');
            if (n !== serial) return;
            if (s.state !== 'active') return init();
            app.s = s;
            client.csrf = s.csrf;
            await render();
          } catch (e) {
            toast(e.message, true);
            schedule();
          }
        }, 60000);
      };
      schedule();
    }
  } catch (e) {
    if (n === serial)
      content.replaceChildren(
        div('errorbox', h('h1', {}, 'Раздел недоступен'), h('p', {}, e.message), btn('Повторить', render)),
      );
  }
}
async function init() {
  const id = ++loadId;
  ++serial;
  clearTimeout(refreshTimer);
  app.s = null;
  try {
    const s = await api('session');
    if (id !== loadId) return;
    app.s = s;
    client.csrf = s.csrf || '';
    if (s.state === 'active') {
      prefAttrs(s.prefs);
      await render();
    } else {
      document.documentElement.removeAttribute('data-theme');
      renderIdentity(root, {
        state: location.search.includes('auth=error') ? 'error' : s.state,
        configured: s.configured,
        logout,
      });
    }
  } catch (e) {
    renderIdentity(root, { state: 'error', message: e.message, logout });
  }
}
window.onhashchange = render;
window.addEventListener('session-ended', init);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && app.s?.state === 'active') {
    e.preventDefault();
    if (!document.querySelector('dialog[open]')) palette();
  }
});
init();
