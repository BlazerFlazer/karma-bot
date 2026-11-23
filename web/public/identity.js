const brandMark = new URL('./art/mark.svg', import.meta.url).href;
const sculpture = new URL('./art/karma-sculpture.webp', import.meta.url).href;

const iconPaths = {
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.1 8.7a3 3 0 0 1 5.8.9c0 2.1-2.9 2.4-2.9 4.6', 'M12 17.2h.01'],
  shield: ['M12 2.5c2.5 2 5.2 3.1 8 3.5v6.4c0 4.1-3.2 7.1-8 9.2-4.8-2.1-8-5.1-8-9.2V6c2.8-.4 5.5-1.5 8-3.5Z', 'm8.8 11.8 2.2 2.3 4.2-4.5'],
  lock: ['M6 10h12a1.8 1.8 0 0 1 1.8 1.8v7.3A1.9 1.9 0 0 1 18 21H6a1.9 1.9 0 0 1-1.8-1.9v-7.3A1.8 1.8 0 0 1 6 10Z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v2.5'],
  x: ['m6 6 12 12', 'M18 6 6 18'],
  exit: ['M10 4H5v16h5', 'M9 12h12', 'm16 7 5 5-5 5'],
  diamond: ['m12 2 9.5 10-9.5 10L2.5 12z', 'm7.5 12 4.5 4.7 4.5-4.7-4.5-4.7z'],
  alert: ['M12 3 2 21h20L12 3Z', 'M12 9v5', 'M12 17h.01'],
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', name === 'discord' ? 'currentColor' : 'none');
  if (name !== 'discord') {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.65');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  const paths = name === 'discord'
    ? ['M19.73 5.48a17.6 17.6 0 0 0-4.37-1.34c-.2.35-.43.83-.59 1.2a16.3 16.3 0 0 0-5.53 0c-.17-.37-.4-.85-.6-1.2a17.83 17.83 0 0 0-4.38 1.35C1.49 9.66.74 13.73 1.1 17.73a17.65 17.65 0 0 0 5.36 2.7c.44-.6.83-1.24 1.17-1.91a11.4 11.4 0 0 1-1.85-.88l.45-.35a12.6 12.6 0 0 0 11.55 0l.45.35a11.7 11.7 0 0 1-1.86.89c.34.67.73 1.3 1.17 1.9a17.5 17.5 0 0 0 5.36-2.7c.43-4.65-.72-8.68-3.17-12.25ZM8.3 15.32c-1.02 0-1.87-.94-1.87-2.09s.83-2.1 1.87-2.1c1.05 0 1.89.96 1.87 2.1 0 1.15-.82 2.09-1.87 2.09Zm7.4 0c-1.03 0-1.87-.94-1.87-2.09s.83-2.1 1.87-2.1c1.04 0 1.88.96 1.87 2.1 0 1.15-.83 2.09-1.87 2.09Z']
    : iconPaths[name];
  for (const data of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

function textButton(text, className) {
  const button = node('button', className, text);
  button.type = 'button';
  return button;
}

function approvedLoginUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, location.href);
    if (url.username || url.password) return null;
    if (['http:', 'https:'].includes(url.protocol) && url.origin === location.origin) return url.href;
    if (url.origin === 'https://discord.com' && url.pathname === '/oauth2/authorize') return url.href;
  } catch { /* An invalid login target cannot be used for authorization. */ }
  return null;
}

const info = {
  about: {
    title: 'О платформе',
    paragraphs: [
      'KARMA CONTROL — рабочее пространство семьи KARMA на Majestic RP. Здесь сотрудники разбирают обращения, рассматривают заявки и управляют составом.',
      'Войдите с учётной записью Discord, которой вы пользуетесь на сервере семьи. Доступные инструменты зависят от назначенных вам ролей.',
    ],
  },
  privacy: {
    title: 'Конфиденциальность',
    paragraphs: [
      'Вы подтверждаете свою учётную запись на странице Discord. Платформа использует идентификатор, имя и аватар для входа, а серверные роли — для проверки доступа.',
      'После входа сеанс сохраняется в защищённом cookie. Выйти из него можно через меню профиля.',
    ],
  },
};

function dialogFor(section) {
  const dialog = node('dialog', 'identity-dialog');
  const labelId = 'identity-dialog-title-' + section;
  dialog.setAttribute('aria-labelledby', labelId);
  const heading = node('h2', '', info[section].title);
  heading.id = labelId;
  const close = textButton('', 'identity-icon-button');
  close.setAttribute('aria-label', 'Закрыть');
  close.append(icon('x'));
  close.addEventListener('click', () => dialog.close());
  const top = node('div', 'identity-dialog-top');
  top.append(heading, close);
  const ok = textButton('Понятно', 'identity-dialog-ok');
  ok.addEventListener('click', () => dialog.close());
  dialog.append(top, ...info[section].paragraphs.map((text) => node('p', '', text)), ok);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  return dialog;
}

