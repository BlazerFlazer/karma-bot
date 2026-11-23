import { PermissionFlagsBits as P } from 'discord.js';
import { cmd, sub, str, ch } from '../core/router.js';
import { card, respond, requireThat } from '../core/ui.js';
import { management } from '../core/access.js';
import { embedPayload } from './embeds.js';
function permitted(i, channel) {
  management(i);
  requireThat(
    channel?.guild.id === i.guildId &&
      channel.permissionsFor(i.member).has(P.ManageWebhooks) &&
      channel.permissionsFor(i.guild.members.me).has(P.ManageWebhooks),
    'В этом канале нужны права управления вебхуками.',
  );
}
export function installWebhooks(r) {
  const id = str('id', 'ID вебхука'),
    chan = ch();
  r.command(
    cmd(
      'webhook',
      'Вебхуки конструктора',
      sub(
        'create',
        'Создать вебхук',
        chan,
        str('name', 'Имя вебхука', true, { min_length: 2, max_length: 80 }),
      ),
      sub('list', 'Список вебхуков бота', chan),
      sub('send', 'Отправить шаблон через вебхук', chan, id, str('template', 'Название шаблона')),
      sub('delete', 'Удалить вебхук бота', chan, id),
    ),
    async (i) => {
      const o = i.options,
        a = o.getSubcommand(),
        c = o.getChannel('channel');
      permitted(i, c);
      if (a === 'create') {
        const w = await c.createWebhook({ name: o.getString('name'), reason: 'KARMA · ' + i.user.id });
        r.store.audit(i.guildId, 'webhook.create', i.user.id, w.id);
        return respond(i, 'Вебхук создан · ID ' + w.id);
      }
      const hooks = (await c.fetchWebhooks()).filter((w) => w.owner?.id === i.client.user.id);
      if (a === 'list')
        return respond(
          i,
          card('Вебхуки бота', hooks.map((w) => w.name + ' · ' + w.id).join('\n') || 'Вебхуков нет.'),
        );
      const w = hooks.get(o.getString('id'));
      requireThat(w, 'Вебхук бота не найден.');
      if (a === 'delete')
        return r.preview(
          i,
          'webhook.delete',
          { channel: c.id, id: w.id },
          'Удалить вебхук «' + w.name + '»?',
        );
      const template = r.store.one(
        'SELECT config FROM embed_templates WHERE guild=? AND name=?',
        i.guildId,
        o.getString('template'),
      );
      requireThat(template, 'Шаблон не найден.');
      const payload = embedPayload(JSON.parse(template.config), {
        user: '<@' + i.user.id + '>',
        username: i.user.username,
        server: i.guild.name,
        member_count: i.guild.memberCount,
        family_name: 'KARMA',
        date: new Date().toLocaleDateString('ru-RU'),
        ticket_id: '—',
      });
      await w.send(payload);
      r.store.audit(i.guildId, 'webhook.send', i.user.id, w.id);
      return respond(i, 'Сообщение опубликовано.');
    },
    { module: 'embeds', defer: true },
  );
  r.confirm('webhook.delete', async (i, d) => {
    r.enabled(i, 'embeds');
    const c = await i.guild.channels.fetch(d.channel);
    permitted(i, c);
    const w = (await c.fetchWebhooks()).get(d.id);
    requireThat(w?.owner?.id === i.client.user.id, 'Вебхук недоступен.');
    await w.delete('KARMA · ' + i.user.id);
    r.store.audit(i.guildId, 'webhook.delete', i.user.id, d.id);
    return respond(i, 'Вебхук удалён.');
  });
}
