import {
  h,
  div,
  bar,
  btn,
  api,
  post,
  toast,
  panel,
  grid,
  field,
  input,
  area,
  select,
  multi,
  selected,
  badge,
  hint,
  empty,
  list,
  fmt,
  confirmAction,
  fold,
} from './ui.js';
import { view, heading, activity } from './workspace.js';
const widgetNames = {
  overview: 'График обращений',
  activity: 'Последние действия',
  assigned: 'Назначено мне',
};
async function profile(app) {
  const { personal, assigned } = await api('profile'),
    s = app.s,
    p = structuredClone(s.prefs),
    theme = select(
      [
        ['dark', 'KARMA Dark'],
        ['light', 'KARMA Light'],
      ],
      p.theme,
    ),
    font = select(
      [
        ['system', 'Manrope'],
        ['editorial', 'С засечками'],
        ['mono', 'Моноширинный'],
      ],
      p.font,
    ),
    notes = select(
      [
        ['all', 'Все доступные'],
        ['assigned', 'Мои и назначенные'],
        ['off', 'Отключены'],
      ],
      p.notifications,
    ),
    compact = input('', { type: 'checkbox', checked: p.compact }),
    motion = input('', { type: 'checkbox', checked: p.reducedMotion }),
    favs = multi(
      app
        .routes()
        .filter((x) => x[2])
        .map((x) => [x[0], x[1]]),
      p.favorites,
    ),
    widgets = div('list');
  function draw() {
    widgets.replaceChildren(
      ...p.widgets.map((k, i) => {
        const enabled = input('', { type: 'checkbox', checked: !p.hidden.includes(k) });
        enabled.onchange = () => {
          p.hidden = enabled.checked ? p.hidden.filter((x) => x !== k) : [...p.hidden, k];
        };
        const move = (j) => {
          [p.widgets[i], p.widgets[j]] = [p.widgets[j], p.widgets[i]];
          draw();
        };
        return div(
          'row',
          h('label', { class: 'checkline' }, enabled, widgetNames[k] || k),
          bar(i > 0 && btn('↑', () => move(i - 1)), i < p.widgets.length - 1 && btn('↓', () => move(i + 1))),
        );
      }),
    );
  }
  draw();
  return view(
    heading(
      s.profile.name,
      '@' + s.profile.username,
      btn('Выйти', () => app.logout(false)),
    ),
    bar(s.roles.map((n) => badge(n))),
    grid(
      panel(
        'Мои настройки',
        grid(field('Тема', theme), field('Шрифт сайта', font)),
        field('Уведомления', notes),
        h('label', { class: 'checkline' }, compact, 'Компактный интерфейс'),
        h('label', { class: 'checkline' }, motion, 'Сократить анимацию'),
        field('Избранные разделы', favs),
        fold('Виджеты обзора', widgets),
        btn(
          'Сохранить предпочтения',
          async () => {
            await app.prefs({
              ...p,
              theme: theme.value,
              font: font.value,
              notifications: notes.value,
              compact: compact.checked,
              reducedMotion: motion.checked,
              favorites: selected(favs),
            });
            toast('Предпочтения сохранены.');
            app.reload();
          },
          'primary',
        ),
      ),
      div(
        'stack',
        panel(
          'Назначено мне',
          list(assigned, (t) =>
            btn('#' + t.id + ' · ' + t.title, () => app.go('inbox', { id: t.id }), 'rowbtn'),
          ),
        ),
        panel('Мои действия', activity(app, personal)),
        fold('Мои разрешения', bar(s.permissions.map((x) => badge(x)))),
        btn('Завершить все мои сеансы', () =>
          confirmAction(
            'Завершить все сеансы?',
            'Потребуется повторный вход через Discord на каждом устройстве.',
            () => app.logout(true),
          ),
        ),
      ),
    ),
  );
}
async function roles(app) {
  const [matrix, assets] = await Promise.all([api('roles'), api('assets')]),
    editing = app.can('permissions.manage'),
    map = new Map(matrix.rows.map((r) => [r.id, r])),
    pool = [
      ...assets.roles.map((r) => [r.id, r.name]),
      ...matrix.rows.filter((r) => r.missing).map((r) => [r.id, r.name + ' · ' + r.id]),
    ],
    search = input('', { placeholder: 'Название или ID роли' }),
    choice = select([]),
    detail = div('stack'),
    compare = select([['', 'Без сравнения'], ...matrix.rows.map((r) => [r.id, r.name])]);
  let current;
  function draw() {
    const id = choice.value;
    if (!id) {
      detail.replaceChildren(empty('Выберите роль.'));
      return;
    }
    const row = map.get(id) || { id, revision: 0, permissions: [], name: pool.find((x) => x[0] === id)?.[1] },
      perms = new Set(row.permissions),
      before = map.get(compare.value),
      preset = select([['', 'Выбрать пресет'], ...Object.keys(matrix.presets).map((x) => [x, x])]),
      body = div('stack'),
      count = badge('');
    current = id;
    function boxes() {
      count.textContent = perms.size + ' разрешений';
      const groups = {};
      for (const [key, label] of Object.entries(matrix.labels)) {
        const group = key.split('.')[0],
          check = input('', { type: 'checkbox', checked: perms.has(key), disabled: !editing });
        check.onchange = () => {
          if (check.checked) perms.add(key);
          else perms.delete(key);
          count.textContent = perms.size + ' разрешений';
        };
        (groups[group] ||= []).push(
          h(
            'label',
            { class: 'checkline' },
            check,
            div('result', label, h('small', {}, key)),
            before && badge(before.permissions.includes(key) ? 'есть у сравниваемой' : 'нет у сравниваемой'),
          ),
        );
      }
      body.replaceChildren(...Object.entries(groups).map(([k, els]) => fold(k, els)));
    }
    preset.onchange = () => {
      if (!preset.value) return;
      perms.clear();
      matrix.presets[preset.value].forEach((x) => perms.add(x));
      boxes();
    };
    boxes();
    const save = () =>
      confirmAction('Сохранить права роли?', row.name + ' · выбрано разрешений ' + perms.size, async () => {
        await post('roles', { role: id, permissions: [...perms], revision: row.revision, confirm: true });
        toast('Права роли обновлены.');
        app.reload();
      });
    detail.replaceChildren(
      panel(
        row.name,
        bar(
          count,
          badge(row.missing ? 'Удалена из Discord' : 'Связь с Discord активна', row.missing ? '' : 'green'),
        ),
        hint(id),
        editing && field('Пресет', preset),
        body,
        editing &&
          bar(
            btn('Сохранить разрешения', save, 'primary'),
            btn('Снять все права', () => {
              perms.clear();
              boxes();
              save();
            }),
          ),
      ),
    );
  }
  function filter() {
    const term = search.value.toLowerCase(),
      rows = pool.filter((x) => x.join(' ').toLowerCase().includes(term));
    choice.replaceChildren(
      ...rows.map(([id, n]) =>
        h('option', { value: id, selected: id === (current || matrix.rows[0]?.id) }, n),
      ),
    );
    draw();
  }
  search.oninput = filter;
  choice.onchange = draw;
  compare.onchange = draw;
  filter();
  return view(
    heading(
      'Роли и права',
      'Права доступа привязаны к ID роли на сервере.',
      app.can('audit.view') &&
        btn('История изменений', () => app.go('audit', { action: 'control.permissions' })),
    ),
    grid(
      panel(
        'Роли Discord',
        field('Поиск', search),
        field('Роль', choice),
        field('Сравнить права с', compare),
        list(matrix.rows, (r) =>
          btn(
            [r.name, badge(r.permissions.length)],
            () => {
              current = r.id;
              search.value = '';
              filter();
            },
            'rowbtn',
          ),
        ),
      ),
      detail,
    ),
  );
}
const settingNames = {
  retentionDays: 'Срок хранения, дней',
  rejectHours: 'Интервал после отказа, часов',
  acceptRole: 'Роль после принятия',
  nickname: 'Обновлять никнейм',
  domains: 'Домены для доказательств',
  timezone: 'Часовой пояс IANA',
  reminders: 'Напоминания, минут',
  excludedVoice: 'Исключённые голосовые каналы',
  autoRole: 'Роль при входе',
  verificationRole: 'Роль верификации',
  minAccountDays: 'Минимальный возраст аккаунта, дней',
  trustedRoles: 'Доверенные роли',
  trustedUsers: 'Доверенные участники',
  bannedWords: 'Фильтр слов',
  blockedDomains: 'Запрещённые домены',
  antiInvite: 'Фильтровать приглашения',
  logContent: 'Сохранять содержимое в журнале',
  securityDelete: 'Удалять нарушения',
  logo: 'URL логотипа',
  banner: 'URL баннера',
  strikeThreshold: 'Порог взысканий',
  welcomeText: 'Приветствие',
  goodbyeText: 'Прощание',
  floodLimit: 'Лимит сообщений',
  mentionLimit: 'Лимит упоминаний',
  raidLimit: 'Порог массового входа',
  removeOnAccept: 'Снимаемые роли',
  attendancePoints: 'Очки посещения',
  trainingPoints: 'Очки тренировки',
  achievementRewards: 'Награды за достижения',
};
async function settings(app) {
  const s = await api('settings'),
    values = structuredClone(s.values),
    nodes = Object.entries(values).map(([k, v]) => {
      const el = Array.isArray(v)
        ? area(k === 'achievementRewards' ? JSON.stringify(v, null, 2) : v.join('\n'))
        : typeof v === 'boolean'
          ? input('', { type: 'checkbox', checked: v })
          : input(v, { type: typeof v === 'number' ? 'number' : 'text' });
      return { k, v, el };
    });
  const save = () => {
    for (const { k, v, el } of nodes) {
      if (k === 'achievementRewards') {
        try {
          values[k] = JSON.parse(el.value);
        } catch {
          throw Error('Проверьте JSON наград.');
        }
      } else if (Array.isArray(v)) {
        const lines = el.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        values[k] = k === 'reminders' ? lines.map(Number) : lines;
      } else
        values[k] = typeof v === 'boolean' ? el.checked : typeof v === 'number' ? Number(el.value) : el.value;
    }
    confirmAction(
      'Сохранить настройки сервера?',
      'Бот начнёт применять новые параметры сразу после сохранения.',
      async () => {
        await post('settings', { values, revision: s.revision, confirm: true });
        toast('Настройки обновлены.');
        app.reload();
      },
    );
  };
  return view(
    heading('Настройки сервера', app.s.guild.name),
    panel(
      null,
      grid(
        ...nodes.map(({ k, v, el }) =>
          field(
            settingNames[k] || k,
            el,
            Array.isArray(v)
              ? k === 'achievementRewards'
                ? 'Массив JSON'
                : 'По одному значению на строку'
              : null,
          ),
        ),
      ),
      btn('Сохранить настройки', save, 'primary'),
    ),
  );
}
export function page(app, key) {
  if (key === 'profile') return profile(app);
  if (key === 'roles') return roles(app);
  return settings(app);
}
