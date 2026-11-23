import { randomInt, randomBytes, createHmac } from 'node:crypto';
import { publishPanel } from '../services/publication.js';
import { cmd, sub, str, num, role, opt, choices } from '../core/router.js';
import { row, button, select, card, respond, requireThat } from '../core/ui.js';
import { needStaff } from '../core/access.js';
import { leaders } from '../core/catalog.js';
const tables = { giveaway: 'giveaways', poll: 'polls', suggest: 'suggestions' };
const stages = {
  pending: 'На рассмотрении',
  approved: 'Одобрено',
  denied: 'Отклонено',
  building: 'В разработке',
  done: 'Реализовано',
};
export function item(db, g, k, id) {
  requireThat(Object.hasOwn(tables, k), 'Неизвестный тип.');
  const x = db.one('SELECT * FROM ' + tables[k] + ' WHERE guild=? AND id=?', g, id);
  requireThat(x, 'Запись не найдена.');
  return x;
}
export function panel(db, k, x) {
  const votes = db.all(
      'SELECT choice,count(*) n FROM ballots WHERE kind=? AND object=? GROUP BY choice',
      k,
      x.id,
    ),
    counts = Object.fromEntries(votes.map((v) => [v.choice, v.n])),
    active = x.state === 'open',
    cfg = JSON.parse(x.config || '{}');
  if (k === 'giveaway')
    return card(
      'Розыгрыш #' + x.id + ' · ' + x.title,
      [
        'Организатор <@' + x.organizer + '>',
        'Окончание <t:' + Math.floor(x.ends / 1000) + ':R>',
        'Участников: ' + (counts.join || 0) + ' · призовых мест ' + cfg.winners,
        active
          ? 'Регистрация открыта'
          : x.state === 'cancelled'
            ? 'Отменён'
            : 'Победители: ' +
              (JSON.parse(x.result || '[]')
                .map((u) => '<@' + u + '>')
                .join(', ') || 'нет'),
      ].join('\n'),
      active ? [row(button('vote:giveaway:' + x.id + ':join', 'Участвовать', 1))] : [],
    );
  if (k === 'poll')
    return card(
      'Голосование #' + x.id + ' · ' + x.title,
      cfg.options.map((v, j) => v + ' · ' + (counts[j] || 0)).join('\n') +
        '\n' +
        (active ? 'До <t:' + Math.floor(x.ends / 1000) + ':f>' : 'Завершено') +
        (cfg.anonymous ? ' · Анонимно' : ''),
      active
        ? [
            row(
              select(
                'ballot:' + x.id,
                'Ваш выбор',
                cfg.options.map((v, j) => [String(j), v]),
              ),
            ),
          ]
        : [],
    );
  return card(
    'Предложение #' + x.id,
    x.body +
      '\n\n' +
      stages[x.state] +
      ' · За ' +
      (counts.yes || 0) +
      ' · Против ' +
      (counts.no || 0) +
      (x.comment ? '\nРешение: ' + x.comment : ''),
    [
      row(
        button('vote:suggest:' + x.id + ':yes', 'За'),
        button('vote:suggest:' + x.id + ':no', 'Против'),
        button('discuss:' + x.id, 'Обсудить'),
      ),
    ],
  );
}
async function refresh(r, g, k, x) {
  const c = await g.channels.fetch(x.channel),
    m = await c.messages.fetch(x.message);
  await m.edit(panel(r.store, k, x));
}
export async function endCommunity(r, g, k, id, mode = 'end') {
  const db = r.store,
    x = item(db, g.id, k, id);
  if (mode === 'reroll') requireThat(x.state === 'ended', 'Сначала завершите розыгрыш.');
  else if (x.state !== 'open') {
    await refresh(r, g, k, x);
    return;
  }
  if (k === 'giveaway') {
    const cfg = JSON.parse(x.config),
      prev = new Set(mode === 'reroll' ? JSON.parse(x.result || '[]') : []),
      eligible = [];
    if (mode !== 'cancel') {
      // Reservoir sampling keeps memory proportional to the number of prizes.
      let seen = 0,
        cursor = '';
      for (;;) {
        const batch = db.all(
          "SELECT user FROM ballots WHERE kind='giveaway' AND object=? AND user>? ORDER BY user LIMIT 50",
          id,
          cursor,
        );
        if (!batch.length) break;
        for (const { user } of batch) {
          cursor = user;
          if (prev.has(user)) continue;
          let m;
          try {
            m = await g.members.fetch({ user, cache: false });
          } catch (e) {
            if (e.code === 10007) continue;
            throw e;
          }
          if ((cfg.role && !m.roles.cache.has(cfg.role)) || cfg.excluded.some((v) => m.roles.cache.has(v)))
            continue;
          seen++;
          if (eligible.length < cfg.winners) eligible.push(user);
          else {
            const j = randomInt(seen);
            if (j < cfg.winners) eligible[j] = user;
          }
        }
      }
    }
    db.run(
      'UPDATE giveaways SET state=?,result=? WHERE id=?',
      mode === 'cancel' ? 'cancelled' : 'ended',
      JSON.stringify(eligible),
      id,
    );
  } else db.run("UPDATE polls SET state='ended' WHERE id=?", id);
  await refresh(r, g, k, item(db, g.id, k, id));
}
export function installCommunity(r) {
  const db = r.store,
    idOption = num('id', 'Номер'),
    duration = num('minutes', 'Длительность в минутах', true, 1, 43200);
  for (const k of ['giveaway', 'poll']) {
    const isGive = k === 'giveaway',
      options = isGive
        ? [
            str('prize', 'Приз', true, { max_length: 160 }),
            duration,
            num('winners', 'Количество победителей', true, 1, 20),
            role('required', 'Необходимая роль', false),
            role('excluded', 'Исключённая роль', false),
            role('excluded2', 'Вторая исключённая роль', false),
            role('excluded3', 'Третья исключённая роль', false),
          ]
        : [
            str('question', 'Вопрос', true, { max_length: 180 }),
            str('options', 'Варианты через |', true, { max_length: 750 }),
            duration,
            opt(5, 'anonymous', 'Анонимное голосование', false),
            role('required', 'Необходимая роль', false),
          ];
    const actions = isGive ? ['end', 'reroll', 'cancel'] : ['end', 'results'];
    r.command(
      cmd(
        k,
        isGive ? 'Управление розыгрышами' : 'Управление голосованиями',
        sub('create', 'Создать', ...options),
        ...actions.map((a) =>
          sub(
            a,
            {
              end: 'Завершить',
              reroll: 'Выбрать новых победителей',
              cancel: 'Отменить',
              results: 'Показать результаты',
            }[a],
            idOption,
          ),
        ),
      ),
      async (i) => {
        const o = i.options,
          a = o.getSubcommand(),
          g = i.guildId;
        if (a === 'results') {
          const x = item(db, g, k, o.getInteger('id')),
            channel = await i.guild.channels.fetch(x.channel);
          requireThat(channel.permissionsFor(i.member).has('ViewChannel'), 'Голосование недоступно.');
          return respond(i, panel(db, k, x));
        }
        needStaff(i, r.config, leaders);
        if (a === 'create') {
          const ends = Date.now() + o.getInteger('minutes') * 60000,
            cfg = { role: o.getRole('required')?.id };
          let res;
          const dest = isGive ? r.config.bindings(g, 'channel').giveaways : i.channelId;
          requireThat(dest, 'Настройте канал розыгрышей.');
          const ch = await i.guild.channels.fetch(dest);
          if (isGive) {
            cfg.excluded = ['excluded', 'excluded2', 'excluded3']
              .map((key) => o.getRole(key)?.id)
              .filter(Boolean);
            cfg.winners = o.getInteger('winners');
            res = db.run(
              "INSERT INTO giveaways(guild,title,config,organizer,ends,channel,state) VALUES(?,?,?,?,?,?,'open')",
              g,
              o.getString('prize'),
              JSON.stringify(cfg),
              i.user.id,
              ends,
              ch.id,
            );
          } else {
            cfg.options = o
              .getString('options')
              .split('|')
              .map((s) => s.trim());
            requireThat(
              cfg.options.length >= 2 &&
                cfg.options.length <= 10 &&
                new Set(cfg.options).size === cfg.options.length &&
                cfg.options.every((s) => s.length && s.length <= 80),
              'Укажите 2–10 различных вариантов до 80 символов.',
            );
            cfg.anonymous = !!o.getBoolean('anonymous');
            cfg.salt = randomBytes(32).toString('hex');
            res = db.run(
              "INSERT INTO polls(guild,title,config,ends,channel,state) VALUES(?,?,?,?,?,'open')",
              g,
              o.getString('question'),
              JSON.stringify(cfg),
              ends,
              ch.id,
            );
          }
          const id = Number(res.lastInsertRowid);
          db.task(k + ':' + id, g, 'communityEnd', { k, id }, ends);
          await publishPanel(r, i.guild, k, id, panel(db, k, item(db, g, k, id)));
          return respond(i, 'Опубликовано · #' + id);
        }
        const id = o.getInteger('id');
        await r.locks.with(k + ':' + id, () => endCommunity(r, i.guild, k, id, a));
        return respond(i, 'Результат сохранён.');
      },
      { module: 'community', defer: true },
    );
  }
  r.command(
    cmd('suggest', 'Отправить предложение', str('text', 'Текст предложения', true, { max_length: 1500 })),
    async (i) => {
      const channel = r.config.bindings(i.guildId, 'channel').suggestions;
      requireThat(channel, 'Настройте канал предложений.');
      const ch = await i.guild.channels.fetch(channel),
        id = Number(
          db.run(
            "INSERT INTO suggestions(guild,author,body,channel,state) VALUES(?,?,?,?,'pending')",
            i.guildId,
            i.user.id,
            i.options.getString('text'),
            ch.id,
          ).lastInsertRowid,
        );
      await publishPanel(r, i.guild, 'suggest', id, panel(db, 'suggest', item(db, i.guildId, 'suggest', id)));
      return respond(i, 'Предложение #' + id + ' опубликовано.');
    },
    { module: 'community', defer: true },
  );
  r.command(
    cmd(
      'suggestion',
      'Решение по предложению',
      idOption,
      str('status', 'Статус', true, choices(...Object.entries(stages))),
      str('comment', 'Комментарий', true, { max_length: 600 }),
    ),
    async (i) => {
      needStaff(i, r.config, leaders);
      const id = i.options.getInteger('id');
      item(db, i.guildId, 'suggest', id);
      db.run(
        'UPDATE suggestions SET state=?,comment=? WHERE id=?',
        i.options.getString('status'),
        i.options.getString('comment'),
        id,
      );
      await refresh(r, i.guild, 'suggest', item(db, i.guildId, 'suggest', id));
      return respond(i, 'Решение опубликовано.');
    },
    { module: 'community', defer: true },
  );
  async function vote(i, k, id, choice) {
    return r.locks.with(k + ':' + id, async () => {
      const x = item(db, i.guildId, k, id);
      requireThat(x.message === i.message.id, 'Используйте исходную панель.');
      const cfg = JSON.parse(x.config || '{}');
      let u = i.user.id;
      if (k !== 'suggest') {
        requireThat(x.state === 'open' && x.ends > Date.now(), 'Приём ответов завершён.');
        requireThat(!cfg.role || i.member.roles.cache.has(cfg.role), 'Требуется роль участника.');
      }
      if (k === 'giveaway')
        requireThat(
          !cfg.excluded.some((v) => i.member.roles.cache.has(v)) && choice === 'join',
          'Участие недоступно.',
        );
      if (k === 'poll') {
        requireThat(/^\d+$/.test(choice) && Number(choice) < cfg.options.length, 'Проверьте вариант.');
        if (cfg.anonymous) u = createHmac('sha256', cfg.salt).update(u).digest('hex');
      }
      if (k === 'suggest') requireThat(['yes', 'no'].includes(choice), 'Неверный голос.');
      db.run('INSERT OR REPLACE INTO ballots VALUES(?,?,?,?)', k, id, u, choice);
      await refresh(r, i.guild, k, x);
      return respond(i, 'Ваш ответ сохранён.');
    });
  }
  r.on('vote', (i, [k, id, choice]) => vote(i, k, id, choice), { module: 'community', defer: true });
  r.on('ballot', (i, [id]) => vote(i, 'poll', id, i.values[0]), { module: 'community', defer: true });
  r.on(
    'discuss',
    async (i, [id]) => {
      const x = item(db, i.guildId, 'suggest', id);
      requireThat(x.message === i.message.id, 'Используйте исходную панель.');
      const thread =
        i.message.thread ||
        (await i.message.startThread({ name: 'Предложение ' + id, autoArchiveDuration: 1440 }));
      return respond(i, 'Обсуждение <#' + thread.id + '>');
    },
    { module: 'community', defer: true },
  );
}