function brand() {
  const group = node('div', 'identity-brand');
  const mark = node('img');
  mark.src = brandMark;
  mark.width = 37;
  mark.height = 37;
  mark.alt = '';
  const type = node('span', 'identity-wordmark', 'KARMA');
  const name = node('span', 'identity-product', 'CONTROL');
  group.append(mark, type, name);
  return group;
}

function artPanel() {
  const figure = node('figure', 'identity-art');
  const picture = node('img', 'identity-sculpture');
  picture.src = sculpture;
  picture.width = 1200;
  picture.height = 800;
  picture.alt = '';
  picture.fetchPriority = 'high';
  const caption = node('figcaption', 'identity-caption');
  const context = node('p', 'identity-context');
  context.append(icon('diamond'), document.createTextNode('KARMA FAMILY'));
  const statement = node('p', 'identity-statement');
  statement.lang = 'en';
  statement.append(node('span', '', 'Your family.'), node('span', '', 'Your command.'));
  caption.append(context, statement);
  figure.append(picture, caption);
  return figure;
}

const states = {
  login: {
    heading: 'Добро пожаловать',
    description: 'Войдите через Discord, чтобы управлять заявками, обращениями и составом семьи KARMA.',
    note: 'Доступ определяется вашей ролью на сервере семьи.',
    badge: 'Приватное пространство',
  },
  denied: {
    heading: 'Доступ ограничен',
    description: 'У этой учётной записи нет доступа к панели KARMA. Обратитесь к руководству семьи, чтобы проверить назначенные роли.',
    note: 'Для входа под другой учётной записью завершите текущий сеанс.',
    badge: 'Проверка доступа',
  },
  error: {
    heading: 'Вход не завершён',
    description: 'Проверить авторизацию через Discord не удалось. Вы можете повторить вход.',
    note: 'Продолжение снова откроет официальную страницу Discord.',
    badge: 'Авторизация',
  },
};

/** Render the public identity experience without reading protected workspace data. */
export function renderIdentity(root, { state = 'login', loginUrl = '/auth/login', message = '', logout, configured = true } = {}) {
  const kind = Object.hasOwn(states, state) ? state : 'error';
  const content = states[kind];
  const page = node('div', 'identity');
  const about = dialogFor('about');
  const privacy = dialogFor('privacy');
  const head = node('header', 'identity-header');
  const help = textButton('', 'identity-help');
  help.append(icon('help'), document.createTextNode('О платформе'));
  help.addEventListener('click', () => about.showModal());
  head.append(brand(), help);

  const stage = node('section', 'identity-stage');
  stage.setAttribute('aria-labelledby', 'identity-heading');
  const access = node('div', 'identity-access');
  const panel = node('div', 'identity-panel-content');
  const badge = node('div', 'identity-badge');
  badge.append(icon(kind === 'error' ? 'alert' : 'shield'), document.createTextNode(content.badge));
  const title = node('h1', 'identity-heading', content.heading);
  title.id = 'identity-heading';
  const lead = node('p', 'identity-lead', content.description);
  panel.append(badge, title, lead);

  const endpoint = approvedLoginUrl(loginUrl);
  const actions = node('div', 'identity-actions');
  const status = node('p', 'identity-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  if (message) status.textContent = String(message).slice(0, 320);
  if (kind === 'denied' && typeof logout === 'function') {
    const signout = textButton('', 'identity-cta');
    signout.append(icon('exit'), document.createTextNode('Выйти из аккаунта'));
    signout.addEventListener('click', async () => {
      signout.disabled = true;
      try {
        await logout();
      } catch {
        status.textContent = 'Не удалось завершить сеанс. Повторите попытку.';
      } finally {
        signout.disabled = false;
      }
    });
    actions.append(signout);
  } else {
    const available = configured && endpoint;
    const cta = available ? node('a', 'identity-cta') : textButton('', 'identity-cta');
    if (available) cta.href = endpoint;
    else {
      cta.disabled = true;
      if (!message) status.textContent = 'Вход станет доступен после подключения Discord OAuth2 владельцем сервера.';
    }
    const label = kind === 'error' ? 'Повторить вход через Discord' : 'Продолжить через Discord';
    cta.append(icon('discord'), document.createTextNode(label));
    actions.append(cta);
  }
  actions.append(status);
  const note = node('p', 'identity-access-note');
  note.append(icon('lock'), node('span', '', content.note));
  panel.append(actions, note);
  access.append(panel);
  stage.append(artPanel(), access);

  const foot = node('footer', 'identity-footer');
  const family = node('p', 'identity-foot-name');
  family.append(node('span', '', 'KARMA SYSTEM'), node('span', 'identity-foot-dot', '·'), node('span', '', 'Majestic RP'));
  const policy = textButton('Конфиденциальность', 'identity-policy');
  policy.addEventListener('click', () => privacy.showModal());
  foot.append(family, policy);
  page.append(head, stage, foot, about, privacy);
  root.replaceChildren(page);
}
