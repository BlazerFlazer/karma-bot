import { cmd, sub, num, str, role, choices } from '../core/router.js';
import { row, button, select, card, respond, requireThat } from '../core/ui.js';
import { management, assignable } from '../core/access.js';
import { privateChannels } from '../core/catalog.js';
const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
export async function publicRole(r, g, id) {
  requireThat(typeof id === 'string' && /^\d{17,20}$/.test(id), 'Роль не настроена.');
  const role = assignable(g, await g.roles.fetch(id), r.config, true);
  const bindings = r.config.bindings(g.id, 'channel');
  const privateIds = new Set([...privateChannels].map((key) => bindings[key]));
  for (const p of Object.values(r.config.types(g.id))) privateIds.add(bindings[p.log] || p.log);
  for (const ch of g.channels.cache.values()) {
    const o = ch.permissionOverwrites?.cache.get(id);
    if (o) {
      requireThat(
        !o.allow.any([
          'ManageChannels',
          'ManageRoles',
          'ManageMessages',
          'ManageThreads',
          'ManageWebhooks',
          'MentionEveryone',
          'ManageEvents',
        ]),
        'У роли есть расширенные права канала.',
      );
      requireThat(!privateIds.has(ch.id) || !o.allow.has('ViewChannel'), 'Роль открывает служебный канал.');
    }
  }
  return role;
}
function load(r, g, id) {
  const p = r.store.one('SELECT * FROM role_panels WHERE guild=? AND id=?', g, id);
  requireThat(p, 'Панель не найдена.');
  return { ...p, ...JSON.parse(p.config) };
}
export async function updateRoles(r, g, p, u, values, toggle, remove = false) {
  requireThat(r.config.enabled(g.id, 'roles'), 'Модуль ролей отключён.');
  return r.locks.with('roles:' + g.id + ':' + u, async () => {
    const member = await g.members.fetch({ user: u, force: true });
    const current = p.roles.filter((id) => member.roles.cache.has(id)),
      target = new Set(toggle ? current : values);
    if (toggle) {
      const id = values[0];
      requireThat(p.roles.includes(id), 'Роль не включена в панель.');
      if (remove || (toggle === 'switch' && target.has(id))) target.delete(id);
      else {
        if (p.max === 1) target.clear();
        target.add(id);
      }
    }
    requireThat(
      target.size <= p.max && [...target].every((id) => p.roles.includes(id)),
      'Достигнут лимит выбранных ролей.',
    );
    const removed = current.filter((id) => !target.has(id)),
      added = [...target].filter((id) => !current.includes(id));
    for (const id of [...removed, ...added]) await publicRole(r, g, id);
    for (const id of removed) {
      await member.roles.remove(id);
      r.store.run('DELETE FROM scheduled_tasks WHERE key=?', 'temprole:' + g.id + ':' + u + ':' + id);
      r.store.audit(g.id, 'role.remove', u, id);
    }
    for (const id of added) {
      if (p.minutes)
        r.store.task(
          'temprole:' + g.id + ':' + u + ':' + id,
          g.id,
          'temprole',
          { user: u, role: id },
          Date.now() + p.minutes * 60000,
        );
      await member.roles.add(id);
      r.store.audit(g.id, 'role.add', u, id);
    }
  });
}
export function installRoles(r) {
  const options = Array.from({ length: 5 }, (_, n) => role('role' + (n + 1), 'Роль ' + (n + 1), n === 0));
  r.command(
    cmd(
      'rolepanel',
      'Самостоятельный выбор ролей',
      sub(
        'create',
        'Опубликовать панель',
        str('title', 'Заголовок', true, { max_length: 100 }),
        str(
          'mode',
          'Интерфейс',
          true,
          choices(['buttons', 'Кнопки'], ['select', 'Список'], ['reaction', 'Реакции']),
        ),
        ...options,
        num('max', 'Максимум ролей, 1 для взаимоисключения', false, 1, 5),
        num('minutes', 'Срок временной роли в минутах', false, 1, 43200),
      ),
      sub('verify', 'Опубликовать панель верификации'),
    ),
    async (i) => {
      management(i);
      const o = i.options;
      if (o.getSubcommand() === 'verify') {
        const id = r.config.settings(i.guildId).verificationRole;
        await publicRole(r, i.guild, id);
        await i.channel.send(
          card('Верификация', 'Подтвердите участие на сервере.', [row(button('verify', 'Подтвердить', 1))]),
        );
        return respond(i, 'Панель опубликована.');
      }
      const roles = options.map((o1) => o.getRole(o1.name)).filter(Boolean);
      requireThat(new Set(roles.map((r) => r.id)).size === roles.length, 'Роли должны различаться.');
      for (const role of roles) await publicRole(r, i.guild, role.id);
      const mode = o.getString('mode'),
        title = o.getString('title'),
        config = {
          roles: roles.map((r) => r.id),
          max: o.getInteger('max') || roles.length,
          minutes: o.getInteger('minutes') || 0,
          mode,
        };
      requireThat(config.max <= roles.length, 'Проверьте лимит ролей.');
      const id = Number(
        r.store.run(
          'INSERT INTO role_panels(guild,title,config,channel) VALUES(?,?,?,?)',
          i.guildId,
          title,
          JSON.stringify(config),
          i.channelId,
        ).lastInsertRowid,
      );
      const rows =
        mode === 'buttons'
          ? [row(...roles.map((r) => button('pickrole:' + id + ':' + r.id, r.name.slice(0, 80))))]
          : mode === 'select'
            ? [
                row({
                  ...select(
                    'rolelist:' + id,
                    'Ваши роли',
                    roles.map((r) => [r.id, r.name]),
                  ),
                  min_values: 0,
                  max_values: config.max,
                }),
              ]
            : [];
      const msg = await i.channel.send(
        card(
          title,
          roles.map((r, n) => (mode === 'reaction' ? emoji[n] + ' ' : '') + '<@&' + r.id + '>').join('\n') +
            '\nМаксимум ролей: ' +
            config.max,
          rows,
        ),
      );
      r.store.run('UPDATE role_panels SET message=? WHERE id=?', msg.id, id);
      if (mode === 'reaction') for (const [n] of roles.entries()) await msg.react(emoji[n]);
      return respond(i, 'Панель опубликована.');
    },
    { module: 'roles', defer: true },
  );
  for (const key of ['pickrole', 'rolelist'])
    r.on(
      key,
      async (i, [id, rid]) => {
        const p = load(r, i.guildId, id);
        requireThat(p.message === i.message.id, 'Используйте исходную панель.');
        await updateRoles(
          r,
          i.guild,
          p,
          i.user.id,
          key === 'pickrole' ? [rid] : i.values,
          key === 'pickrole' ? 'switch' : false,
        );
        return respond(i, 'Роли обновлены.');
      },
      { module: 'roles', defer: true },
    );
  r.on(
    'verify',
    async (i) => {
      const g = i.guildId,
        u = i.user.id,
        c = r.config.settings(g);
      requireThat(
        Date.now() - i.user.createdTimestamp >= c.minAccountDays * 86400000,
        'Возраст аккаунта меньше установленного минимума.',
      );
      requireThat(
        !r.store.one(
          "SELECT 1 FROM cooldowns WHERE guild=? AND user=? AND key='verify' AND until>?",
          g,
          u,
          Date.now(),
        ),
        'Повторите через минуту.',
      );
      r.store.run("INSERT OR REPLACE INTO cooldowns VALUES(?,?,'verify',?)", g, u, Date.now() + 60000);
      await i.member.roles.add(await publicRole(r, i.guild, c.verificationRole));
      r.store.audit(g, 'verification', u, c.verificationRole);
      return respond(i, 'Верификация пройдена.');
    },
    { module: 'roles', defer: true },
  );
}
export async function reactionRole(r, reaction, user, remove) {
  if (user.bot || !reaction.message.guildId) return;
  const g = reaction.message.guild,
    rec = r.store.one('SELECT id FROM role_panels WHERE guild=? AND message=?', g.id, reaction.message.id);
  if (!rec || !r.config.enabled(g.id, 'roles')) return;
  const p = load(r, g.id, rec.id),
    n = emoji.indexOf(reaction.emoji.name);
  if (p.mode !== 'reaction' || !p.roles[n]) return;
  return updateRoles(r, g, p, user.id, [p.roles[n]], 'reaction', remove);
}
