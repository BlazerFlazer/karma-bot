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
  pages,
  dialog,
  confirmAction,
  link,
  fold,
  tr,
} from './ui.js';
import { view, heading } from './workspace.js';
import { message, simulator } from './preview.js';
const route = { ticket: 'ticket', tier: 'tiers', embed: 'embed' },
  publishPerm = { ticket: 'tickets.publish', tier: 'tiers.publish', embed: 'embeds.publish' };
const states = ['personal', 'shared', 'ready', 'published', 'archived'];
const actions = [
  'claim',
  'unclaim',
  'transfer',
  'add',
  'remove',
  'rename',
  'close',
  'reopen',
  'archive',
  'priority',
  'escalate',
  'transcript',
  'accept',
  'reject',
  'info',
  'hold',
  'interview',
  'proof',
];
async function publish(app, d, assets) {
  const ch = select([
      ['', 'Выберите канал'],
      ...assets.channels.filter((c) => c.type === 0 && c.send).map((c) => [c.id, '# ' + c.name]),
    ]),
    holder = div('stack'),
    modal = dialog('Публикация в Discord', field('Текстовый канал', ch), holder);
  const prepare = () => {
    holder.replaceChildren(
      btn('Итоговый предпросмотр', async () => {
        const x = await post('publish/preview', { id: d.id, version: d.version, channel: ch.value });
        holder.replaceChildren(
          hint((x.update ? 'Обновление существующего сообщения' : 'Новое сообщение') + ' в #' + x.channel),
          message(x.payload, false, assets.bot),
          btn(
            x.update ? 'Подтвердить обновление' : 'Подтвердить публикацию',
            async () => {
              const res = await post('publish/confirm', { id: d.id, token: x.token, confirm: true });
              modal.close();
              dialog('Опубликовано', link('Открыть сообщение в Discord', res.url));
              app.reload();
            },
            'primary',
          ),
        );
      }),
    );
  };
  ch.onchange = prepare;
  prepare();
}
async function publishing(app, q) {
  if (q.id) {
    const d = await api('draft', { id: q.id });
    return editor(app, d.kind, { id: q.id }, d);
  }
  const off = Number(q.offset) || 0,
    rows = await api('drafts', { offset: off }),
    status = select([['', 'Все состояния'], ...states.map((x) => [x, tr(x)])], q.state),
    term = input(q.q || '', { placeholder: 'Название черновика' }),
    body = div('stack');
  function draw() {
    const found = rows.filter(
      (x) =>
        (!status.value || x.state === status.value) &&
        x.title.toLowerCase().includes(term.value.toLowerCase()),
    );
    body.replaceChildren(
      list(
        found,
        (d) =>
          div(
            'row',
            div(
              'result',
              h('b', {}, d.title),
              h('small', {}, tr(d.kind) + ' · ' + fmt(d.updated) + ' · автор ' + d.owner),
              d.message &&
                link(
                  '#' + d.channel + ' · ' + d.message,
                  'https://discord.com/channels/' + app.s.guild.id + '/' + d.channel + '/' + d.message,
                ),
            ),
            bar(
              badge(tr(d.state)),
              btn('Открыть', () => app.go(route[d.kind], { id: d.id })),
            ),
          ),
        'В этой выборке нет черновиков.',
      ),
    );
  }
  status.onchange = draw;
  term.oninput = draw;
  draw();
  return view(
    heading('Центр публикаций', 'Ваши черновики, общие материалы и опубликованные панели.'),
    panel(
      null,
      grid(field('Поиск на странице', term), field('Состояние', status)),
      body,
      pages(
        rows.length === 25 && (() => app.go('publishing', { offset: off + 25 })),
        off && (() => app.go('publishing', { offset: off - 25 })),
      ),
    ),
  );
}
async function board(app, q) {
  const rows = await api('tiers'),
    edit = app.can('tiers.configure');
  let drag;
  function order(x, to) {
    return confirmAction('Изменить порядок тиров?', x.config.title + ' → позиция ' + (to + 1), async () => {
      await post('tiers', { key: x.key, revision: x.revision, action: 'reorder', to, confirm: true });
      app.reload();
    });
  }
  return view(
    heading(
      'Студия тиров',
      'Порядок, требования и роли участников.',
      edit && btn('Создать тир', () => app.go('tiers', { new: 1 }), 'primary'),
    ),
    rows.length
      ? div(
          'tiercards',
          rows.map((x, i) => {
            const card = h(
              'article',
              { class: 'tiercard', draggable: edit ? 'true' : null },
              bar(badge('Позиция ' + (i + 1)), badge(x.key)),
              h('h2', {}, x.config.title),
              hint(x.config.description),
              h('p', {}, x.config.requirements),
              badge(x.roleName || 'Роль недоступна', x.roleName ? 'green' : ''),
              edit &&
                bar(
                  btn('Редактировать', () => app.go('tiers', { key: x.key })),
                  i > 0 && btn('↑', () => order(x, i - 1)),
                  i < rows.length - 1 && btn('↓', () => order(x, i + 1)),
                  btn('Удалить', () =>
                    confirmAction('Удалить тир?', x.config.title + ' · ' + x.key, async () => {
                      await post('tiers', {
                        key: x.key,
                        revision: x.revision,
                        action: 'delete',
                        confirm: true,
                      });
                      app.reload();
                    }),
                  ),
                ),
            );
            if (edit) {
              card.ondragstart = () => (drag = x);
              card.ondragover = (e) => e.preventDefault();
              card.ondrop = (e) => {
                e.preventDefault();
                if (drag && drag !== x) order(drag, i);
                drag = null;
              };
            }
            return card;
          }),
        )
      : empty('Тиров пока нет. Новый тир можно сохранить без публикации.'),
  );
}
function entries(items, seed, draw, change, max, label) {
  const holder = div('stack');
  let dragged;
  function show() {
    holder.replaceChildren(
      ...items.map((x, i) => {
        const move = (j) => {
          items.splice(j, 0, items.splice(i, 1)[0]);
          show();
          change();
        };
        const grab = h('span', { draggable: 'true', class: 'badge', title: 'Перетащить' }, '⠿ ' + (i + 1));
        grab.ondragstart = () => (dragged = i);
        const node = div(
          'panel',
          bar(
            grab,
            i > 0 && btn('↑', () => move(i - 1)),
            i + 1 < items.length && btn('↓', () => move(i + 1)),
            btn('Убрать', () => {
              items.splice(i, 1);
              show();
              change();
            }),
          ),
          draw(x),
        );
        node.ondragover = (e) => e.preventDefault();
        node.ondrop = (e) => {
          e.preventDefault();
          if (Number.isInteger(dragged)) {
            items.splice(i, 0, items.splice(dragged, 1)[0]);
            show();
            change();
            dragged = null;
          }
        };
        return node;
      }),
      items.length < max &&
        btn(label, () => {
          items.push(seed());
          show();
          change();
        }),
    );
  }
  show();
  return holder;
}
async function editor(app, kind, q, loaded) {
  let [assets, d] = await Promise.all([api('assets'), loaded || (q.id ? api('draft', { id: q.id }) : null)]);
  if (d && d.kind !== kind) throw Error('Выберите студию соответствующего типа.');
  const source = q.key ? await api('config', { kind, key: q.key }) : null;
  const revisions = new Map(Object.entries(assets.typeRevisions || {}));
  if (source) revisions.set(source.key, source.revision);
  let fresh = q.key
    ? source.config
    : kind === 'embed' && q.template
      ? assets.templates.find((t) => t.name === q.template)?.config
      : null;
  const config = structuredClone(
      fresh ||
        (kind === 'tier' ? assets.tier : kind === 'ticket' ? assets.types[q.template || 'support'] : null),
    ),
    base = structuredClone(kind === 'tier' ? assets.tierPolicy : null);
  const b = structuredClone(
    d?.body || {
      key: q.key || (kind === 'ticket' ? 'support' : kind === 'tier' ? 'tier1' : 'Объявление'),
      config,
      appearance: {
        ...assets.embed,
        ...(kind === 'embed'
          ? fresh || {}
          : { title: config.title, description: config.description || config.requirements || config.title }),
        color: fresh?.color || '#7956db',
      },
      layout: 'embed',
      menu: [],
      buttonLabel: 'Заполнить заявку',
    },
  );
  if (b.separator === undefined) b.separator = true;
  let c = b.config,
    e = b.appearance;
  const title = input(d?.title || e.title, { maxlength: 100 }),
    forms = div('stack'),
    preview = div('stack'),
    feedback = h('p', { class: 'hint', 'aria-live': 'polite' }),
    state = div('bar'),
    foot = div('bar'),
    mobile = select([
      ['desktop', 'Discord · компьютер'],
      ['mobile', 'Discord · телефон'],
    ]),
    role = select([
      ['applicant', 'Заявитель'],
      ['recruit', 'Сотрудник набора'],
      ['leader', 'Руководитель'],
    ]);
  let payload,
    sequence = 0,
    timer,
    dirty = !d,
    tab = 'message';
  function update() {
    const seq = ++sequence;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const p = await post('preview', { kind, body: b });
        if (seq !== sequence || !preview.isConnected) return;
        payload = p;
        preview.replaceChildren(message(p, mobile.value === 'mobile', assets.bot));
        feedback.textContent = 'Предпросмотр проверен · ' + e.description.length + ' / 4096';
      } catch (err) {
        if (seq !== sequence) return;
        payload = null;
        feedback.textContent = err.message;
        preview.replaceChildren(empty('Исправьте параметры сообщения для предпросмотра.'));
      }
    }, 360);
  }
  function changed() {
    dirty = true;
    buttons();
    update();
  }
  title.oninput = changed;
  mobile.onchange = update;
  const bind = (name, obj, key, opts = {}) => {
    const val = obj[key],
      el = opts.choices
        ? select(opts.choices, val)
        : opts.bool
          ? input('', { type: 'checkbox', checked: val })
          : opts.long
            ? area(val || '', { maxlength: opts.max })
            : input(val ?? '', {
                type: opts.type || 'text',
                maxlength: opts.max,
                min: opts.min,
                max: opts.limit,
              });
    const set = () => {
      obj[key] = opts.bool ? el.checked : opts.type === 'number' ? Number(el.value) : el.value;
      changed();
    };
    el.addEventListener(opts.choices || opts.bool ? 'change' : 'input', set);
    return field(name, el, opts.help);
  };
  const many = (name, obj, k, choices, values = obj[k] || []) => {
    const options = new Map([...values.map((x) => [x, x]), ...choices]),
      m = multi([...options], values);
    m.onchange = () => {
      obj[k] = selected(m);
      changed();
    };
    return field(name, m);
  };
  const roleList = assets.roles.map((r) => [r.id, r.name]),
    access = [
      ...Object.entries(assets.bindings).map(([k, id]) => [
        k,
        (assets.roles.find((r) => r.id === id)?.name || k) + ' · ' + k,
      ]),
      ...roleList,
    ];
  function richText() {
    const desc = area(e.description, { maxlength: 4096 }),
      tools = bar();
    desc.oninput = () => {
      e.description = desc.value;
      changed();
    };
    for (const [name, op, end = op] of [
      ['Ж', '**'],
      ['К', '*'],
      ['Подчеркнуть', '__'],
      ['Зачеркнуть', '~~'],
      ['Код', '`'],
      ['Цитата', '> ', ''],
      ['Список', '- ', ''],
      ['Спойлер', '||'],
      ['Блок кода', '```\n', '\n```'],
      ['Заголовок', '## ', ''],
      ['Упоминание', '<@', '>'],
      ['Эмодзи', '✨', ''],
      ['Эмодзи сервера', '<:', '>'],
      ['Символ', '◆', ''],
      ['Ссылка', '[', '](https://)'],
    ])
      tools.append(
        btn(name, () => {
          const a = desc.selectionStart,
            z = desc.selectionEnd;
          desc.setRangeText(op + desc.value.slice(a, z) + end, a, z, 'end');
          desc.focus();
          desc.oninput();
        }),
      );
    const vars = select([
      ['', 'Вставить переменную'],
      ...['user', 'username', 'server', 'member_count', 'ticket_id', 'date', 'family_name'].map((k) => [
        '{' + k + '}',
        '{' + k + '}',
      ]),
    ]);
    vars.onchange = () => {
      desc.setRangeText(vars.value, desc.selectionStart, desc.selectionEnd, 'end');
      vars.value = '';
      desc.oninput();
    };
    return div('stack', tools, field('Описание', desc), vars);
  }
  function appearance() {
    return [
      grid(bind('Заголовок', e, 'title', { max: 256 }), bind('Цвет', e, 'color', { type: 'color' })),
      richText(),
      fold(
        'Ссылки и оформление',
        bind('Ссылка заголовка', e, 'url'),
        bind('Автор', e, 'author', { max: 256 }),
        bind('Миниатюра · HTTPS', e, 'thumbnail'),
        bind('Баннер · HTTPS', e, 'banner'),
        bind('Нижняя подпись', e, 'footer'),
        bind('Время отправки', e, 'timestamp', { bool: true }),
      ),
      bind('Макет Discord', b, 'layout', {
        choices: [
          ['embed', 'Embed'],
          ['v2', 'Components V2'],
        ],
      }),
      bind('Разделитель в Components V2', b, 'separator', { bool: true }),
      fold(
        'Файл в Components V2',
        bind('Имя текстового файла', b, 'fileName', { help: 'Например, rules.txt' }),
        bind('Содержимое файла', b, 'fileText', { long: true, max: 8000 }),
      ),
      fold(
        'Поля сообщения',
        entries(
          e.fields,
          () => ({ name: 'Поле', value: 'Значение', inline: false }),
          (x) =>
            div(
              'stack',
              bind('Название', x, 'name', { max: 256 }),
              bind('Значение', x, 'value', { long: true, max: 1024 }),
              bind('В одну строку', x, 'inline', { bool: true }),
            ),
          changed,
          25,
          'Добавить поле',
        ),
      ),
      fold(
        'Кнопки и меню',
        kind !== 'embed' && bind('Текст кнопки заявки', b, 'buttonLabel', { max: 80 }),
        entries(
          e.buttons,
          () => ({ label: 'Подробнее', url: '' }),
          (x) => grid(bind('Кнопка', x, 'label', { max: 80 }), bind('Ссылка HTTPS', x, 'url')),
          changed,
          5,
          'Добавить ссылку',
        ),
        entries(
          (b.menu ||= []),
          () => ({ label: 'Пункт', value: kind === 'ticket' ? b.key : '' }),
          (x) =>
            grid(
              bind('Название пункта', x, 'label'),
              bind(
                kind === 'ticket' ? 'Тип обращения' : 'Ответ в Discord',
                x,
                'value',
                kind === 'ticket'
                  ? { choices: Object.entries(assets.types).map(([k, p]) => [k, p.title]) }
                  : {},
              ),
            ),
          changed,
          25,
          'Добавить пункт меню',
        ),
      ),
    ];
  }
  function questions() {
    const qs = (c.questions ||= structuredClone(base?.questions || []));
    return entries(
      qs,
      () => ({
        key: 'question_' + crypto.randomUUID().slice(0, 6),
        label: 'Новый вопрос',
        required: true,
        input: 'short',
      }),
      (x) =>
        div(
          'stack',
          grid(bind('Ключ ответа', x, 'key'), bind('Текст вопроса', x, 'label', { max: 45 })),
          grid(
            bind('Формат', x, 'input', {
              choices: [
                ['', 'По умолчанию'],
                ['short', 'Короткий текст'],
                ['long', 'Длинный текст'],
                ['select', 'Варианты'],
                ['user', 'Участник Discord'],
                ['role', 'Роль Discord'],
                ['channel', 'Канал Discord'],
              ],
            }),
            bind('Проверка', x, 'validation', {
              choices: [
                ['', 'Без дополнительной проверки'],
                ['digits', 'Цифры'],
                ['url', 'HTTPS-ссылка'],
              ],
            }),
          ),
          bind('Обязательный ответ', x, 'required', { bool: true }),
          bind('Подсказка', x, 'help', { max: 100 }),
          bind('Пример ответа', x, 'placeholder', { max: 100 }),
          bind('Лимит символов', x, 'max', { type: 'number', min: 1, limit: 500 }),
          lines('Варианты ответа', x, 'options'),
        ),
      changed,
      20,
      'Добавить вопрос',
    );
  }
  function lines(name, obj, key) {
    const el = area((obj[key] || []).join('\n'));
    el.oninput = () => {
      obj[key] = el.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      changed();
    };
    return field(name, el, 'По одному значению на строку');
  }
  function policy() {
    if (kind === 'tier')
      return [
        bind('Название тира', c, 'title'),
        bind('Описание', c, 'description', { long: true }),
        bind('Требования', c, 'requirements', { long: true }),
        bind('Выдаваемая роль Discord', c, 'role', { choices: [['', 'Выберите роль'], ...roleList] }),
        many('Проверяющие', c, 'reviewers', access),
        grid(
          bind('Порядок', c, 'order', { type: 'number' }),
          bind('Интервал подачи, секунд', c, 'cooldown', { type: 'number' }),
        ),
        lines('Разрешённые домены доказательств', c, 'domains'),
        fold('Анкета тира', questions()),
      ];
    const channelChoices = (k, type) => [
      [c[k], c[k]],
      ...assets.channels.filter((x) => x.type === type).map((x) => [x.id, '# ' + x.name]),
    ];
    return [
      grid(bind('Название категории', c, 'title'), bind('Эмодзи', c, 'emoji')),
      bind('Описание категории', c, 'description'),
      bind('Приветствие в канале', c, 'welcome', { long: true }),
      grid(
        bind('Режим', c, 'mode', {
          choices: [
            ['channel', 'Приватный канал'],
            ['thread', 'Приватная ветка'],
          ],
        }),
        bind('Приоритет', c, 'priority', {
          choices: ['low', 'normal', 'high', 'critical'].map((k) => [k, tr(k)]),
        }),
      ),
      bind('Категория сервера', c, 'category', { choices: channelChoices('category', 4) }),
      bind('Родительский канал ветки', c, 'parent', { choices: channelChoices('parent', 0) }),
      bind('Канал журнала', c, 'log', { choices: channelChoices('log', 0) }),
      many('Роли проверяющих', c, 'access', access),
      many('Кто может подать заявку · пусто для всех', c, 'allowed', access),
      grid(
        bind('Лимит открытых обращений', c, 'limit', { type: 'number' }),
        bind('Интервал подачи, секунд', c, 'cooldown', { type: 'number' }),
      ),
      bind('Автозакрытие, часов', c, 'autoClose', { type: 'number' }),
      bind('Шаблон имени канала', c, 'naming', {
        help: 'Например, ticket-{id}. Оставьте пустым для стандартного имени.',
      }),
      many(
        'Действия сотрудников',
        c,
        'staffActions',
        actions.map((k) => [k, tr(k)]),
        c.staffActions || actions,
      ),
      fold('Вопросы анкеты', questions()),
    ];
  }
  function library() {
    const search = input('', { placeholder: 'Найти шаблон…' }),
      items = div('list');
    const refresh = () => {
      const term = search.value.toLowerCase();
      let rows =
        kind === 'ticket'
          ? Object.entries(assets.types).map(([key, p]) => ({
              name: p.title,
              choose: () => {
                b.key = key;
                c = b.config = structuredClone(p);
                e.title = p.title;
                e.description = p.description;
                title.value = p.title;
              },
            }))
          : assets.templates.map((t) => ({
              name: t.name,
              choose: () => {
                e = b.appearance = structuredClone(t.config);
                title.value = t.name;
              },
            }));
      if (kind === 'embed')
        rows.push(
          ...assets.savedEmbeds.map((key) => ({
            name: key + ' · сохранённый',
            choose: async () => {
              const record = await api('config', { kind, key });
              revisions.set(key, record.revision);
              e = b.appearance = record.config;
              b.key = key;
              title.value = key;
            },
          })),
        );
      items.replaceChildren(
        list(
          rows.filter((x) => x.name.toLowerCase().includes(term)),
          (x) =>
            btn(
              x.name,
              async () => {
                await x.choose();
                tab = 'message';
                draw();
                changed();
              },
              'rowbtn',
            ),
        ),
      );
    };
    search.oninput = refresh;
    refresh();
    return [search, items];
  }
  function draw() {
    const tabs = bar(
      ...[
        ['message', 'Сообщение'],
        ...(kind === 'embed' ? [] : [['config', 'Конфигурация']]),
        ['templates', 'Шаблоны'],
      ].map(([id, n]) =>
        btn(
          n,
          () => {
            tab = id;
            draw();
          },
          id === tab ? 'primary' : '',
        ),
      ),
    );
    forms.replaceChildren(
      panel(
        null,
        field('Название черновика', title),
        bind(kind === 'embed' ? 'Имя шаблона' : 'Код записи', b, 'key', {
          help:
            kind === 'embed'
              ? null
              : 'Придумайте короткий код, например tier1. Для изменения используйте код существующей записи.',
        }),
        tabs,
        ...(tab === 'templates' ? library() : tab === 'message' ? appearance() : policy()),
      ),
    );
  }
  async function save() {
    if (c?.naming === '') delete c.naming;
    d = await post('draft', {
      id: d?.id,
      version: d?.version,
      kind,
      title: title.value,
      body: b,
      base: revisions.get(b.key) || assets.emptyRevision,
    });
    dirty = false;
    history.replaceState(null, '', '#' + route[kind] + '?id=' + encodeURIComponent(d.id));
    buttons();
    toast('Черновик сохранён.');
  }
  async function change(action, roles) {
    const res = await post('draft/state', { id: d.id, version: d.version, action, roles, confirm: true });
    if (action === 'delete') return app.go('publishing');
    if (action === 'duplicate') return app.go(route[kind], { id: res.id });
    d = res;
    buttons();
    toast('Состояние обновлено.');
  }
  function buttons() {
    const editable =
        !d || (d.state !== 'archived' && (d.owner === app.s.profile.id || app.can('drafts.share'))),
      saved = d && !dirty;
    for (const control of forms.querySelectorAll('input,select,textarea')) control.disabled = !editable;
    state.replaceChildren(
      badge(d ? tr(d.state) : 'Новый личный черновик'),
      badge(dirty ? 'Есть изменения' : 'Версия ' + d.version),
    );
    const items = [editable && btn('Сохранить черновик', save, 'primary')];
    if (saved) {
      items.push(
        editable &&
          btn('Сохранить настройки', () =>
            confirmAction('Применить конфигурацию в боте?', b.key + ' · ' + title.value, async () => {
              d = await post('draft/apply', { id: d.id, version: d.version, confirm: true });
              buttons();
              toast('Настройки сохранены в KARMA SYSTEM.');
            }),
          ),
        editable &&
          !['ready', 'published'].includes(d.state) &&
          btn('Подготовить к публикации', () => change('ready')),
        ['ready', 'published'].includes(d.state) &&
          app.can(publishPerm[kind]) &&
          btn('Опубликовать в Discord', () => publish(app, d, assets), 'primary'),
        btn('Создать копию', () => change('duplicate')),
      );
      if (d.owner === app.s.profile.id) {
        if (app.can('drafts.share') && d.state !== 'archived')
          items.push(
            btn('Общий доступ', () => {
              const roles = multi(roleList, d.shared),
                modal = dialog(
                  'Доступ сотрудников',
                  field('Роли редакции', roles),
                  btn('Подтвердить доступ', async () => {
                    await change('share', selected(roles));
                    modal.close();
                  }),
                );
            }),
          );
        items.push(
          d.state !== 'archived' &&
            btn('В архив', () => confirmAction('Архивировать черновик?', d.title, () => change('archive'))),
          btn('Удалить', () => confirmAction('Удалить черновик?', d.title, () => change('delete'))),
        );
      }
    }
    foot.replaceChildren(...items.filter(Boolean));
  }
  const previewPane = div(
    'preview-pane stack',
    panel(
      'Предпросмотр Discord',
      bar(mobile, kind !== 'embed' && role),
      preview,
      feedback,
      kind !== 'embed' &&
        btn('Запустить симулятор', () => {
          if (!payload) throw Error('Дождитесь корректного предпросмотра.');
          simulator(b, kind, payload, base, assets.bot, role.value);
        }),
    ),
  );
  const libraryPane = panel('Элементы');
  libraryPane.classList.add('elements');
  const studio = div('editor', libraryPane, forms, previewPane);
  studio.dataset.pane = 'form';
  forms.classList.add('studio-form');
  const swap = (target) => {
    studio.dataset.pane = target;
  };
  const jump = (next, label) => {
    tab = next;
    draw();
    swap('form');
    const node = [...forms.querySelectorAll('summary,.field>span')].find((e) => e.textContent === label);
    if (node) {
      for (const p of forms.querySelectorAll('details')) if (p.contains(node)) p.open = true;
      node.scrollIntoView({ block: 'nearest' });
      node.parentElement.querySelector('input,textarea,select')?.focus({ preventScroll: true });
    }
  };
  libraryPane.append(
    ...[
      ['Сообщение', 'message', 'Заголовок'],
      ['Текст и Markdown', 'message', 'Описание'],
      ['Миниатюра и баннер', 'message', 'Ссылки и оформление'],
      ['Поля', 'message', 'Поля сообщения'],
      ['Кнопки и меню', 'message', 'Кнопки и меню'],
      ['Файл', 'message', 'Файл в Components V2'],
      ...(kind === 'embed' ? [] : [['Анкета', 'config', kind === 'tier' ? 'Анкета тира' : 'Вопросы анкеты']]),
      ['Шаблоны', 'templates', ''],
    ].map(([n, t, l]) => btn(n, () => jump(t, l), 'rowbtn')),
  );
  const switches = div(
    'pane-switch',
    btn('Элементы', () => swap('library')),
    btn('Редактор', () => swap('form')),
    btn('Предпросмотр', () => swap('preview')),
  );
  draw();
  buttons();
  update();
  return view(
    heading(
      { ticket: 'Студия тикетов', tier: 'Редактор тира', embed: 'Студия сообщений' }[kind],
      null,
      btn('Мои черновики', () => app.go('publishing')),
      btn('Руководство', () => app.go('help')),
    ),
    state,
    switches,
    studio,
    foot,
  );
}
export async function page(app, key, q) {
  if (key === 'publishing') return publishing(app, q);
  if (key === 'tiers' && !q.id && !q.new && !q.key && app.can('tiers.view')) return board(app, q);
  return editor(app, key === 'tiers' ? 'tier' : key, q);
}
