import { requireThat, card } from '../core/ui.js';
import { assignable } from '../core/access.js';
import { blacklistMatch, statusLabels, proofs } from './forms.js';
import { closeTicket, ticketRow } from './tickets.js';
import { publicRole } from './roles.js';
import { discordGate } from '../control/rbac.js';

export async function notify(r, guild, user, title, message) {
  try {
    const target = await guild.client.users.fetch(user);
    await target.send(card(title, message));
    return true;
  } catch (e) {
    r.store.audit(guild.id, 'dm.failed', guild.client.user.id, user, { code: e.code || 'delivery' });
    return false;
  }
}
export function reviewStatus(r, t, actor, status, detail) {
  const result = r.store.run(
    "UPDATE applications SET status=?,reviewer=?,details=? WHERE ticket=? AND status NOT IN ('accepted','rejected','cancelled','expired')",
    status,
    actor,
    JSON.stringify({ detail }),
    t.id,
  );
  requireThat(result.changes, 'Решение уже вынесено.');
  r.store.run(
    'INSERT INTO application_history(ticket,actor,status,detail,time) VALUES(?,?,?,?,?)',
    t.id,
    actor,
    status,
    detail,
    Date.now(),
  );
  r.store.audit(t.guild, 'application.' + status, actor, String(t.id));
}
export async function finishDecision(r, g, id) {
  const t = ticketRow(r.store, g.id, id);
  if (!t.operation) return;
  const op = JSON.parse(t.operation),
    p = JSON.parse(t.policy),
    a = JSON.parse(t.answers),
    cfg = r.config.settings(g.id);
  const { status, actor, reason } = op,
    accepted = status === 'accepted',
    db = r.store;
  const app = db.one('SELECT status FROM applications WHERE ticket=?', id);
  if (!['accepted', 'rejected'].includes(app.status)) {
    const reviewer = await g.members.fetch({ user: actor, force: true, cache: false });
    requireThat(
      reviewer && discordGate(r.config, g, reviewer, t, accepted ? 'accept' : 'reject'),
      'Полномочия проверяющего изменились.',
    );
    requireThat(
      reviewer &&
        (actor === g.ownerId ||
          (t.type !== 'staff' && reviewer.permissions.has('Administrator')) ||
          r.config.roleIds(g.id, p.access).some((id) => reviewer.roles.cache.has(id))),
      'Проверяющий больше не уполномочен принять это решение.',
    );
    if (p.kind === 'report')
      requireThat(
        db.one('SELECT target FROM reports WHERE ticket=?', id)?.target !== actor,
        'Жалобу должен рассмотреть другой сотрудник.',
      );
    if (accepted && ['recruit', 'tier'].includes(p.kind)) {
      requireThat(!blacklistMatch(db, g.id, t.author, a), 'Участник находится в чёрном списке.');
      const member = await g.members.fetch(t.author);
      if (p.kind === 'recruit') {
        requireThat(
          !db.one(
            'SELECT 1 FROM family_members WHERE guild=? AND (user=? OR static=?)',
            g.id,
            t.author,
            a.static,
          ),
          'Профиль или статик уже занят.',
        );
        const map = r.config.bindings(g.id, 'role'),
          id = map[cfg.acceptRole] || cfg.acceptRole;
        const target = await publicRole(r, g, id);
        await member.roles.add(target);
        for (const id of r.config.roleIds(g.id, cfg.removeOnAccept)) {
          if (id !== target.id && member.roles.cache.has(id))
            await member.roles.remove(assignable(g, await g.roles.fetch(id), r.config, true, true));
        }
        if (cfg.nickname && member.manageable) await member.setNickname(a.nick.slice(0, 32));
      } else {
        proofs(a.proof, p.domains || cfg.domains);
        const def = db.one('SELECT config FROM tier_definitions WHERE guild=? AND key=?', g.id, a.desired);
        requireThat(def && JSON.parse(def.config).role === p.tierRole, 'Назначение роли тира изменилось.');
        const profile = db.one(
          'SELECT user FROM family_members WHERE guild=? AND user=? AND static=?',
          g.id,
          t.author,
          a.static,
        );
        requireThat(profile, 'Профиль семьи изменился.');
        await member.roles.add(await publicRole(r, g, p.tierRole));
        const others = new Set(
          db
            .all('SELECT config FROM tier_definitions WHERE guild=?', g.id)
            .map((x) => JSON.parse(x.config).role),
        );
        for (const rid of others)
          if (rid !== p.tierRole && member.roles.cache.has(rid))
            await member.roles.remove(assignable(g, await g.roles.fetch(rid), r.config, true));
      }
    }
    db.tx(() => {
      if (accepted && p.kind === 'recruit')
        db.run(
          'INSERT INTO family_members(guild,user,static,nick,rank,joined,accepted) VALUES(?,?,?,?,?,?,?)',
          g.id,
          t.author,
          a.static,
          a.nick,
          cfg.acceptRole,
          Date.now(),
          actor,
        );
      if (accepted && p.kind === 'tier')
        db.run('UPDATE family_members SET tier=? WHERE guild=? AND user=?', a.desired, g.id, t.author);
      if (accepted && p.kind !== 'report')
        db.run(
          'INSERT INTO member_history(guild,user,actor,action,detail,time) VALUES(?,?,?,?,?,?)',
          g.id,
          t.author,
          actor,
          p.kind === 'tier' ? 'tier' : 'join',
          p.kind === 'tier' ? a.desired : cfg.acceptRole,
          Date.now(),
        );
      if (!accepted)
        db.run(
          'INSERT OR REPLACE INTO cooldowns VALUES(?,?,?,?)',
          g.id,
          t.author,
          'reject:' + p.kind,
          Date.now() + cfg.rejectHours * 3600000,
        );
      if (p.kind === 'report') db.run('UPDATE reports SET decision=? WHERE ticket=?', reason, id);
      reviewStatus(r, t, actor, status, reason);
      db.run('DELETE FROM admission_claims WHERE ticket=?', id);
      db.task(
        'dm-decision:' + id,
        g.id,
        'dm',
        { user: t.author, title: p.title + ' · #' + id, message: statusLabels[status] + '\n' + reason },
        Date.now(),
      );
      const results = r.config.bindings(g.id, 'channel')[
        p.kind === 'tier' ? 'tier_results' : 'application_results'
      ];
      if (results && p.kind !== 'report')
        db.task(
          'result:' + id,
          g.id,
          'postResult',
          {
            id,
            channel: results,
            text: 'Заявка #' + id + ' · <@' + t.author + '> · ' + statusLabels[status],
          },
          Date.now(),
        );
    });
  }
  await closeTicket(r, g, ticketRow(db, g.id, id), actor, reason, status);
}
export async function decide(r, i, t, status, reason) {
  requireThat(t.author !== i.user.id, 'Свою заявку должен рассмотреть другой сотрудник.');
  const app = r.store.one('SELECT status FROM applications WHERE ticket=?', t.id);
  requireThat(
    app && !['accepted', 'rejected', 'cancelled', 'expired'].includes(app.status),
    'Решение недоступно.',
  );
  const data = { actor: i.user.id, status, reason };
  r.store.tx(() => {
    if (status === 'accepted' && JSON.parse(t.policy).kind === 'recruit') {
      const s = JSON.parse(t.answers).static;
      requireThat(
        !r.store.one(
          'SELECT 1 FROM family_members WHERE guild=? AND (static=? OR user=?)',
          i.guildId,
          s,
          t.author,
        ),
        'Статик или профиль уже занят.',
      );
      requireThat(
        r.store.run('INSERT OR IGNORE INTO admission_claims VALUES(?,?,?,?)', i.guildId, s, t.author, t.id)
          .changes,
        'Для этого статика или участника уже оформляется решение.',
      );
    }
    const res = r.store.run(
      "UPDATE tickets SET operation=?,transcript=NULL WHERE id=? AND state='open' AND operation IS NULL",
      JSON.stringify(data),
      t.id,
    );
    requireThat(res.changes, 'Решение уже обрабатывается.');
    r.store.task('decision:' + t.id, i.guildId, 'decision', { id: t.id }, Date.now() + 30000);
  });
  await r.locks.with('member:' + i.guildId + ':' + t.author, () => finishDecision(r, i.guild, t.id));
  r.store.run('DELETE FROM scheduled_tasks WHERE key=?', 'decision:' + t.id);
}
