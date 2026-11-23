export const client = { csrf: '' };
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'open')
      el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const x of kids.flat(Infinity))
    if (x != null && x !== false) el.append(x instanceof Node ? x : document.createTextNode(String(x)));
  return el;
}
export const div = (cls, ...items) => h('div', { class: cls }, ...items);
export const title = (s) => h('h2', {}, s);
export const hint = (s) => h('p', { class: 'hint' }, s);
export const badge = (s, t = '') => h('span', { class: 'badge ' + t }, s);
export const panel = (name, ...items) => h('section', { class: 'panel' }, name && title(name), ...items);
export const grid = (...items) => div('grid', items);
export const bar = (...items) => div('bar', items);
export const field = (name, input, help) =>
  h('label', { class: 'field' }, h('span', {}, name), input, help && h('small', {}, help));
export const input = (v = '', attrs = {}) => h('input', { value: v ?? '', ...attrs });
export const area = (v = '', attrs = {}) => h('textarea', attrs, v ?? '');
export const select = (items, v = '', attrs = {}) =>
  h(
    'select',
    attrs,
    items.map((x) => {
      const [key, name] = Array.isArray(x) ? x : [x, x];
      return h('option', { value: key, selected: String(key) === String(v) }, name);
    }),
  );
export const multi = (items, values = []) =>
  h(
    'select',
    { multiple: true, size: Math.min(6, Math.max(2, items.length)) },
    items.map(([k, n]) => h('option', { value: k, selected: values.includes(k) }, n)),
  );
export const selected = (el) => [...el.selectedOptions].map((x) => x.value);
export const empty = (s) => div('empty', s);
export const fmt = (n) =>
  n
    ? new Date(n).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export const labels = {
  personal: 'Личный',
  pending: 'Ожидает рассмотрения',
  review: 'На рассмотрении',
  waiting: 'Ожидает проверки',
  accepted: 'Принят',
  rejected: 'Отклонён',
  expired: 'Просрочен',
  shared: 'Общий',
  ready: 'К публикации',
  published: 'Опубликован',
  archived: 'В архиве',
  open: 'Открыт',
  closed: 'Закрыт',
  creating: 'Создаётся',
  scheduled: 'Запланировано',
  active: 'Активно',
  completed: 'Завершено',
  cancelled: 'Отменено',
  ticket: 'Панель тикета',
  tier: 'Тир',
  embed: 'Сообщение',
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  critical: 'Критический',
  rename: 'Переименовать',
  proof: 'Исправить доказательства',
  urgent: 'Срочный',
  claim: 'Взять в работу',
  unclaim: 'Снять назначение',
  transfer: 'Передать',
  priority: 'Изменить приоритет',
  close: 'Закрыть',
  reopen: 'Открыть снова',
  reply: 'Ответить в Discord',
  note: 'Внутренняя заметка',
  accept: 'Одобрить',
  reject: 'Отклонить',
  interview: 'Назначить обзвон',
  info: 'Запросить информацию',
  hold: 'Отложить',
  escalate: 'Передать руководству',
  transcript: 'Сохранить транскрипт',
  archive: 'Архивировать',
  add: 'Добавить участника',
  remove: 'Убрать участника',
};
export const tr = (k) => labels[k] || k;
export function toast(s, err = false) {
  const n = div('toast ' + (err ? 'error' : ''), s);
  document.querySelector('#toasts').append(n);
  setTimeout(() => n.remove(), err ? 8500 : 4000);
}
export function btn(s, fn, cls = '') {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn ' + cls,
      onclick: async (e) => {
        const el = e.currentTarget;
        if (el.disabled) return;
        el.disabled = true;
        try {
          await fn(e);
        } catch (err) {
          toast(err.message, true);
        } finally {
          el.disabled = false;
        }
      },
    },
    s,
  );
}
export function link(s, url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:')
      return h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, s);
  } catch {}
  return h('span', {}, s);
}
export async function api(path, q) {
  const url = new URL('/api/' + path, location.origin);
  for (const [k, v] of Object.entries(q || {})) if (v != null) url.searchParams.set(k, v);
  return request(url);
}
export const post = (path, data) =>
  request(path.startsWith('/') ? path : '/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': client.csrf },
    body: JSON.stringify(data),
  });
