import { cmd, sub, user } from '../core/router.js';
import { card, respond } from '../core/ui.js';
import { needStaff } from '../core/access.js';
import { recruitment } from '../core/catalog.js';
export function stats(db, g, since, actor = null) {
  const rows = db.all(
    `SELECT actor, sum(accepted) accepted,sum(rejected) rejected,sum(closed) closed,sum(reports) reports,avg(first) first,avg(resolution) resolution FROM (
    SELECT h.actor,h.status='accepted' accepted,h.status='rejected' rejected,0 closed,EXISTS(SELECT 1 FROM reports p WHERE p.ticket=h.ticket) reports,NULL first,NULL resolution FROM application_history h JOIN tickets t ON t.id=h.ticket WHERE t.guild=? AND h.time>=? AND h.status IN ('accepted','rejected')
    UNION ALL SELECT closer,0,0,1,0,NULL,closed-created FROM tickets WHERE guild=? AND closed>=?
    UNION ALL SELECT first_responder,0,0,0,0,first_response-created,NULL FROM tickets WHERE guild=? AND first_response>=? AND first_responder IS NOT NULL
  ) WHERE (? IS NULL OR actor=?) GROUP BY actor ORDER BY closed DESC,actor LIMIT 15`,
    g,
    since,
    g,
    since,
    g,
    since,
    actor,
    actor,
  );
  const active = db.one(
    "SELECT count(*) n FROM tickets WHERE guild=? AND state='open' AND (? IS NULL OR assignee=?)",
    g,
    actor,
    actor,
  ).n;
  return card(
    'Работа сотрудников',
    'Активных обращений: ' +
      active +
      '\n\n' +
      (rows
        .map(
          (x) =>
            '<@' +
            x.actor +
            '> · закрыто ' +
            x.closed +
            ' · решений ' +
            (x.accepted + x.rejected) +
            ' (принято ' +
            x.accepted +
            ', отклонено ' +
            x.rejected +
            ') · жалоб ' +
            x.reports +
            '\nПервый ответ: ' +
            (x.first === null ? '—' : Math.round(x.first / 60000) + ' мин') +
            ' · решение: ' +
            (x.resolution === null ? '—' : Math.round(x.resolution / 60000) + ' мин'),
        )
        .join('\n\n') || 'За период нет завершённых действий.'),
  );
}
export function installStaff(r) {
  r.command(
    cmd(
      'staff',
      'Статистика сотрудников',
      sub('stats', 'Статистика сотрудника', user('user', 'Сотрудник', false)),
      sub('leaderboard', 'Сводка нагрузки'),
      sub('weekly', 'За семь дней'),
      sub('report', 'Подробная сводка за месяц'),
    ),
    (i) => {
      needStaff(i, r.config, recruitment);
      const a = i.options.getSubcommand();
      return respond(
        i,
        stats(
          r.store,
          i.guildId,
          a === 'weekly' ? Date.now() - 7 * 86400000 : a === 'report' ? Date.now() - 30 * 86400000 : 0,
          a === 'stats' ? i.options.getUser('user')?.id || i.user.id : null,
        ),
      );
    },
  );
}
