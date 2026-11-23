import { ChannelType as C, PermissionFlagsBits as P, GatewayIntentBits as G } from 'discord.js';
import { cmd } from '../core/router.js';
import { roles, channels, categories, privateChannels, leaders } from '../core/catalog.js';
import { card, row, select, entity, button, modal, field, respond, requireThat } from '../core/ui.js';
import { management } from '../core/access.js';
const catalogs = { role: roles, channel: channels, category: categories };
const names = { role: 'Роли', channel: 'Каналы', category: 'Категории' };
const resource = (kind, key) => {
  requireThat(Object.hasOwn(catalogs, kind) && Object.hasOwn(catalogs[kind], key), 'Неизвестный ресурс.');
  return catalogs[kind][key];
};
const channelType = (kind, key) =>
  kind === 'category' ? C.GuildCategory : key === 'interview_queue' ? C.GuildVoice : C.GuildText;
const bindingKey = (kind, key) => (kind === 'category' ? 'cat_' + key : key);
const collection = (i, kind) => (kind === 'role' ? i.guild.roles : i.guild.channels);
function home() {
  return card('Настройка сервера', 'Выберите раздел, затем назначение роли или канала.', [
    row(select('setgroup', 'Раздел', Object.entries(names))),
  ]);
}
function group(i, r, kind) {
  requireThat(Object.hasOwn(catalogs, kind), 'Неизвестный раздел.');
  const map = r.config.bindings(i.guildId, kind);
  return card(names[kind], 'Выберите ресурс. Отметка ✓ означает сохранённую привязку.', [
    row(
      select(
        'setkey:' + kind,
        'Назначение',
        Object.entries(catalogs[kind]).map(([k, n]) => [k, (map[bindingKey(kind, k)] ? '✓ ' : '') + n]),
      ),
    ),
    row(button('sethome', 'На главную')),
  ]);
}
function validate(i, obj, kind, key) {
  requireThat(obj && obj.guild.id === i.guildId, 'Ресурс не найден.');
  if (kind === 'role') requireThat(obj.id !== i.guildId && !obj.managed, 'Выберите обычную роль сервера.');
  else {
    requireThat(obj.type === channelType(kind, key), 'Неподходящий тип канала.');
    if (privateChannels.has(key) || kind === 'category')
      requireThat(
        !obj.permissionsFor(i.guild.roles.everyone).has(P.ViewChannel),
        'Для этого назначения скройте канал от @everyone.',
      );
  }
}
export function installSetup(r) {
  r.command(
    { ...cmd('setup', 'Пошаговая настройка сервера'), default_member_permissions: String(P.Administrator) },
    (i) => {
      management(i);
      return respond(i, home());
    },
  );
  r.on('sethome', (i) => {
    management(i);
    return i.update(home());
  });
  r.on('setgroup', (i) => {
    management(i);
    return i.update(group(i, r, i.values[0]));
  });
  r.on('setback', (i, [k]) => {
    management(i);
    return i.update(group(i, r, k));
  });
  r.on('setkey', (i, [k]) => {
    management(i);
    const key = i.values[0],
      name = resource(k, key),
      id = r.config.bindings(i.guildId, k)[bindingKey(k, key)];
    return i.update(
      card(
        name,
        id
          ? 'Сохранённая привязка ' + (k === 'role' ? '<@&' : '<#') + id + '>'
          : 'Выберите существующий ресурс или создайте новый.',
        [
          row(
            entity(
              k === 'role' ? 6 : 8,
              'setbind:' + k + ':' + key,
              'Выбрать существующий',
              k === 'role' ? undefined : [channelType(k, key)],
            ),
          ),
          row(button('setnew:' + k + ':' + key, 'Создать…'), button('setback:' + k, 'Назад')),
        ],
      ),
    );
  });
  r.on('setbind', async (i, [k, key]) => {
    if (k === 'role' && ['owner', 'leader', 'deputy_leader', 'control_recruit'].includes(key))
      requireThat(
        i.user.id === i.guild.ownerId,
        'Привязки ролей доступа KARMA CONTROL меняет владелец сервера.',
      );
    management(i);
    resource(k, key);
    await i.deferUpdate();
    const id = i.values[0],
      obj = await collection(i, k).fetch(id);
    validate(i, obj, k, key);
    r.config.bind(i.guildId, k, bindingKey(k, key), id, i.user.id);
    return i.editReply(group(i, r, k));
  });
  r.on('setnew', (i, [k, key]) => {
    management(i);
    return i.showModal(
      modal(
        'setname:' + k + ':' + key,
        'Название ресурса',
        field('name', 'Название', { value: resource(k, key), max: 80 }),
      ),
    );
  });
  r.on('setname', (i, [kind, key]) => {
    management(i);
    resource(kind, key);
    const name = i.fields.getTextInputValue('name').trim();
    requireThat(name, 'Укажите название.');
    return r.preview(
      i,
      'setup.create',
      { kind, key, name },
      'Назначение «' + resource(kind, key) + '». Будет создан или привязан ресурс «' + name + '».',
    );
  });
  r.confirm('setup.create', async (i, { kind, key, name }) => {
    if (kind === 'role' && ['owner', 'leader', 'deputy_leader', 'control_recruit'].includes(key))
      requireThat(
        i.user.id === i.guild.ownerId,
        'Привязки ролей доступа KARMA CONTROL меняет владелец сервера.',
      );
    management(i);
    resource(kind, key);
    await r.locks.with('setup:' + i.guildId, async () => {
      const manager = collection(i, kind),
        bound = r.config.bindings(i.guildId, kind)[bindingKey(kind, key)];
      const all = await manager.fetch();
      let obj = all.get(bound);
      if (!obj) {
        const matches = all.filter(
          (x) => x?.name === name && (kind === 'role' || x.type === channelType(kind, key)),
        );
        requireThat(matches.size <= 1, 'Несколько ресурсов с таким названием. Выберите нужный вручную.');
        obj = matches.first();
      }
      if (!obj) {
        if (kind === 'role') obj = await manager.create({ name, permissions: [], reason: 'KARMA /setup' });
        else {
          const restricted = kind === 'category' || privateChannels.has(key);
          const permissionOverwrites = restricted
            ? [
                { id: i.guildId, deny: [P.ViewChannel] },
                { id: i.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
                ...r.config.roleIds(i.guildId, leaders).map((id) => ({ id, allow: [P.ViewChannel] })),
              ]
            : undefined;
          obj = await manager.create({
            name,
            type: channelType(kind, key),
            permissionOverwrites,
            reason: 'KARMA /setup',
          });
        }
      }
      validate(i, obj, kind, key);
      r.config.bind(i.guildId, kind, bindingKey(kind, key), obj.id, i.user.id);
    });
    return respond(i, group(i, r, kind));
  });
  r.command(
    cmd('diagnostics', 'Проверить конфигурацию и права'),
    async (i) => {
      management(i);
      const [allRoles, allChannels] = await Promise.all([i.guild.roles.fetch(), i.guild.channels.fetch()]);
      const lines = [];
      for (const [kind, catalog] of Object.entries(catalogs)) {
        const map = r.config.bindings(i.guildId, kind);
        const missing = [],
          invalid = [];
        for (const key of Object.keys(catalog)) {
          const id = map[bindingKey(kind, key)];
          if (!id) {
            missing.push(catalog[key]);
            continue;
          }
          const obj = (kind === 'role' ? allRoles : allChannels).get(id);
          try {
            validate(i, obj, kind, key);
            if (kind !== 'role' && !obj.permissionsFor(i.guild.members.me).has(P.ViewChannel))
              invalid.push(catalog[key]);
            if (
              kind === 'role' &&
              ['member', 'recruit', 'trial', 'blacklisted'].includes(key) &&
              !obj.editable
            )
              invalid.push(catalog[key] + ' (иерархия)');
          } catch {
            invalid.push(catalog[key]);
          }
        }
        lines.push(
          '**' +
            names[kind] +
            '**\nТребуют привязки: ' +
            (missing.join(', ') || '—') +
            '\nПроверьте доступ: ' +
            (invalid.join(', ') || '—'),
        );
      }
      const bindings = r.config.bindings(i.guildId, 'channel'),
        broken = [];
      for (const [key, policy] of Object.entries(r.config.types(i.guildId))) {
        const location =
          policy.mode === 'thread'
            ? bindings[policy.parent] || policy.parent
            : bindings['cat_' + policy.category] || policy.category;
        const reviewers = r.config.roleIds(i.guildId, policy.access);
        if (
          !reviewers.some((id) => allRoles.has(id)) ||
          !allChannels.has(location) ||
          !allChannels.has(bindings[policy.log] || policy.log)
        )
          broken.push(key);
      }
      lines.push('Типы с незаполненным доступом, журналом или категорией: ' + (broken.join(', ') || '—'));
      const perms = Object.entries({
        ManageChannels: P.ManageChannels,
        ManageRoles: P.ManageRoles,
        ManageThreads: P.ManageThreads,
        AttachFiles: P.AttachFiles,
        ReadMessageHistory: P.ReadMessageHistory,
        EmbedLinks: P.EmbedLinks,
      })
        .filter(([, p]) => !i.guild.members.me.permissions.has(p))
        .map(([n]) => n);
      lines.push(
        'Отсутствующие права бота: ' + (perms.join(', ') || '—'),
        'Интенты клиента: участники ' +
          (r.client.options.intents.has(G.GuildMembers) ? 'вкл' : 'выкл') +
          ', текст ' +
          (r.client.options.intents.has(G.MessageContent) ? 'вкл' : 'выкл'),
        'SQLite: ' + r.store.one('PRAGMA quick_check').quick_check,
      );
      return respond(i, card('Диагностика', lines.join('\n\n')));
    },
    { defer: true },
  );
}
