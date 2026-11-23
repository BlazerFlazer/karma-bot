import { cmd, sub, str, num, user, choices, opt } from '../core/router.js';
import { card, button, row, respond, requireThat } from '../core/ui.js';
import { needStaff, management } from '../core/access.js';
import { leaders, recruitment } from '../core/catalog.js';
import { validId, validateAnswer, blacklistMatch } from './forms.js';
const rankOrder = ['trial', 'recruit', 'member', 'main', 'high', 'deputy_leader', 'leader', 'owner'];
const ranks = choices(...rankOrder.map((k) => [k, k]));
const small = (name, label, required = true) => str(name, label, required, { max_length: 500 });
const idOpt = () => num('id', 'Номер записи');
const reasonOpt = () => small('reason', 'Причина');
const discipline = {
  warning: 'Устное предупреждение',
  strike: 'Выговор',
  strict: 'Строгий выговор',
  demote: 'Понижение',
  suspend: 'Временное исключение',
  expel: 'Исключение',
  blacklist: 'Чёрный список',
};
const history = (db, g, u, actor, action, detail) =>
  db.run(
    'INSERT INTO member_history(guild,user,actor,action,detail,time) VALUES(?,?,?,?,?,?)',
    g,
    u,
    actor,
    action,
    detail,
    Date.now(),
  );
