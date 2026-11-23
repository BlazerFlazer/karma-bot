import { cmd, sub, user, num, str, role, choices } from '../core/router.js';
import { card, row, button, respond, requireThat } from '../core/ui.js';
import { needStaff } from '../core/access.js';
import { leaders } from '../core/catalog.js';
import { addPoints } from './activity.js';
import { eventTime } from '../core/time.js';
import { publishPanel } from '../services/publication.js';
const kinds = {
  capture: 'Капт',
  meeting: 'Собрание',
  training: 'Тренировка',
  gather: 'Сбор семьи',
  war: 'Война',
  tournament: 'Турнир',
  custom: 'Другое',
};
const states = { scheduled: 'Запланировано', started: 'Идёт', ended: 'Завершено', cancelled: 'Отменено' };
const attendance = { yes: 'Буду', maybe: 'Возможно буду', no: 'Не смогу', reserve: 'Резерв' };
const eventId = () => num('id', 'Номер мероприятия');
export function eventCard(db, e) {
  const d = JSON.parse(e.details),
    rows = db.all('SELECT status,count(*) n FROM event_attendance WHERE event=? GROUP BY status', e.id),
    counts = Object.fromEntries(rows.map((x) => [x.status, x.n]));
  const attendees = db.all(
    "SELECT user FROM event_attendance WHERE event=? AND status='yes' ORDER BY rowid LIMIT 18",
    e.id,
  );
  return card(
    e.title + ' · #' + e.id,
    [
      kinds[d.kind] + ' · ' + states[e.state],
      d.description,
      '<t:' + Math.floor(e.start / 1000) + ':F> · ' + d.location,
      'Ответственный <@' + e.organizer + '> · мест ' + e.capacity,
      d.requirements || '',
      [d.role, ...(d.extraRoles || [])]
        .filter(Boolean)
        .map((id) => '<@&' + id + '>')
        .join(' '),
      Object.entries(attendance)
        .map(([k, v]) => v + ' ' + (counts[k] || 0))
        .join(' · '),
      attendees.map((x) => '<@' + x.user + '>').join(' '),
    ]
      .filter(Boolean)
      .join('\n'),
    e.state === 'scheduled'
      ? [
          row(
            ...Object.entries(attendance).map(([k, v]) =>
              button('rsvp:' + e.id + ':' + k, v, k === 'yes' ? 1 : 2),
            ),
          ),
        ]
      : [],
  );
}
export async function refreshEvent(r, g, e) {
  const ch = await g.channels.fetch(e.channel),
    m = await ch.messages.fetch(e.message);
  await m.edit(eventCard(r.store, e));
}
export function reminders(r, e) {
  r.store.run("DELETE FROM scheduled_tasks WHERE kind='reminder' AND key LIKE ?", 'reminder:' + e.id + ':%');
  for (const minutes of r.config.settings(e.guild).reminders) {
    const when = e.start - minutes * 60000;
    if (when > Date.now())
      r.store.task('reminder:' + e.id + ':' + minutes, e.guild, 'reminder', { id: e.id, minutes }, when);
  }
}
export function installEvents(r) {
  const db = r.store,
    load = (g, id) => {
      const e = db.one('SELECT * FROM events WHERE guild=? AND id=?', g, id);
      requireThat(e, 'Мероприятие не найдено.');
      return e;
    };
  const text = (n, l, required = true) => str(n, l, required, { max_length: 500 });
  r.command(
    cmd(
      'event',
      'Мероприятия семьи',
      sub(
        'create',
        'Создать мероприятие',
        text('title', 'Название'),
        text('time', 'Дата ISO 8601 со смещением'),
        text('location', 'Локация'),
        num('capacity', 'Количество мест', true, 1, 1000),
        str('kind', 'Тип', true, choices(...Object.entries(kinds))),
        text('description', 'Описание', false),
        text('requirements', 'Требования', false),
        role('role', 'Обязательная роль', false),
        role('role2', 'Вторая обязательная роль', false),
        role('role3', 'Третья обязательная роль', false),
        user('organizer', 'Ответственный', false),
      ),
      sub(
        'edit',
        'Изменить мероприятие',
        eventId(),
        text('title', 'Новое название', false),
        text('time', 'Новое время ISO 8601', false),
        text('location', 'Локация', false),
        num('capacity', 'Количество мест', false, 1, 1000),
      ),
      ...['cancel', 'start', 'end'].map((k, j) => sub(k, ['Отменить', 'Начать', 'Завершить'][j], eventId())),
      sub('list', 'Предстоящие мероприятия'),
      sub('attendance', 'Подтвердить присутствие', eventId(), user()),
    ),
    async (i) => {
      const a = i.options.getSubcommand(),
        o = i.options,
        g = i.guildId,
        actor = i.user.id;
      const time = (value) => eventTime(value, r.config.settings(g).timezone);
      if (a === 'list') {
        const es = db.all(
          "SELECT id,title,start FROM events WHERE guild=? AND state IN ('scheduled','started') ORDER BY start LIMIT 20",
          g,
        );
        return respond(
          i,
          card(
            'Мероприятия',
            es
              .map((e) => '#' + e.id + ' · ' + e.title + ' · <t:' + Math.floor(e.start / 1000) + ':f>')
              .join('\n') || 'Расписание пусто.',
          ),
        );
      }
      if (a === 'create') {
        needStaff(i, r.config, leaders);
        const kind = o.getString('kind'),
          channel = r.config.bindings(g, 'channel')[kind === 'capture' ? 'captures' : 'events'];
        requireThat(channel, 'Назначьте канал мероприятия через /setup.');
        const ch = await i.guild.channels.fetch(channel);
        const d = {
            kind,
            location: o.getString('location'),
            description: o.getString('description') || '',
            requirements: o.getString('requirements'),
            role: o.getRole('role')?.id,
            extraRoles: [o.getRole('role2')?.id, o.getRole('role3')?.id].filter(Boolean),
          },
          start = time(o.getString('time')),
          organizer = o.getUser('organizer')?.id || actor;
        const id = Number(
          db.run(
            "INSERT INTO events(guild,title,details,start,capacity,state,organizer,channel) VALUES(?,?,?,?,?,'scheduled',?,?)",
            g,
            o.getString('title'),
            JSON.stringify(d),
            start,
            o.getInteger('capacity'),
            organizer,
            ch.id,
          ).lastInsertRowid,
        );
        const e = load(g, id);
        reminders(r, e);
        await publishPanel(r, i.guild, 'event', id, eventCard(db, e));
        db.audit(g, 'event.create', actor, String(id));
        return respond(i, 'Мероприятие #' + id + ' опубликовано.');
      }
      const id = o.getInteger('id');
      return r.locks.with('event:' + id, async () => {
        const e = load(g, id);
        if (e.organizer !== actor) needStaff(i, r.config, leaders);
        if (a === 'attendance') {
          requireThat(['started', 'ended'].includes(e.state), 'Сначала начните мероприятие.');
          const u = o.getUser('user').id;
          db.tx(() => {
            db.run(
              "INSERT INTO event_attendance VALUES(?,?,'yes',1) ON CONFLICT(event,user) DO UPDATE SET confirmed=1",
              id,
              u,
            );
            if (r.config.enabled(g, 'points')) {
              const cfg = r.config.settings(g),
                amount =
                  JSON.parse(e.details).kind === 'training' ? cfg.trainingPoints : cfg.attendancePoints;
              if (amount)
                addPoints(
                  db,
                  g,
                  u,
                  amount,
                  actor,
                  'Участие в мероприятии #' + id,
                  'event:' + id + ':' + u,
                  cfg.achievementRewards,
                );
            }
          });
        } else if (a === 'edit') {
          requireThat(e.state === 'scheduled', 'Редактировать можно запланированное мероприятие.');
          const d = JSON.parse(e.details),
            capacity = o.getInteger('capacity') || e.capacity;
          requireThat(
            capacity >=
              db.one("SELECT count(*) n FROM event_attendance WHERE event=? AND status='yes'", id).n,
            'Уже зарегистрировано больше участников.',
          );
          db.run(
            'UPDATE events SET title=?,start=?,details=?,capacity=? WHERE id=?',
            o.getString('title') || e.title,
            o.getString('time') ? time(o.getString('time')) : e.start,
            JSON.stringify({ ...d, location: o.getString('location') || d.location }),
            capacity,
            id,
          );
          reminders(r, load(g, id));
        } else {
          requireThat(a === 'end' ? e.state === 'started' : e.state === 'scheduled', 'Переход недоступен.');
          db.run(
            'UPDATE events SET state=? WHERE id=?',
            { start: 'started', end: 'ended', cancel: 'cancelled' }[a],
            id,
          );
          db.run("DELETE FROM scheduled_tasks WHERE kind='reminder' AND key LIKE ?", 'reminder:' + id + ':%');
        }
        db.audit(g, 'event.' + a, actor, String(id));
        await refreshEvent(r, i.guild, load(g, id));
        return respond(i, 'Изменения сохранены.');
      });
    },
    { module: 'events', defer: true },
  );
  r.on(
    'rsvp',
    async (i, [id, k]) =>
      r.locks.with('event:' + id, async () => {
        const e = load(i.guildId, id),
          d = JSON.parse(e.details);
        requireThat(
          e.message === i.message.id && e.state === 'scheduled' && Object.hasOwn(attendance, k),
          'Регистрация закрыта.',
        );
        requireThat(
          [d.role, ...(d.extraRoles || [])].filter(Boolean).every((id) => i.member.roles.cache.has(id)),
          'Для участия нужны настроенные роли.',
        );
        const was = db.one(
          'SELECT status FROM event_attendance WHERE event=? AND user=?',
          id,
          i.user.id,
        )?.status;
        if (
          k === 'yes' &&
          was !== 'yes' &&
          db.one("SELECT count(*) n FROM event_attendance WHERE event=? AND status='yes'", id).n >= e.capacity
        )
          k = 'reserve';
        db.run(
          'INSERT INTO event_attendance(event,user,status) VALUES(?,?,?) ON CONFLICT(event,user) DO UPDATE SET status=excluded.status',
          id,
          i.user.id,
          k,
        );
        await refreshEvent(r, i.guild, e);
        return respond(i, 'Ваш ответ: ' + attendance[k] + '.');
      }),
    { module: 'events', defer: true },
  );
}