async function request(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error('Нет ответа от KARMA CONTROL.');
  }
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('session-ended'));
    throw Error(data.error || 'Не удалось выполнить запрос.');
  }
  return data;
}
export function dialog(name, ...content) {
  const d = h(
    'dialog',
    { class: 'dialog' },
    bar(
      title(name),
      btn('Закрыть', () => d.close(), 'quiet'),
    ),
    div('dialog-body', content),
  );
  document.body.append(d);
  d.addEventListener('close', () => d.remove(), { once: true });
  d.showModal();
  return d;
}
export function confirmAction(name, detail, fn) {
  const d = dialog(
    name,
    hint(detail),
    btn(
      'Подтвердить',
      async () => {
        await fn();
        d.close();
      },
      'primary',
    ),
  );
  return d;
}
export function pages(next, back) {
  return bar(back && btn('← Назад', back), next && btn('Далее →', next));
}
export function fold(name, ...content) {
  return h('details', { class: 'fold' }, h('summary', {}, name), div('fold-body', content));
}
export function list(rows, render, none = 'Записей пока нет.') {
  return rows.length ? div('list', rows.map(render)) : empty(none);
}
export function prefAttrs(p) {
  const d = document.documentElement;
  d.dataset.theme = p.theme;
  d.dataset.font = p.font;
  d.classList.toggle('compact', p.compact);
  d.classList.toggle('reduce', p.reducedMotion);
}
export function icon(name) {
  const paths = {
    overview: 'M3 3h7v7H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 14h7v7H3z',
    inbox: 'M3 5h18v13H3z M3 13h5l2 3h4l2-3h5',
    recruitment:
      'M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9 10a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M19 8v6 M16 11h6',
    tiers: 'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    ticket: 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z M14 7v2 M14 11v2 M14 15v2',
    embed: 'M5 4h14v16H5z M8 8h8 M8 12h6 M8 16h4',
    publishing: 'M3 11l18-8-7 18-3-8z M11 13L21 3',
    family:
      'M3 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2 M8 10a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M16 5a3 3 0 0 1 0 6 M17 14a4 4 0 0 1 4 4v2',
    events: 'M3 6h18v15H3z M3 11h18 M7 3v6 M17 3v6',
    analytics: 'M4 3v17h17 M8 16v-5 M13 16V8 M18 16V5',
    commands: 'M4 6l6 6-6 6 M12 18h8',
    help: 'M3 5q4-2 9 1q5-3 9-1v14q-4-2-9 1q-5-3-9-1z M12 6v14',
    roles: 'M12 2l8 4v6q0 6-8 10-8-4-8-10V6z M9 12l2 2 4-5',
    audit: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M15 9v6 M10 15v6',
    notifications: 'M4 17h16l-2-3V9a6 6 0 0 0-12 0v5z M10 20h4',
    profile: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M4 21a8 8 0 0 1 16 0',
    search: 'M10 17a7 7 0 1 0 0-14a7 7 0 0 0 0 14 M15 15l6 6',
    menu: 'M3 6h18 M3 12h18 M3 18h18',
    moderation: 'M12 2l8 4v6q0 6-8 10-8-4-8-10V6z',
  };
  const ns = 'http://www.w3.org/2000/svg',
    s = document.createElementNS(ns, 'svg'),
    p = document.createElementNS(ns, 'path');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    'aria-hidden': 'true',
  }))
    s.setAttribute(k, v);
  p.setAttribute('d', paths[name] || paths.overview);
  s.append(p);
  return s;
}