function recordDetail(record) {
  const active = record.active && (!record.expires || record.expires > Date.now());
  return [
    active ? 'Действует' : 'Завершено',
    'от <t:' + Math.floor(record.created / 1000) + ':d>',
    record.expires ? 'до <t:' + Math.floor(record.expires / 1000) + ':d>' : 'бессрочно',
    record.evidence ? 'Доказательства: ' + record.evidence : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export function roster(r, g, page = 0) {
  const total = r.store.one('SELECT count(*) n FROM family_members WHERE guild=?', g).n;
  page = Math.max(0, Math.min(Math.ceil(total / 12) - 1, Number(page) || 0));
  const items = r.store.all(
    'SELECT user,nick,rank,active FROM family_members WHERE guild=? ORDER BY nick,user LIMIT 12 OFFSET ?',
    g,
    page * 12,
  );
  return card(
    'Состав семьи · ' + total,
    items
      .map((m) => m.nick + ' · <@' + m.user + '> · ' + m.rank + (m.active ? '' : ' · неактивен'))
      .join('\n') || 'Состав пока пуст.',
    [
      row(
        button('roster:' + Math.max(0, page - 1), 'Назад'),
        button('roster:' + page, 'Обновить'),
        button('roster:' + (page + 1), 'Далее'),
      ),
    ],
  );
}
export function installFamily(r) {
  const db = r.store,
    profile = (g, u) => {
      const m = db.one('SELECT * FROM family_members WHERE guild=? AND user=?', g, u);
      requireThat(m, 'Профиль отсутствует.');
      return m;
    };
  r.on('roster', (i, [p]) => {
    r.enabled(i, 'family');
    db.run('UPDATE roster_panels SET page=? WHERE guild=? AND message=?', Number(p), i.guildId, i.message.id);
    return i.update(roster(r, i.guildId, p));
  });
  r.command(
    cmd(
      'family',
      'Управление семьёй',
      sub('profile', 'Профиль участника', user('user', 'Участник', false)),
      sub('add', 'Добавить участника', user(), small('static', 'Статик'), small('nick', 'Игровой никнейм')),
      sub('remove', 'Исключить участника', user(), reasonOpt()),
      sub('promote', 'Повысить ранг', user(), str('rank', 'Новый ранг', true, ranks)),
      sub('demote', 'Понизить ранг', user(), str('rank', 'Новый ранг', true, ranks)),
      sub('search', 'Поиск по статику, нику или Discord ID', small('query', 'Запрос')),
      sub('roster', 'Состав семьи', opt(5, 'publish', 'Опубликовать обновляемую панель', false)),
      sub('stats', 'Статистика семьи'),
      sub('history', 'История участника', user()),
      sub(
        'inactive',
        'Отметить активность участника',
        user(),
        str('state', 'Статус', true, choices(['active', 'Активен'], ['inactive', 'Неактивен'])),
      ),
      sub('note', 'Приватная заметка', user(), small('text', 'Текст заметки')),
    ),
    async (i) => {
      const o = i.options,
        a = o.getSubcommand(),
        g = i.guildId,
        actor = i.user.id,
        u = o.getUser('user')?.id || actor;
      if (a === 'roster') {
        if (!o.getBoolean('publish')) return respond(i, roster(r, g));
        management(i);
        await i.deferReply({ flags: 64 });
        const m = await i.channel.send(roster(r, g));
        db.run('INSERT OR REPLACE INTO roster_panels VALUES(?,?,?,0)', g, i.channelId, m.id);
        db.task('roster:' + g, g, 'roster', {}, Date.now() + 300000);
        return respond(i, 'Состав опубликован. Обновление каждые пять минут.');
      }
      if (a === 'stats') {
        const v = db.one(
          'SELECT count(*) n,coalesce(sum(active),0) active FROM family_members WHERE guild=?',
          g,
        );
        return respond(i, card('Статистика семьи', 'Состав: ' + v.n + '\nАктивны: ' + v.active));
      }
      if (a === 'profile') {
        const m = profile(g, u);
        const lines = [
          m.nick + ' · <@' + u + '>',
          'Ранг: ' + m.rank,
          'Тир: ' + (m.tier || '—'),
          'Вступил <t:' + Math.floor(m.joined / 1000) + ':D>',
          'Участие в мероприятиях: ' +
            db.one(
              'SELECT count(*) n FROM event_attendance a JOIN events e ON e.id=a.event WHERE e.guild=? AND a.user=? AND a.confirmed=1',
              g,
              u,
            ).n,
        ];
        if (
          u === actor ||
          i.memberPermissions.has('Administrator') ||
          r.config.roleIds(g, recruitment).some((id) => i.member.roles.cache.has(id))
        )
          lines.push(
            'Статик: ' + m.static,
            'Активность: ' + (m.active ? 'активен' : 'неактивен'),
            'Принял: <@' + m.accepted + '>',
            'Активных взысканий: ' +
              db.one(
                'SELECT count(*) n FROM strikes WHERE guild=? AND user=? AND active=1 AND (expires IS NULL OR expires>?)',
                g,
                u,
                Date.now(),
              ).n,
          );
        return respond(i, card('Профиль участника', lines.join('\n')));
      }
      needStaff(i, r.config, ['search', 'history'].includes(a) ? recruitment : leaders);
      if (a === 'search') {
        const query = o
          .getString('query')
          .trim()
          .replace(/^<@!?(\d+)>$/, '$1')
          .toLowerCase();
        const list = db.all(
          'SELECT user,nick,static FROM family_members WHERE guild=? AND (user=? OR static=? OR instr(karma_lower(nick),?)>0) ORDER BY nick LIMIT 20',
          g,
          query,
          query,
          query,
        );
        return respond(
          i,
          card(
            'Результаты поиска',
            list.map((x) => x.nick + ' · ' + x.static + ' · <@' + x.user + '>').join('\n') ||
              'Совпадений нет.',
          ),
        );
      }
      if (a === 'history') {
        const list = db.all(
          'SELECT * FROM member_history WHERE guild=? AND user=? ORDER BY id DESC LIMIT 20',
          g,
          u,
        );
        return respond(
          i,
          card(
            'История участника',
            list
              .map(
                (x) =>
                  '<t:' +
                  Math.floor(x.time / 1000) +
                  ':d> · ' +
                  x.action +
                  ' · ' +
                  x.detail +
                  ' · <@' +
                  x.actor +
                  '>',
              )
              .join('\n') || 'История пуста.',
          ),
        );
      }
      if (a === 'remove') {
        profile(g, u);
        return r.preview(
          i,
          'family.remove',
          { u, reason: o.getString('reason') },
          'Исключить <@' + u + '> из базы семьи?',
        );
      }
      db.tx(() => {
        if (a === 'add') {
          const s = o.getString('static').trim(),
            nick = o.getString('nick').trim();
          validateAnswer('static', s, {}, 'recruit');
          requireThat(nick.length > 0 && nick.length <= 64, 'Проверьте никнейм.');
          requireThat(
            !db.one('SELECT 1 FROM admission_claims WHERE guild=? AND (static=? OR user=?)', g, s, u),
            'Для участника уже оформляется решение.',
          );
          requireThat(!blacklistMatch(db, g, u, { static: s, nick }), 'Участник находится в чёрном списке.');
          db.run(
            'INSERT INTO family_members(guild,user,static,nick,rank,joined,accepted) VALUES(?,?,?,?,?,?,?)',
            g,
            u,
            s,
            nick,
            'member',
            Date.now(),
            actor,
          );
          history(db, g, u, actor, 'Вступление', nick);
        } else {
          const m = profile(g, u);
          if (a === 'note') history(db, g, u, actor, 'Заметка', o.getString('text'));
          if (a === 'inactive') {
            db.run(
              'UPDATE family_members SET active=? WHERE guild=? AND user=?',
              Number(o.getString('state') === 'active'),
              g,
              u,
            );
            history(db, g, u, actor, 'Активность', o.getString('state'));
          }
          if (a === 'promote' || a === 'demote') {
            const rank = o.getString('rank'),
              diff = rankOrder.indexOf(rank) - rankOrder.indexOf(m.rank);
            requireThat(
              a === 'promote' ? diff > 0 : diff < 0,
              'Ранг не соответствует направлению изменения.',
            );
            db.run('UPDATE family_members SET rank=? WHERE guild=? AND user=?', rank, g, u);
            history(db, g, u, actor, a === 'promote' ? 'Повышение' : 'Понижение', m.rank + ' → ' + rank);
          }
        }
        db.audit(g, 'family.' + a, actor, u);
      });
      return respond(i, 'Профиль обновлён.');
    },
    { module: 'family' },
  );
  r.confirm('family.remove', (i, { u, reason }) => {
    r.enabled(i, 'family');
    needStaff(i, r.config, leaders);
    db.tx(() => {
      requireThat(
        db.run('DELETE FROM family_members WHERE guild=? AND user=?', i.guildId, u).changes,
        'Участник отсутствует.',
      );
      history(db, i.guildId, u, i.user.id, 'Исключение', reason);
      db.audit(i.guildId, 'family.remove', i.user.id, u, { reason });
    });
    return respond(i, 'Участник исключён из состава.');
  });
  const strikeKind = str('kind', 'Вид взыскания', true, choices(...Object.entries(discipline)));
  r.command(
    cmd(
      'strike',
      'Дисциплина семьи',
      sub(
        'add',
        'Выдать взыскание',
        user(),
        strikeKind,
        reasonOpt(),
        small('evidence', 'Доказательства', false),
        num('days', 'Срок в днях', false, 1, 365),
      ),
      sub('remove', 'Снять взыскание', idOpt(), reasonOpt()),
      sub('list', 'Действующие взыскания', user()),
      sub('history', 'Все взыскания участника', user()),
      sub('settings', 'Порог предупреждения', num('threshold', 'Количество взысканий', false, 1, 30)),
    ),
    (i) => {
      needStaff(i, r.config, leaders);
      const o = i.options,
        a = o.getSubcommand(),
        g = i.guildId,
        u = o.getUser('user')?.id;
      if (a === 'settings') {
        management(i);
        const cfg = r.config.settings(g),
          n = o.getInteger('threshold');
        if (n) r.config.save(g, { ...cfg, strikeThreshold: n }, i.user.id);
        return respond(i, 'Порог уведомления: ' + (n || cfg.strikeThreshold));
      }
      if (a === 'add') {
        const d = {
          u,
          kind: o.getString('kind'),
          reason: o.getString('reason'),
          evidence: o.getString('evidence'),
          days: o.getInteger('days'),
        };
        if (d.kind === 'suspend') requireThat(d.days, 'Укажите длительность временного исключения.');
        if (['expel', 'suspend', 'blacklist', 'demote'].includes(d.kind))
          return r.preview(
            i,
            'discipline',
            d,
            discipline[d.kind] + ' для <@' + u + '>. Основание: ' + d.reason,
          );
        return punish(i, d);
      }
      if (a === 'remove') {
        const id = o.getInteger('id');
        requireThat(
          db.run('UPDATE strikes SET active=0 WHERE guild=? AND id=? AND active=1', g, id).changes,
          'Действующее взыскание не найдено.',
        );
        db.audit(g, 'strike.remove', i.user.id, String(id), { reason: o.getString('reason') });
        return respond(i, 'Взыскание снято.');
      }
      const list = db.all(
        'SELECT * FROM strikes WHERE guild=? AND user=? ' +
          (a === 'list' ? 'AND active=1 AND (expires IS NULL OR expires>unixepoch()*1000) ' : '') +
          'ORDER BY id DESC LIMIT 20',
        g,
        u,
      );
      return respond(
        i,
        card(
          'Взыскания',
          list
            .map(
              (s) =>
                '#' +
                s.id +
                ' · ' +
                discipline[s.kind] +
                ' · ' +
                s.reason +
                ' · <@' +
                s.actor +
                '>\n' +
                recordDetail(s),
            )
            .join('\n') || 'Записей нет.',
        ),
      );
    },
    { module: 'family' },
  );
  function punish(i, d) {
    r.enabled(i, 'family');
    needStaff(i, r.config, leaders);
    const g = i.guildId,
      u = d.u,
      now = Date.now(),
      until = d.days ? now + d.days * 86400000 : null;
    let count;
    db.tx(() => {
      const m = profile(g, u);
      const id = Number(
        db.run(
          'INSERT INTO strikes(guild,user,kind,reason,evidence,actor,created,expires) VALUES(?,?,?,?,?,?,?,?)',
          g,
          u,
          d.kind,
          d.reason,
          d.evidence,
          i.user.id,
          now,
          until,
        ).lastInsertRowid,
      );
      if (d.kind === 'demote')
        db.run(
          'UPDATE family_members SET rank=? WHERE guild=? AND user=?',
          rankOrder[Math.max(0, rankOrder.indexOf(m.rank) - 1)],
          g,
          u,
        );
      if (d.kind === 'expel' || d.kind === 'blacklist')
        db.run('DELETE FROM family_members WHERE guild=? AND user=?', g, u);
      if (d.kind === 'blacklist')
        db.run(
          "INSERT INTO blacklisted_members(guild,kind,value,reason,evidence,actor,created,expires) VALUES(?,'discord',?,?,?,?,?,?)",
          g,
          u,
          d.reason,
          d.evidence,
          i.user.id,
          now,
          until,
        );
      if (d.kind === 'suspend') {
        db.run('UPDATE family_members SET active=0 WHERE guild=? AND user=?', g, u);
        db.task('suspend:' + id, g, 'unsuspend', { id, u }, until);
      }
      history(db, g, u, i.user.id, discipline[d.kind], d.reason);
      db.audit(g, 'strike.add', i.user.id, u, { kind: d.kind, reason: d.reason });
      count = db.one(
        'SELECT count(*) n FROM strikes WHERE guild=? AND user=? AND active=1 AND (expires IS NULL OR expires>?)',
        g,
        u,
        now,
      ).n;
    });
    return respond(
      i,
      'Взыскание сохранено.' +
        (count >= r.config.settings(g).strikeThreshold ? ' Достигнут дисциплинарный порог.' : '') +
        ' Для обжалования доступен тикет.',
    );
  }
  r.confirm('discipline', punish);
  const kind = str(
    'kind',
    'Тип идентификатора',
    true,
    choices(['discord', 'Discord ID'], ['static', 'Статик'], ['nick', 'Никнейм']),
  );
  r.command(
    cmd(
      'blacklist',
      'Чёрный список',
      sub(
        'add',
        'Добавить запись',
        kind,
        small('value', 'Идентификатор'),
        reasonOpt(),
        small('evidence', 'Доказательства', false),
        num('days', 'Срок в днях', false, 1, 3650),
      ),
      sub('remove', 'Снять ограничение', idOpt(), reasonOpt()),
      sub('check', 'Проверить идентификатор', kind, small('value', 'Идентификатор')),
      sub('history', 'История идентификатора', kind, small('value', 'Идентификатор')),
    ),
    (i) => {
      needStaff(i, r.config, leaders);
      const o = i.options,
        g = i.guildId,
        a = o.getSubcommand(),
        k = o.getString('kind'),
        v = o.getString('value')?.trim().toLowerCase();
      if (a === 'remove') {
        requireThat(
          db.run(
            'UPDATE blacklisted_members SET active=0 WHERE guild=? AND id=? AND active=1',
            g,
            o.getInteger('id'),
          ).changes,
          'Запись отсутствует.',
        );
        db.audit(g, 'blacklist.remove', i.user.id, String(o.getInteger('id')), {
          reason: o.getString('reason'),
        });
        return respond(i, 'Ограничение снято.');
      }
      if (k === 'discord') requireThat(validId(v), 'Проверьте Discord ID.');
      if (k === 'static') validateAnswer('static', v, {}, 'recruit');
      if (a === 'add')
        return r.preview(
          i,
          'blacklist.add',
          {
            k,
            v,
            reason: o.getString('reason'),
            evidence: o.getString('evidence'),
            days: o.getInteger('days'),
          },
          'Ограничить подачу заявок для идентификатора ' + v + '?',
        );
      const list = db.all(
        'SELECT * FROM blacklisted_members WHERE guild=? AND kind=? AND value=? ' +
          (a === 'check' ? 'AND active=1 AND (expires IS NULL OR expires>unixepoch()*1000) ' : '') +
          'ORDER BY id DESC LIMIT 20',
        g,
        k,
        v,
      );
      return respond(
        i,
        card(
          'Чёрный список',
          list
            .map((b) => '#' + b.id + ' · ' + b.reason + ' · <@' + b.actor + '> · ' + recordDetail(b))
            .join('\n') || 'Совпадений нет.',
        ),
      );
    },
    { module: 'family' },
  );
  r.confirm('blacklist.add', (i, d) => {
    r.enabled(i, 'family');
    needStaff(i, r.config, leaders);
    db.run(
      'INSERT INTO blacklisted_members(guild,kind,value,reason,evidence,actor,created,expires) VALUES(?,?,?,?,?,?,?,?)',
      i.guildId,
      d.k,
      d.v,
      d.reason,
      d.evidence,
      i.user.id,
      Date.now(),
      d.days ? Date.now() + d.days * 86400000 : null,
    );
    db.audit(i.guildId, 'blacklist.add', i.user.id, d.v, { reason: d.reason });
    return respond(i, 'Ограничение сохранено.');
  });
}
