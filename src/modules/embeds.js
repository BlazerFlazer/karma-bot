import { escapeMarkdown } from 'discord.js';
import { cmd, sub, str, ch } from '../core/router.js';
import {
  row,
  button,
  field,
  modal,
  card,
  respond,
  requireThat,
  safeMentions,
  ephemeral,
} from '../core/ui.js';
import { management } from '../core/access.js';
import { webUrl } from './forms.js';
export const seedEmbed = {
  title: 'Объявление семьи',
  description: 'Добро пожаловать в {family_name}, {username}!',
  color: '#303238',
  author: '',
  footer: 'KARMA SYSTEM',
  thumbnail: '',
  banner: '',
  timestamp: false,
  fields: [],
  buttons: [],
  url: '',
};
export function embedPayload(data, vars) {
  const text = (s, max) => {
    requireThat(typeof s === 'string', 'Текстовое поле должно быть строкой.');
    return s
      .replace(/\{(user|username|server|member_count|ticket_id|family_name|date)\}/g, (_, k) =>
        ['username', 'server', 'family_name'].includes(k)
          ? escapeMarkdown(String(vars[k] ?? '—'))
          : String(vars[k] ?? '—'),
      )
      .slice(0, max);
  };
  const d = data;
  requireThat(d && typeof d === 'object' && /^#[\da-f]{6}$/i.test(d.color || ''), 'Проверьте цвет #RRGGBB.');
  const e = {
    title: text(d.title, 256),
    description: text(d.description, 4096),
    color: parseInt(d.color.slice(1), 16),
  };
  requireThat(e.title || e.description, 'Укажите заголовок или описание.');
  if (!e.title) delete e.title;
  if (!e.description) delete e.description;
  for (const k of ['url', 'thumbnail', 'banner'])
    if (d[k]) {
      requireThat(webUrl(d[k]), 'Проверьте HTTPS URL.');
      if (k === 'url') e.url = d[k];
      else e[k === 'banner' ? 'image' : 'thumbnail'] = { url: d[k] };
    }
  if (d.author) e.author = { name: text(d.author, 256) };
  if (d.footer) e.footer = { text: text(d.footer, 2048) };
  if (d.timestamp) e.timestamp = new Date().toISOString();
  requireThat(
    Array.isArray(d.fields) && d.fields.length <= 25 && Array.isArray(d.buttons) && d.buttons.length <= 5,
    'Проверьте количество полей и кнопок.',
  );
  e.fields = d.fields.map((f) => {
    const name = text(f.name, 256),
      value = text(f.value, 1024);
    requireThat(name && value, 'Поля должны содержать название и значение.');
    return { name, value, inline: !!f.inline };
  });
  const sum = [
    e.title,
    e.description,
    e.footer?.text,
    e.author?.name,
    ...e.fields.flatMap((f) => [f.name, f.value]),
  ].join('').length;
  requireThat(sum <= 6000, 'Превышен лимит текста embed.');
  const buttons = d.buttons.map((b) => {
    const label = text(b.label, 80);
    requireThat(webUrl(b.url) && label, 'Проверьте ссылку и текст кнопки.');
    return { type: 2, style: 5, url: b.url, label };
  });
  return { embeds: [e], components: buttons.length ? [row(...buttons)] : [], allowedMentions: safeMentions };
}
function context(i, r) {
  return {
    user: '<@' + i.user.id + '>',
    username: i.user.username,
    server: i.guild.name,
    member_count: i.guild.memberCount,
    ticket_id: r.store.one('SELECT id FROM tickets WHERE guild=? AND channel=?', i.guildId, i.channelId)?.id,
    family_name: 'KARMA',
    date: new Date().toLocaleDateString('ru-RU', { timeZone: r.config.settings(i.guildId).timezone }),
  };
}
export function installEmbeds(r) {
  const db = r.store,
    name = str('name', 'Название шаблона', true, { max_length: 64 });
  const read = (g, n) => {
    const x = db.one('SELECT config FROM embed_templates WHERE guild=? AND name=?', g, n);
    requireThat(x, 'Шаблон не найден.');
    return JSON.parse(x.config);
  };
  r.command(
    cmd(
      'embed',
      'Конструктор сообщений',
      sub('create', 'Создать шаблон', name),
      sub('edit', 'Изменить шаблон', name),
      sub('save', 'Сохранить копию шаблона', name, str('as', 'Новое название', true, { max_length: 64 })),
      sub(
        'send',
        'Опубликовать или обновить сообщение',
        name,
        ch(),
        str('message', 'ID ранее отправленного сообщения', false),
      ),
      sub('list', 'Список шаблонов'),
      sub('delete', 'Удалить шаблон', name),
    ),
    async (i) => {
      management(i);
      const o = i.options,
        a = o.getSubcommand(),
        n = o.getString('name');
      if (a === 'list')
        return respond(
          i,
          card(
            'Шаблоны',
            db
              .all('SELECT name FROM embed_templates WHERE guild=? ORDER BY name LIMIT 80', i.guildId)
              .map((x) => x.name)
              .join('\n') || 'Шаблонов нет.',
          ),
        );
      if (a === 'create' || a === 'edit') {
        if (a === 'create')
          requireThat(
            !db.one('SELECT 1 FROM embed_templates WHERE guild=? AND name=?', i.guildId, n),
            'Название уже занято.',
          );
        const cfg = a === 'edit' ? read(i.guildId, n) : seedEmbed,
          id = db.draft(i.guildId, i.user.id, 'embed', { name: n, create: a === 'create' });
        return i.showModal(
          modal(
            'embedform:' + id,
            'Конструктор сообщения',
            field('title', 'Заголовок', { value: cfg.title, max: 256 }),
            field('body', 'Описание', { value: cfg.description, long: true, max: 3500 }),
            field('options', 'Оформление, поля и кнопки · JSON', {
              value: JSON.stringify({ ...cfg, title: undefined, description: undefined }, null, 2),
              long: true,
              max: 4000,
            }),
          ),
        );
      }
      const data = read(i.guildId, n);
      if (a === 'delete') return r.preview(i, 'embed.delete', { n }, 'Удалить шаблон «' + n + '»?');
      if (a === 'save') {
        db.run(
          'INSERT INTO embed_templates VALUES(?,?,?)',
          i.guildId,
          o.getString('as'),
          JSON.stringify(data),
        );
        return respond(i, 'Копия сохранена.');
      }
      const channel = o.getChannel('channel'),
        mid = o.getString('message'),
        payload = embedPayload(data, context(i, r));
      const confirm = db.draft(
        i.guildId,
        i.user.id,
        'confirm',
        { action: 'embed.publish', data: { channelId: channel.id, mid, n, payload } },
        180000,
      );
      return respond(i, {
        ...payload,
        content: 'Подтвердите ' + (mid ? 'обновление' : 'публикацию') + ' в <#' + channel.id + '>.',
        components: [row(button('confirm:' + confirm, 'Подтвердить публикацию', 1))],
      });
    },
    { module: 'embeds' },
  );
  r.confirm('embed.publish', async (i, { channelId, mid, n, payload }) => {
    r.enabled(i, 'embeds');
    management(i);
    const channel = await i.guild.channels.fetch(channelId);
    for (const who of [i.member, i.guild.members.me])
      requireThat(
        channel
          ?.permissionsFor(who)
          ?.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']),
        'Проверьте доступ к каналу.',
      );
    let message;
    if (mid) {
      requireThat(
        db.one(
          'SELECT 1 FROM sent_embeds WHERE guild=? AND channel=? AND message=?',
          i.guildId,
          channel.id,
          mid,
        ),
        'Сообщение не зарегистрировано в конструкторе.',
      );
      const m = await channel.messages.fetch(mid);
      requireThat(m.author.id === r.client.user.id, 'Автор сообщения изменился.');
      await m.edit(payload);
      message = m.id;
    } else {
      const m = await channel.send(payload);
      db.run('INSERT INTO sent_embeds VALUES(?,?,?,?)', i.guildId, m.id, channel.id, n);
      message = m.id;
    }
    db.audit(i.guildId, 'embed.publish', i.user.id, n, { channel: channelId, message });
    return respond(i, 'Сообщение опубликовано.');
  });
  r.on(
    'embedform',
    async (i, [id]) => {
      management(i);
      const d = r.readDraft(i, id, 'embed');
      let raw;
      try {
        raw = JSON.parse(i.fields.getTextInputValue('options'));
      } catch {
        requireThat(false, 'Проверьте JSON оформления.');
      }
      const cfg = {
        ...raw,
        title: i.fields.getTextInputValue('title'),
        description: i.fields.getTextInputValue('body'),
      };
      const payload = embedPayload(cfg, context(i, r)),
        confirm = db.draft(i.guildId, i.user.id, 'confirm', { action: 'embed.save', data: { ...d, cfg } });
      payload.components.push(row(button('confirm:' + confirm, 'Сохранить шаблон', 1)));
      return respond(i, payload);
    },
    { module: 'embeds' },
  );
  r.confirm('embed.save', (i, d) => {
    management(i);
    r.enabled(i, 'embeds');
    if (d.create)
      db.run('INSERT INTO embed_templates VALUES(?,?,?)', i.guildId, d.name, JSON.stringify(d.cfg));
    else
      requireThat(
        db.run(
          'UPDATE embed_templates SET config=? WHERE guild=? AND name=?',
          JSON.stringify(d.cfg),
          i.guildId,
          d.name,
        ).changes,
        'Шаблон был удалён.',
      );
    return respond(i, 'Шаблон сохранён.');
  });
  r.confirm('embed.delete', (i, { n }) => {
    management(i);
    r.enabled(i, 'embeds');
    db.run('DELETE FROM embed_templates WHERE guild=? AND name=?', i.guildId, n);
    return respond(i, 'Шаблон удалён.');
  });
}
