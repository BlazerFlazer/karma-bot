import { h, div, bar, btn, badge, hint, field, input, area, select, dialog, link, tr } from './ui.js';
function inline(s = '') {
  const parts = String(s).split(
    /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/g,
  );
  return parts.map((t) => {
    for (const [del, tag] of [
      ['**', 'strong'],
      ['__', 'u'],
      ['~~', 's'],
      ['*', 'em'],
      ['`', 'code'],
    ])
      if (t.startsWith(del) && t.endsWith(del) && t.length > 2 * del.length)
        return h(tag, {}, t.slice(del.length, -del.length));
    const m = /^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/.exec(t);
    return m ? link(m[1], m[2]) : t;
  });
}
function rich(s = '') {
  const blocks = String(s).split(/(```[\s\S]*?```)/g);
  return blocks.flatMap((block) => {
    if (block.startsWith('```') && block.endsWith('```'))
      return h('pre', {}, h('code', {}, block.slice(3, -3).replace(/^[a-z0-9_-]*\n/i, '')));
    return block.split('\n').flatMap((line, i) => {
      let n;
      if (/^#{1,3} /.test(line)) n = h('strong', {}, inline(line.replace(/^#{1,3} /, '')));
      else if (line.startsWith('> ')) n = h('blockquote', {}, inline(line.slice(2)));
      else if (/^[-*] /.test(line)) n = ['• ', ...inline(line.slice(2))];
      else
        n = line
          .split(/(\|\|[^|]+\|\||<@!?\d{17,20}>|<a?:\w+:\d{17,20}>)/g)
          .flatMap((s) =>
            s.startsWith('||') && s.endsWith('||')
              ? h('span', { class: 'spoiler', tabindex: 0 }, inline(s.slice(2, -2)))
              : /^<@!?\d+>$/.test(s)
                ? h('span', { class: 'mention' }, '@' + s.replace(/\D/g, ''))
                : /^<a?:\w+:\d+>$/.test(s)
                  ? h('img', {
                      src:
                        'https://cdn.discordapp.com/emojis/' +
                        s.match(/\d+>$/)[0].slice(0, -1) +
                        (s.startsWith('<a:') ? '.gif' : '.png'),
                      width: 20,
                      height: 20,
                      alt: s.split(':')[1],
                    })
                  : inline(s),
          );
      return [i ? '\n' : '', n];
    });
  });
}
const pic = (url, cls) =>
  url && h('img', { src: url, loading: 'lazy', referrerpolicy: 'no-referrer', alt: '', class: cls });
function components(items = []) {
  return items.map((c) => {
    if (c.type === 1) return div('', components(c.components));
    if (c.type === 2) return c.url ? link(c.label + ' ↗', c.url) : h('span', { class: 'dc-act' }, c.label);
    if (c.type === 3)
      return h(
        'details',
        { class: 'dc-act dc-select' },
        h('summary', {}, c.placeholder || 'Выбрать'),
        c.options.map((o) => h('p', {}, o.label)),
      );
    if (c.type === 17) {
      const block = div('dc-body', components(c.components));
      block.style.borderColor =
        '#' +
        Number(c.accent_color || 0)
          .toString(16)
          .padStart(6, '0');
      return block;
    }
    if (c.type === 9) return div('', pic(c.accessory?.media?.url, 'thumb'), components(c.components));
    if (c.type === 10) return h('p', {}, rich(c.content));
    if (c.type === 14) return h('hr');
    if (c.type === 12)
      return div(
        '',
        c.items.map((i) => pic(i.media.url, 'banner')),
      );
    if (c.type === 13) return div('dc-act', '📎 ' + (c.file?.url || '').replace('attachment://', ''));
    return null;
  });
}
export function message(p, mobile = false, bot = {}) {
  const e = p.embeds?.[0];
  let embed;
  if (e) {
    embed = div(
      'dc-body',
      pic(e.thumbnail?.url, 'thumb'),
      e.author && h('small', {}, e.author.name),
      e.title && (e.url ? link(e.title, e.url) : h('h3', {}, e.title)),
      e.description && h('p', {}, rich(e.description)),
      div(
        'dc-fields',
        (e.fields || []).map((f) =>
          div(f.inline ? 'inline' : '', h('strong', {}, rich(f.name)), h('p', {}, rich(f.value))),
        ),
      ),
      pic(e.image?.url, 'banner'),
      (e.footer || e.timestamp) &&
        h(
          'small',
          {},
          [e.footer?.text, e.timestamp && new Date(e.timestamp).toLocaleString('ru-RU')]
            .filter(Boolean)
            .join(' · '),
        ),
    );
    embed.style.borderColor =
      '#' +
      Number(e.color || 0)
        .toString(16)
        .padStart(6, '0');
  }
  return div(
    'discord' + (mobile ? ' mobileview' : ''),
    div(
      'discord-head',
      h('img', { src: bot.avatar || '/art/mark.svg', alt: '' }),
      h('strong', {}, bot.name || 'KARMA SYSTEM'),
      h('em', {}, 'APP'),
    ),
    embed,
    components(p.components),
  );
}
export function simulator(b, kind, payload, base, bot, role = 'applicant') {
  const d = dialog('Симулятор обращения'),
    box = d.querySelector('.dialog-body'),
    p = kind === 'tier' ? { ...base, questions: b.config.questions || base.questions } : b.config,
    answers = {},
    actions = p.staffActions || ['claim', 'priority', 'close', 'info', 'accept', 'reject', 'interview'];
  let offset = 0,
    claimed = false,
    priority = p.priority || 'normal',
    review = '',
    participant = '';
  const display = (...items) => box.replaceChildren(badge('Локальная симуляция'), ...items);
  function form() {
    const qs = p.questions.slice(offset, offset + 5),
      form = h('form', { class: 'stack' });
    for (const q of qs) {
      const el =
        q.input === 'select'
          ? select([['', 'Выбрать…'], ...(q.options || [])])
          : q.input === 'long'
            ? area()
            : input();
      el.required = q.required;
      el.maxLength = q.max || 500;
      if (el.tagName === 'INPUT') {
        if (q.validation === 'digits') el.pattern = '[0-9]+';
        if (q.validation === 'url') el.pattern = 'https://.+';
        if (['user', 'role', 'channel'].includes(q.input)) el.pattern = '[0-9]{17,20}';
      }
      el.placeholder = q.placeholder || '';
      if (kind === 'tier' && q.key === 'desired') el.value = b.key;
      el.name = q.key;
      form.append(field(q.label, el, q.help));
    }
    form.append(
      h(
        'button',
        { class: 'btn primary' },
        offset + 5 < p.questions.length ? 'Продолжить' : 'Проверить ответы',
      ),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      for (const [k, v] of new FormData(form)) answers[k] = v;
      if (offset + 5 < p.questions.length) {
        offset += 5;
        formView();
      } else
        display(
          h('h3', {}, 'Проверка ответов'),
          ...p.questions.map((q) => hint(q.label + ' · ' + (answers[q.key] || '—'))),
          btn('Открыть учебный канал', () => channel()),
        );
    };
    return form;
  }
  function formView() {
    display(h('h3', {}, p.title), form());
  }
  function simulate(k) {
    if (['claim', 'unclaim'].includes(k)) {
      claimed = k === 'claim';
      return channel();
    }
    if (k === 'escalate') {
      priority = 'critical';
      return channel();
    }
    if (k === 'transcript')
      return display(
        h('h3', {}, 'Транскрипт симуляции'),
        ...p.questions.map((q) => hint(q.label + ' · ' + (answers[q.key] || '—'))),
        btn('Назад', channel),
      );
    const val =
      k === 'priority'
        ? select(
            ['low', 'normal', 'high', 'critical'].map((v) => [v, tr(v)]),
            priority,
          )
        : input('', {
            placeholder: ['add', 'remove', 'transfer'].includes(k) ? 'Discord ID' : 'Комментарий сотрудника',
          });
    display(
      h('h3', {}, tr(k)),
      field(k === 'priority' ? 'Приоритет' : 'Значение в симуляции', val),
      btn('Применить в симуляции', () => {
        if (k === 'priority') priority = val.value;
        else if (k === 'add') participant = val.value;
        else if (k === 'remove') participant = '';
        else if (k === 'transfer') claimed = true;
        review = tr(k) + (val.value ? ' · ' + val.value : '');
        channel();
      }),
    );
  }
  function channel() {
    display(
      h('h3', {}, '# учебное-обращение'),
      hint(p.welcome),
      badge(claimed ? 'Назначено проверяющему' : 'Открыто'),
      badge(tr(priority)),
      participant && hint('Участник · ' + participant),
      review && hint(review),
      role === 'applicant' &&
        btn('Перейти к проверяющему', () => {
          role = 'leader';
          channel();
        }),
      role !== 'applicant' &&
        bar(
          actions
            .filter((k) => role !== 'recruit' || !['accept', 'reject'].includes(k))
            .filter(
              (k) =>
                !['close', 'archive', 'reopen', 'proof'].includes(k) &&
                (!['accept', 'reject', 'hold', 'info'].includes(k) || p.kind !== 'support') &&
                (k !== 'interview' || p.kind === 'recruit'),
            )
            .map((k) => btn(tr(k), () => simulate(k))),
        ),
      btn('Закрыть учебное обращение', () =>
        display(
          badge('Закрыто', 'green'),
          hint('Симуляция завершена.'),
          btn('Готово', () => d.close()),
        ),
      ),
    );
  }
  display(message(payload, false, bot), btn(b.buttonLabel || 'Заполнить заявку', formView, 'primary'));
}
