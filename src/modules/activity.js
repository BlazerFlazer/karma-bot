import { cmd, sub, user, str, num, choices } from '../core/router.js';
import { card, respond, requireThat } from '../core/ui.js';
import { leaders, defaults } from '../core/catalog.js';
import { needStaff, management } from '../core/access.js';
const day = 86400000;
export function addPoints(db, g, u, delta, actor, reason, source, rewards = defaults.achievementRewards) {
  if (source && db.one('SELECT 1 FROM point_transactions WHERE source=?', source)) return;
  const old = db.one('SELECT points FROM karma_points WHERE guild=? AND user=?', g, u)?.points || 0,
    total = old + delta;
  requireThat(total >= 0, 'Недостаточно очков.');
  db.run('INSERT OR REPLACE INTO karma_points VALUES(?,?,?)', g, u, total);
  db.run(
    'INSERT INTO point_transactions(guild,user,delta,actor,reason,time,source) VALUES(?,?,?,?,?,?,?)',
    g,
    u,
    delta,
    actor,
    reason,
    Date.now(),
    source || null,
  );
  for (const { points, title, bonus } of rewards) {
    if (total < points || delta <= 0) continue;
    const unlocked = db.run('INSERT OR IGNORE INTO achievements VALUES(?,?,?,?)', g, u, title, Date.now());
    if (unlocked.changes && bonus) {
      db.run('UPDATE karma_points SET points=points+? WHERE guild=? AND user=?', bonus, g, u);
      db.run(
        'INSERT INTO point_transactions(guild,user,delta,actor,reason,time,source) VALUES(?,?,?,?,?,?,?)',
        g,
        u,
        bonus,
        'system',
        'Достижение · ' + title,
        Date.now(),
        'award:' + g + ':' + u + ':' + title,
      );
    }
  }
}
export function voiceUpdate(r, state, at = Date.now()) {
  const g = state.guild.id,
    u = state.id,
    c = state.channel,
    db = r.store;
  if (state.member?.user.bot) return;
  const active =
    r.config.enabled(g, 'voice') &&
    c &&
    c.id !== state.guild.afkChannelId &&
    !r.config.settings(g).excludedVoice.some((id) => id === c.id || id === c.parentId);
  if (active)
    db.run(
      'INSERT OR IGNORE INTO voice_sessions(guild,user,started,last_seen) VALUES(?,?,?,?)',
      g,
      u,
      at,
      at,
    );
  else
    db.run(
      'UPDATE voice_sessions SET ended=?,last_seen=? WHERE guild=? AND user=? AND ended IS NULL',
      at,
      at,
      g,
      u,
    );
}
export function reconcileVoice(r) {
  r.store.run('UPDATE voice_sessions SET ended=last_seen WHERE ended IS NULL');
  for (const g of r.client.guilds.cache.values())
    for (const state of g.voiceStates.cache.values()) voiceUpdate(r, state);
}
export function voiceData(db, g, since, u) {
  const sql =
    'SELECT user,count(*) visits,sum(max(0,coalesce(ended,last_seen)-max(started,?))) duration FROM voice_sessions WHERE guild=? AND coalesce(ended,last_seen)>=? ' +
    (u ? 'AND user=? ' : '') +
    'GROUP BY user ORDER BY duration DESC LIMIT 20';
  return db.all(sql, since, g, since, ...(u ? [u] : []));
}
export function installActivity(r) {
  const db = r.store;
  r.command(
    cmd(
      'voice',
      'Активность в голосовых каналах',
      sub('stats', 'Личная статистика', user('user', 'Участник', false)),
      sub('weekly', 'Активность за 7 дней'),
      sub('leaderboard', 'Активность за 30 дней'),
      sub('reset', 'Сбросить статистику участника', user()),
    ),
    (i) => {
      const a = i.options.getSubcommand(),
        u = i.options.getUser('user')?.id || i.user.id;
      if (a === 'reset') {
        management(i);
        return r.preview(i, 'voice.reset', { u }, 'Сбросить историю голосовой активности <@' + u + '>?');
      }
      if (a === 'stats') {
        const periods = [
          ['Всего', 0],
          ['7 дней', Date.now() - 7 * day],
          ['30 дней', Date.now() - 30 * day],
        ];
        const lines = periods.map(([label, since]) => {
          const v = voiceData(db, i.guildId, since, u)[0];
          return (
            label + ' · ' + Math.floor((v?.duration || 0) / 60000) + ' мин · посещений ' + (v?.visits || 0)
          );
        });
        return respond(i, card('Голосовая активность', '<@' + u + '>\n' + lines.join('\n')));
      }
      const rows = voiceData(
        db,
        i.guildId,
        a === 'weekly' ? Date.now() - 7 * day : a === 'leaderboard' ? Date.now() - 30 * day : 0,
        null,
      );
      return respond(
        i,
        card(
          'Голосовая активность',
          rows
            .map(
              (x) => '<@' + x.user + '> · ' + Math.floor(x.duration / 60000) + ' мин · посещений ' + x.visits,
            )
            .join('\n') || 'Данных пока нет.',
        ),
      );
    },
    { module: 'voice' },
  );
  r.confirm('voice.reset', (i, { u }) => {
    r.enabled(i, 'voice');
    management(i);
    db.run('DELETE FROM voice_sessions WHERE guild=? AND user=?', i.guildId, u);
    const state = i.guild.voiceStates.cache.get(u);
    if (state) voiceUpdate(r, state);
    db.audit(i.guildId, 'voice.reset', i.user.id, u);
    return respond(i, 'Статистика сброшена.');
  });
  r.command(
    cmd(
      'points',
      'Управление очками',
      ...['add', 'remove'].map((a) =>
        sub(
          a,
          a === 'add' ? 'Начислить очки' : 'Списать очки',
          user(),
          num('amount', 'Количество', true, 1, 1000),
          str('reason', 'Основание', true, { max_length: 300 }),
        ),
      ),
      sub('history', 'История очков', user('user', 'Участник', false)),
    ),
    (i) => {
      const a = i.options.getSubcommand(),
        u = i.options.getUser('user')?.id || i.user.id;
      if (a === 'history') {
        if (u !== i.user.id) needStaff(i, r.config, leaders);
        const rows = db.all(
          'SELECT * FROM point_transactions WHERE guild=? AND user=? ORDER BY id DESC LIMIT 25',
          i.guildId,
          u,
        );
        return respond(
          i,
          card(
            'История очков',
            rows.map((x) => x.delta + ' · ' + x.reason + ' · <@' + x.actor + '>').join('\n') ||
              'Начислений нет.',
          ),
        );
      }
      needStaff(i, r.config, leaders);
      db.tx(() => {
        requireThat(
          db.one(
            'SELECT COUNT(*) n FROM point_transactions WHERE guild=? AND actor=? AND time>?',
            i.guildId,
            i.user.id,
            Date.now() - 3600000,
          ).n < 60,
          'Часовой лимит начислений исчерпан.',
        );
        addPoints(
          db,
          i.guildId,
          u,
          (a === 'add' ? 1 : -1) * i.options.getInteger('amount'),
          i.user.id,
          i.options.getString('reason'),
          i.id,
          r.config.settings(i.guildId).achievementRewards,
        );
      });
      return respond(i, 'Баланс обновлён.');
    },
    { module: 'points' },
  );
  r.command(
    cmd('rank', 'Уровень и баланс', user('user', 'Участник', false)),
    (i) => {
      const u = i.options.getUser('user')?.id || i.user.id,
        n = db.one('SELECT points FROM karma_points WHERE guild=? AND user=?', i.guildId, u)?.points || 0;
      return respond(
        i,
        card(
          'KARMA POINTS',
          '<@' + u + '> · ' + n + ' очков · уровень ' + (1 + Math.floor(Math.sqrt(n / 100))),
        ),
      );
    },
    { module: 'points' },
  );
  r.command(
    cmd('achievements', 'Достижения участника', user('user', 'Участник', false)),
    (i) => {
      const u = i.options.getUser('user')?.id || i.user.id,
        rows = db.all('SELECT name FROM achievements WHERE guild=? AND user=?', i.guildId, u);
      return respond(i, card('Достижения', rows.map((x) => x.name).join('\n') || 'Достижений пока нет.'));
    },
    { module: 'points' },
  );
  r.command(
    cmd(
      'leaderboard',
      'Рейтинг очков',
      str('period', 'Период', false, choices(['all', 'Всё время'], ['week', '7 дней'], ['month', '30 дней'])),
    ),
    (i) => {
      const p = i.options.getString('period'),
        since = p === 'week' ? Date.now() - 7 * day : p === 'month' ? Date.now() - 30 * day : 0;
      const rows = db.all(
        'SELECT user,sum(delta) n FROM point_transactions WHERE guild=? AND time>=? GROUP BY user ORDER BY n DESC,user LIMIT 20',
        i.guildId,
        since,
      );
      return respond(
        i,
        card(
          'Рейтинг семьи',
          rows.map((x, j) => j + 1 + '. <@' + x.user + '> · ' + x.n).join('\n') || 'Рейтинг пока пуст.',
        ),
      );
    },
    { module: 'points' },
  );
}
