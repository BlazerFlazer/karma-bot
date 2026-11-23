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
  badge,
  hint,
  empty,
  list,
  fmt,
  pages,
  dialog,
  confirmAction,
  link,
  fold,
  tr,
  icon,
} from './ui.js';
export const heading = (name, desc, ...actions) =>
  div('heading', div('', h('h1', {}, name), desc && hint(desc)), bar(...actions));
export const view = (...kids) => div('page', ...kids);
const record = (a, b, c) => div('row', div('result', h('b', {}, a), h('small', {}, b)), c);
const checks = (x, s) => h('label', { class: 'checkline' }, x, s);
function ticketRows(app, rows) {
  return list(
    rows,
    (t) =>
      btn(
        [
          div(
            'result',
            h('b', {}, '#' + t.id + ' · ' + t.title),
            h('small', {}, fmt(t.created) + ' · ' + tr(t.priority)),
          ),
          badge(tr(t.state), t.state === 'open' ? 'green' : ''),
        ],
        () => app.go('inbox', { id: t.id }),
        'rowbtn',
      ),
    'Обращений по этим условиям нет.',
  );
}
const verbs = {
  'ticket.created': 'Создано обращение',
  'ticket.claim': 'Взято в работу',
  'ticket.close': 'Обращение закрыто',
  'application.accepted': 'Заявка одобрена',
  'application.rejected': 'Заявка отклонена',
  'control.draft.save': 'Сохранён черновик',
  'control.draft.share': 'Обновлён доступ к черновику',
  'control.publish.ok': 'Опубликовано в Discord',
  'control.publish.failed': 'Ошибка публикации',
  'control.permissions': 'Изменены права роли',
  'control.config.apply': 'Сохранена конфигурация',
  'control.ticket.create': 'Создано обращение',
  'control.ticket.note': 'Добавлена заметка',
};
export function activity(app, rows) {
  return list(
    rows,
    (x) => {
      const row = record(
        verbs[x.action] || x.action,
        fmt(x.time) + ' · ' + x.actor,
        x.target && badge(x.target),
      );
      if (x.detail && x.detail !== '{}')
        return fold(
          verbs[x.action] || x.action,
          row,
          h('pre', {}, JSON.stringify(JSON.parse(x.detail), null, 2)),
        );
      let route;
      if (/^(ticket\.|application\.|control\.ticket\.)/.test(x.action)) route = ['inbox', { id: x.target }];
      if (/^control\.(draft|publish)\./.test(x.action) && !x.action.endsWith('delete'))
        route = ['publishing', { id: x.target }];
      return route && x.target ? btn(row, () => app.go(...route), 'rowbtn') : row;
    },
    'Доступных действий пока нет.',
  );
}
function chart(rows) {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, n) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + n));
    const day = date.toISOString().slice(0, 10);
    return {
      day,
      count: rows.find((x) => x.day === day)?.count || 0,
      label: date.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' }),
    };
  });
  const top = Math.max(1, ...days.map((x) => x.count));
  return div(
    'chart',
    days.map((x) => {
      const col = h('i', {});
      col.style.height = (96 * x.count) / top + 'px';
      return div('chart-col', h('b', {}, x.count), col, h('small', {}, x.label));
    }),
  );
}
async function overview(app, key) {
  const d = await api(key),
    s = app.s;
  const quick = [
    ['ticket', 'Создать панель'],
    ['embed', 'Создать сообщение'],
    ['recruitment', 'Рассмотреть заявки'],
    ['tiers', 'Создать тир'],
    ['commands', 'Команды'],
  ].filter(([k]) => app.routes().some((r) => r[0] === k) && (k !== 'tiers' || app.can('tiers.configure')));
  const hero = div(
    'hero',
    h(
      'small',
      {},
      s.guild.name +
        ' • ' +
        new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    ),
    h('h1', {}, key === 'analytics' ? 'Аналитика семьи' : 'С возвращением, ' + s.profile.name + '!'),
    h(
      'p',
      {},
      key === 'analytics'
        ? 'Обращения и работа сотрудников за последние семь дней.'
        : 'Рабочее пространство семьи KARMA.',
    ),
    bar(badge(d.bot ? 'Бот на связи' : 'Бот вне сети', d.bot ? 'green' : '')),
  );
  const cells = [
    ['inbox', 'Активные тикеты', d.open],
    ['recruitment', 'Заявки на набор', app.can('recruitment.view') ? d.recruit : null],
    ['events', 'Обзвоны', app.can('recruitment.view') ? d.interviews : null],
    ['tiers', 'Заявки на тир', app.can('tiers.view') ? d.tiers : null],
    ['family', 'Участники семьи', d.members],
    ['events', 'Мероприятия', d.events],
  ];
  const metrics = div(
    'metrics',
    cells
      .filter((x) => x[2] != null)
      .map(([k, l, v]) => div('stat', icon(k), h('b', {}, v), h('span', {}, l))),
  );
  const widgets = {
    overview: panel('Обращения за семь дней', chart(d.days)),
    activity: panel('Последние действия', activity(app, d.feed)),
    assigned: panel('Назначено мне', ticketRows(app, d.assigned)),
  };
  return view(
    hero,
    metrics,
    key === 'overview' &&
      bar(quick.map(([k, n]) => btn(n, () => app.go(k, k === 'tiers' ? { new: 1 } : {})))),
    div(
      'grid',
      (key === 'analytics'
        ? Object.keys(widgets)
        : s.prefs.widgets.filter((k) => !s.prefs.hidden.includes(k))
      ).map((k) => widgets[k]),
    ),
  );
}
async function inbox(app, key, q) {
  if (q.id) {
    const t = await api('ticket', { id: q.id });
    const act = async (action) => {
      const own = action === 'interview',
        mem = ['transfer', 'add', 'remove'].includes(action),
        need =
          mem ||
          ['close', 'reject', 'reply', 'note', 'info', 'hold', 'interview', 'priority'].includes(action);
      const val =
        action === 'priority'
          ? select(
              [
                ['low', 'Низкий'],
                ['normal', 'Обычный'],
                ['high', 'Высокий'],
                ['critical', 'Критический'],
              ],
              t.priority,
            )
          : mem || own
            ? input()
            : area();
      const a = own ? await api('assets') : null,
        voice = own && select(a.channels.filter((c) => [2, 13].includes(c.type)).map((c) => [c.id, c.name]));
      const d = dialog(
        tr(action),
        hint('Обращение #' + t.id + ' · ' + t.title),
        need &&
          field(
            mem
              ? 'Discord ID участника'
              : own
                ? 'Дата с часовым поясом'
                : action === 'priority'
                  ? 'Приоритет'
                  : 'Текст или причина',
            val,
          ),
        own && field('Голосовой канал', voice),
        btn(
          'Подтвердить',
          async () => {
            const res = await post('ticket/action', {
              id: t.id,
              action,
              value: val.value,
              extra: voice?.value,
              confirm: true,
            });
            toast(res.message);
            d.close();
            app.reload();
          },
          'primary',
        ),
      );
    };
    return view(
      heading(
        '#' + t.id + ' · ' + t.title,
        null,
        btn('К списку', () => app.go(key)),
        btn('Обновить', () => app.reload()),
        link('Открыть канал', 'https://discord.com/channels/' + app.s.guild.id + '/' + t.channel),
      ),
      bar(
        badge(tr(t.state), 'green'),
        badge(tr(t.priority)),
        badge('Автор ' + (t.applicant || t.author)),
        badge('Ответственный ' + (t.assignee || 'не назначен')),
      ),
      grid(
        panel(
          'Анкета',
          t.application &&
            badge(t.application.status === 'interview' ? 'Назначен обзвон' : tr(t.application.status)),
          list(t.answers, (x) => record(x.label, x.value)),
          t.family &&
            fold(
              'Профиль участника',
              record(
                t.family.nick,
                'Статик ' + t.family.static + ' · ' + t.family.rank,
                t.family.tier && badge(t.family.tier),
              ),
            ),
          t.related?.length > 0 && fold('Связанные обращения', ticketRows(app, t.related)),
        ),
        panel(
          'Действия сотрудников',
          bar(t.actions.map((k) => btn(tr(k), () => act(k)))),
          t.transcriptUrl && link('Открыть транскрипт', t.transcriptUrl),
        ),
      ),
      grid(
        panel(
          'Переписка',
          t.messageStatus && hint(t.messageStatus),
          list(
            t.messages,
            (m) =>
              div(
                'row',
                div(
                  'result',
                  h('b', {}, m.author + ' · ' + fmt(m.time)),
                  m.text,
                  m.files.map((f) => link(f.name, f.url)),
                ),
              ),
            'Сообщений пока нет.',
          ),
        ),
        div(
          'stack',
          panel(
            'Внутренние заметки',
            list(t.notes, (n) => record(n.body, n.actor + ' · ' + fmt(n.created))),
          ),
          panel('История', activity(app, t.timeline)),
        ),
      ),
    );
  }
  const off = Number(q.offset) || 0,
    params = { ...q, kind: key === 'recruitment' ? 'recruit' : q.kind },
    d = await api('inbox', params);
  const term = input(q.q, { placeholder: 'Номер, автор или категория' }),
    status = select(
      [
        ['', 'Все статусы'],
        ['open', 'Открытые'],
        ['closed', 'Закрытые'],
        ['archived', 'Архив'],
      ],
      q.status,
    ),
    mine = input('', { type: 'checkbox', checked: q.mine === '1' }),
    kind = select(
      [
        ['', 'Все категории'],
        ['support', 'Поддержка'],
        ['recruit', 'Набор'],
        ['tier', 'Тиры'],
        ['report', 'Жалобы'],
      ],
      q.kind,
    );
  const filter = () =>
    app.go(key, { q: term.value, status: status.value, kind: kind.value, mine: mine.checked ? '1' : '0' });
  term.onkeydown = (e) => {
    if (e.key === 'Enter') filter();
  };
  return view(
    heading(
      key === 'recruitment' ? 'Набор в семью' : 'Входящие обращения',
      'Заявки, переписка и работа проверяющих.',
      app.can('tickets.create') && btn('Создать тикет', () => newTicket(app), 'primary'),
    ),
    panel(
      null,
      grid(field('Поиск', term), field('Статус', status)),
      bar(
        key !== 'recruitment' && field('Категория', kind),
        checks(mine, 'Назначено мне'),
        btn('Применить', filter),
      ),
      ticketRows(app, d.items),
      pages(
        d.more && (() => app.go(key, { ...q, offset: off + 25 })),
        off && (() => app.go(key, { ...q, offset: off - 25 })),
      ),
    ),
  );
}
async function newTicket(app) {
  const a = await api('assets'),
    choices = Object.entries(a.types).map(([k, p]) => [k, p.title]),
    type = select(choices),
    user = input('', { placeholder: 'Discord ID' }),
    internal = input('', { type: 'checkbox' }),
    priority = select(
      ['low', 'normal', 'high', 'critical'].map((x) => [x, tr(x)]),
      'normal',
    ),
    box = div('stack');
  let answers;
  async function form() {
    const key = type.value,
      p = a.types[key];
    if (!p) {
      box.replaceChildren(empty('Доступных категорий нет.'));
      return;
    }
    const tiers = p.kind === 'tier' ? await api('ticket/tiers', { type: key }) : null;
    if (type.value !== key) return;
    const tier = tiers && select(tiers.map((x) => [x.key, x.title]));
    function questions() {
      answers = {};
      if (tier) answers.desired = tier;
      box.replaceChildren(
        ...(tier ? [field('Желаемый тир', tier)] : []),
        ...(tier ? tiers.find((x) => x.key === tier.value)?.questions || [] : p.questions)
          .filter((q) => !tier || q.key !== 'desired')
          .map((q) => {
            const el =
              q.input === 'select'
                ? select(q.options)
                : input('', { maxlength: q.max || 500, placeholder: q.placeholder || '' });
            answers[q.key] = el;
            return field(q.label + (q.required ? ' *' : ''), el, q.help);
          }),
      );
    }
    if (tier) tier.onchange = questions;
    questions();
  }
  type.onchange = () => form().catch((e) => toast(e.message, true));
  internal.onchange = () => {
    if (internal.checked) user.value = app.s.profile.id;
  };
  await form();
  const d = dialog(
    'Создать реальный тикет',
    field('Категория', type),
    field('Участник', user),
    checks(internal, 'Внутреннее обращение на моё имя'),
    field('Приоритет', priority),
    box,
    btn(
      'Проверить и создать…',
      () =>
        confirmAction(
          'Создать канал в Discord?',
          a.types[type.value].title + ' · участник ' + user.value,
          async () => {
            const res = await post('ticket/create', {
              user: user.value,
              type: type.value,
              priority: priority.value,
              internal: internal.checked,
              answers: Object.fromEntries(Object.entries(answers).map(([k, el]) => [k, el.value])),
              confirm: true,
            });
            d.close();
            toast('Создано обращение #' + res.id);
            app.go('inbox', { id: res.id });
          },
        ),
      'primary',
    ),
  );
}
async function catalog(app, q) {
  const rows = await api('commands'),
    search = input(q.q || '', { placeholder: 'Команда, категория или право…' }),
    category = select([['', 'Все категории'], ...[...new Set(rows.map((r) => r.category))]]),
    results = div('list');
  function info(x) {
    const favorite = app.s.prefs.commands.includes(x.name);
    const d = dialog(
      x.name,
      hint(x.description),
      bar(
        badge(x.status),
        badge(x.private ? 'Личный ответ' : 'Ответ по сценарию'),
        badge(x.publishes ? 'Может публиковать' : 'Справка / управление'),
      ),
      h('code', {}, x.syntax),
      panel(
        'Аргументы',
        list(x.arguments, (v) => record(v.name + (v.required ? ' *' : ''), v.description)),
      ),
      field('Права и роли', h('span', {}, [x.permission, ...x.roles].join(' · '))),
      panel('Пример', h('code', {}, x.example)),
      x.mistakes.length &&
        fold(
          'Частые ошибки',
          x.mistakes.map((s) => hint(s)),
        ),
      x.related.length &&
        fold(
          'Связанные команды',
          bar(
            x.related.map((n) =>
              btn(n, () => {
                d.close();
                search.value = n;
                filter();
              }),
            ),
          ),
        ),
      btn(favorite ? 'Убрать из избранного' : 'В избранное', async () => {
        const p = app.s.prefs;
        await app.prefs({
          ...p,
          commands: favorite ? p.commands.filter((n) => n !== x.name) : [...p.commands, x.name],
        });
        d.close();
        filter();
      }),
    );
  }
  function filter() {
    const s = search.value.trim().toLowerCase(),
      found = rows.filter(
        (x) =>
          (!category.value || category.value === x.category) &&
          [x.name, x.description, x.category, x.permission, ...x.roles].join(' ').toLowerCase().includes(s),
      );
    found.sort(
      (a, b) => Number(app.s.prefs.commands.includes(b.name)) - Number(app.s.prefs.commands.includes(a.name)),
    );
    results.replaceChildren(
      list(found, (x) =>
        btn(
          [
            div('result', h('code', {}, x.name), h('small', {}, x.description)),
            badge(x.status, x.status === 'Доступна' ? 'green' : ''),
          ],
          () => info(x),
          'rowbtn',
        ),
      ),
    );
  }
  search.oninput = filter;
  category.onchange = filter;
  filter();
  return view(
    heading('Справочник команд', 'Синтаксис, доступ и примеры из реестра KARMA SYSTEM.'),
    panel(null, grid(field('Поиск', search), field('Категория', category)), results),
  );
}
async function records(app, key, q) {
  const off = Number(q.offset) || 0,
    rows = await api(key, q),
    group = { family: 'family', events: 'event', moderation: 'warn' }[key],
    perm = { family: 'family.manage', events: 'events.manage', moderation: 'moderation.manage' }[key],
    ops = app.can(perm) ? (await api('operations')).filter((x) => x.command === group) : [];
  const search = input(q.q || '', { placeholder: 'Ник, статик или Discord ID' });
  search.onkeydown = (e) => {
    if (e.key === 'Enter') app.go(key, { q: search.value });
  };
  return view(
    heading({ family: 'Состав семьи', events: 'Мероприятия', moderation: 'Журнал модерации' }[key]),
    ops.length && bar(ops.map((o) => btn(o.title, () => operation(app, o)))),
    panel(
      null,
      key === 'family' &&
        bar(
          field('Поиск участника', search),
          btn('Найти', () => app.go(key, { q: search.value })),
        ),
      list(rows.slice(0, 25), (x) =>
        key === 'family'
          ? record(x.nick, x.user + ' · статик ' + x.static, bar(badge(x.rank), x.tier && badge(x.tier)))
          : key === 'events'
            ? record(x.title, fmt(x.start) + ' · #' + x.id, badge(tr(x.state)))
            : record(x.action + ' · ' + x.user, x.reason + ' · ' + fmt(x.created), badge('#' + x.id)),
      ),
      pages(
        rows.length > 25 && (() => app.go(key, { ...q, offset: off + 25 })),
        off && (() => app.go(key, { ...q, offset: off - 25 })),
      ),
    ),
  );
}
async function operation(app, o) {
  const a = o.command === 'warn' ? await api('assets') : null,
    channel = a && select(a.channels.filter((c) => c.type === 0).map((c) => [c.id, c.name]));
  const controls = o.options.map((x) => {
    const el = x.choices
      ? select([['', 'Выбрать…'], ...x.choices.map((c) => [c.value, c.name])])
      : x.type === 5
        ? input('', { type: 'checkbox' })
        : input('', { type: x.type === 4 ? 'number' : 'text', min: x.min_value, max: x.max_value });
    return { x, el };
  });
  const d = dialog(
    o.title,
    controls.map(({ x, el }) =>
      field(x.description + (x.required ? ' *' : ''), el, [6, 8].includes(x.type) ? 'Discord ID' : null),
    ),
    channel && field('Канал модерации', channel),
    btn(
      'Проверить действие…',
      () =>
        confirmAction(o.title, 'Изменения будут применены к серверу ' + app.s.guild.name + '.', async () => {
          const values = {};
          for (const { x, el } of controls) {
            if (el.type === 'checkbox') values[x.name] = el.checked;
            else if (el.value) values[x.name] = x.type === 4 ? Number(el.value) : el.value;
          }
          const res = await post('operation', {
            command: o.command,
            action: o.action,
            values,
            channel: channel?.value,
            confirm: true,
          });
          d.close();
          toast(res.message);
          app.reload();
        }),
      'primary',
    ),
  );
}
export async function page(app, key, q) {
  if (['analytics', 'overview'].includes(key)) return overview(app, key);
  if (['inbox', 'recruitment'].includes(key)) return inbox(app, key, q);
  if (key === 'commands') return catalog(app, q);
  if (key === 'help') {
    const guides = await api('help');
    return view(
      heading('Руководство', 'Практические инструкции для сотрудников KARMA.'),
      div(
        'grid',
        guides.map((g) =>
          panel(
            g.title,
            hint(g.intro),
            fold(
              'Открыть инструкцию',
              h(
                'ol',
                {},
                g.steps.map((s) => h('li', {}, s)),
              ),
              bar(g.commands.map((n) => btn(n, () => app.go('commands', { q: n })))),
            ),
          ),
        ),
      ),
    );
  }
  if (['family', 'events', 'moderation'].includes(key)) return records(app, key, q);
  if (['notifications', 'audit'].includes(key)) {
    const d = await api(key, q),
      off = Number(q.offset) || 0;
    return view(
      heading(key === 'audit' ? 'Журнал действий' : 'Уведомления'),
      panel(
        null,
        key === 'notifications' &&
          d.items.some((x) => !x.seen) &&
          btn('Отметить страницу прочитанной', async () => {
            await post('notifications/read', { ids: d.items.map((x) => x.id), offset: off });
            app.reload();
          }),
        key === 'notifications'
          ? list(d.items, (x) =>
              div('stack', badge(x.seen ? 'Прочитано' : 'Новое', x.seen ? '' : 'green'), activity(app, [x])),
            )
          : activity(app, d.items),
        pages(
          d.more && (() => app.go(key, { offset: off + 25 })),
          off && (() => app.go(key, { offset: off - 25 })),
        ),
      ),
    );
  }
  return (await import('./administration.js')).page(app, key, q);
}
