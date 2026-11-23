import { PermissionFlagsBits as P } from 'discord.js';
import { card, row, select, entity, modal, field, respond, requireThat, ephemeral } from '../core/ui.js';
import { canReview, management } from '../core/access.js';
import { ticketRow, syncTicket, closeTicket } from './tickets.js';
import { decide, reviewStatus, notify } from './review.js';
import { proofs, priorityLabels } from './forms.js';
import { transcript } from '../services/transcript.js';
import { discordGate } from '../control/rbac.js';
import { eventTime } from '../core/time.js';
const textActions = {
  close: 'Причина закрытия',
  reject: 'Причина отклонения',
  info: 'Какие сведения нужны?',
  hold: 'Причина переноса',
  rename: 'Новое название',
  proof: 'Новые ссылки на доказательства',
  interview: 'Дата и время с часовым поясом',
};
function access(r, i, id, act) {
  r.enabled(i, 'tickets');
  const t = ticketRow(r.store, i.guildId, id),
    p = JSON.parse(t.policy);
  requireThat(t.channel === i.channelId, 'Откройте панель в канале обращения.');
  if (p.kind !== 'support') r.enabled(i, p.kind);
  requireThat(
    canReview(i, t, r.config) || (t.author === i.user.id && ['close', 'proof'].includes(act)),
    'У вас нет доступа к этому обращению.',
  );
  if (p.kind === 'report')
    requireThat(
      r.store.one('SELECT target FROM reports WHERE ticket=?', id)?.target !== i.user.id,
      'Жалобу рассматривает другой сотрудник.',
    );
  if (t.author !== i.user.id || !['close', 'proof'].includes(act))
    requireThat(
      discordGate(r.config, i.guild, i.member, t, act),
      'Действие ограничено настройками KARMA CONTROL.',
    );
  if (p.staffActions && !['close', 'proof', 'delete'].includes(act))
    requireThat(p.staffActions.includes(act), 'Действие отключено в настройках категории.');
  requireThat(!t.operation, 'Решение обрабатывается.');
  requireThat(
    !r.store.one('SELECT 1 FROM scheduled_tasks WHERE key=?', 'close:' + t.id),
    'Закрытие поставлено в очередь. Сотрудник может проверить задачи в панели.',
  );
  requireThat(
    (['archive', 'delete', 'reopen'].includes(act)
      ? ['closed', 'archived']
      : act === 'transcript'
        ? ['open', 'closed', 'archived']
        : ['open']
    ).includes(t.state),
    'Действие недоступно в текущем состоянии.',
  );
  return t;
}
export async function runTicketAction(r, i, id, act, value, extra) {
  return r.locks.with('ticket:' + id, async () => {
    const t = access(r, i, id, act),
      ch = i.channel,
      db = r.store,
      p = JSON.parse(t.policy),
      u = i.user.id;
    if (act === 'accept' || act === 'reject') {
      const status = act === 'accept' ? 'accepted' : 'rejected';
      try {
        await decide(r, i, t, status, value || 'Заявка одобрена.');
      } catch (error) {
        if (db.one('SELECT status FROM applications WHERE ticket=?', id)?.status !== status) throw error;
        r.log('decision.finalize', error);
        return 'Решение сохранено. Завершение обращения будет повторено из очереди.';
      }
      return 'Решение сохранено.';
    }
    if (act === 'close') {
      await closeTicket(r, i.guild, t, u, value);
      return 'Обращение закрыто.';
    }
    if (act === 'transcript') {
      await transcript(r, t, ch);
      return 'Транскрипт отправлен в закрытый журнал.';
    }
    if (act === 'delete') {
      management(i);
      await ch.delete('Удаление обращения #' + id);
      db.run("UPDATE tickets SET state='deleted' WHERE id=?", id);
      db.audit(i.guildId, 'ticket.delete', u, id);
      return 'Канал удалён.';
    }
    if (act === 'archive') {
      if (!ch.isThread()) {
        const cat = r.config.bindings(i.guildId, 'channel').cat_closed;
        requireThat(cat, 'Настройте категорию закрытых обращений.');
        await ch.setParent(cat, { lockPermissions: false });
      }
      db.run("UPDATE tickets SET state='archived' WHERE id=?", id);
    } else if (act === 'reopen') {
      requireThat(
        !db.one("SELECT 1 FROM applications WHERE ticket=? AND status IN ('accepted','rejected')", id),
        'По заявке уже вынесено решение.',
      );
      const count = db.one(
        "SELECT COUNT(*) n FROM tickets WHERE guild=? AND author=? AND type=? AND state IN ('open','creating')",
        i.guildId,
        t.author,
        t.type,
      ).n;
      requireThat(count < p.limit, 'Достигнут лимит открытых обращений.');
      if (ch.isThread()) {
        await ch.setArchived(false);
        await ch.setLocked(false);
      } else {
        const cat = r.config.bindings(i.guildId, 'channel')['cat_' + p.category];
        if (cat) await ch.setParent(cat, { lockPermissions: false });
        for (const uid of [
          t.author,
          ...db.all('SELECT user FROM ticket_participants WHERE ticket=?', id).map((x) => x.user),
        ])
          await ch.permissionOverwrites.edit(uid, { SendMessages: true, AddReactions: null });
      }
      db.run(
        "UPDATE tickets SET state='open',closed=NULL,closer=NULL,reason=NULL,transcript=NULL WHERE id=?",
        id,
      );
      db.run("UPDATE applications SET status='pending' WHERE ticket=?", id);
      if (p.autoClose)
        db.task('autoclose:' + id, i.guildId, 'autoclose', { id: t.id }, Date.now() + p.autoClose * 3600000);
    } else if (act === 'claim' || act === 'unclaim' || act === 'transfer') {
      if (act === 'claim')
        requireThat(!t.assignee || t.assignee === u, 'Обращение уже взял другой сотрудник.');
      if (act === 'unclaim')
        requireThat(
          t.assignee === u || i.memberPermissions.has(P.Administrator),
          'Снять чужое назначение может администратор.',
        );
      if (act === 'transfer') {
        const m = await i.guild.members.fetch(value);
        requireThat(
          !m.user.bot &&
            (m.permissions.has(P.Administrator) ||
              r.config.roleIds(i.guildId, p.access).some((x) => m.roles.cache.has(x))),
          'У участника нет доступа проверяющего.',
        );
      }
      const assignee = act === 'transfer' ? value : act === 'claim' ? u : null;
      db.tx(() => {
        db.run(
          'UPDATE tickets SET assignee=?,first_response=COALESCE(first_response,?),first_responder=COALESCE(first_responder,?) WHERE id=?',
          assignee,
          Date.now(),
          u,
          id,
        );
        const a = db.one('SELECT status FROM applications WHERE ticket=?', id);
        if (a?.status === 'pending' && assignee) reviewStatus(r, t, u, 'review', 'Назначен проверяющий');
      });
    } else if (act === 'add' || act === 'remove') {
      requireThat(
        value !== t.author && value !== i.client.user.id,
        'Нельзя изменить доступ этого участника.',
      );
      if (act === 'add') {
        requireThat(t.type !== 'staff', 'Состав участников жалобы на администрацию ограничен.');
        const m = await i.guild.members.fetch(value);
        requireThat(!m.user.bot, 'Выберите участника.');
        if (ch.isThread()) await ch.members.add(value);
        else
          await ch.permissionOverwrites.edit(m, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
        db.run('INSERT OR IGNORE INTO ticket_participants VALUES(?,?)', id, value);
      } else {
        requireThat(
          db.one('SELECT 1 FROM ticket_participants WHERE ticket=? AND user=?', id, value),
          'Участник не добавлен в обращение.',
        );
        if (ch.isThread()) await ch.members.remove(value);
        else await ch.permissionOverwrites.delete(value);
        db.run('DELETE FROM ticket_participants WHERE ticket=? AND user=?', id, value);
      }
    } else if (act === 'rename') {
      await ch.setName(value.slice(0, 90));
    } else if (act === 'priority' || act === 'escalate') {
      const v = act === 'escalate' ? 'critical' : value;
      requireThat(Object.hasOwn(priorityLabels, v), 'Недопустимый приоритет.');
      db.run('UPDATE tickets SET priority=? WHERE id=?', v, id);
    } else if (act === 'proof') {
      requireThat(t.author === u && p.kind === 'tier', 'Ссылки может изменить только заявитель.');
      proofs(value, p.domains || r.config.settings(i.guildId).domains);
      db.run(
        'UPDATE tickets SET answers=? WHERE id=?',
        JSON.stringify({ ...JSON.parse(t.answers), proof: value }),
        id,
      );
    } else if (['info', 'hold', 'interview'].includes(act)) {
      let detail = value;
      if (act === 'interview') {
        requireThat(p.kind === 'recruit', 'Обзвон доступен для набора.');
        const when = eventTime(value, r.config.settings(i.guildId).timezone);
        const voice = await i.guild.channels.fetch(extra).catch(() => null);
        requireThat(voice?.isVoiceBased(), 'Голосовой канал недоступен.');
        detail = '<t:' + Math.floor(when / 1000) + ':f> · <#' + voice.id + '>';
      }
      db.tx(() => reviewStatus(r, t, u, act === 'interview' ? 'interview' : 'waiting', detail));
      await ch.send(card(act === 'interview' ? 'Приглашение на обзвон' : 'Сообщение проверяющего', detail));
      await notify(r, i.guild, t.author, 'Обращение #' + id, detail);
    } else requireThat(false, 'Неизвестное действие.');
    db.run('UPDATE tickets SET updated=? WHERE id=?', Date.now(), id);
    const after = ticketRow(db, i.guildId, id);
    db.audit(i.guildId, 'ticket.' + act, u, id, {
      before: { state: t.state, priority: t.priority, assignee: t.assignee },
      after: { state: after.state, priority: after.priority, assignee: after.assignee },
    });
    db.task('panel:' + id, i.guildId, 'ticketPanel', { id: t.id }, Date.now() + 30000);
    await syncTicket(r, after, ch);
    return 'Изменения сохранены.';
  });
}
export function installTicketActions(r) {
  const perform = async (i, id, act, value, extra) =>
    respond(i, await runTicketAction(r, i, id, act, value, extra));
  async function action(i, id, act) {
    access(r, i, id, act);
    if (act === 'accept' || act === 'delete')
      return r.preview(
        i,
        'ticket.action',
        { id, act },
        (act === 'delete' ? 'Удалить канал' : 'Принять заявку') + ' #' + id + '?',
      );
    if (Object.hasOwn(textActions, act)) {
      const fields = [field('value', textActions[act], { long: act !== 'rename', max: 800 })];
      if (act === 'interview') fields.push(field('voice', 'ID голосового канала', { max: 20 }));
      return i.showModal(modal('ttext:' + id + ':' + act, textActions[act], ...fields));
    }
    if (['add', 'remove', 'transfer'].includes(act))
      return respond(
        i,
        card('Выбор участника', 'Укажите участника сервера.', [
          row(entity(5, 'tpick:' + id + ':' + act, 'Участник')),
        ]),
      );
    if (act === 'priority')
      return respond(
        i,
        card('Приоритет', 'Выберите приоритет обращения.', [
          row(select('tpick:' + id + ':priority', 'Приоритет', Object.entries(priorityLabels))),
        ]),
      );
    await i.deferReply({ flags: ephemeral });
    return perform(i, id, act);
  }
  r.on('tact', (i, [id, act]) => action(i, id, act));
  r.on('tmore', (i, [id]) => action(i, id, i.values[0]));
  r.on('tpick', (i, [id, act]) => perform(i, id, act, i.values[0]), { defer: true });
  r.on(
    'ttext',
    (i, [id, act]) => {
      const v = i.fields.getTextInputValue('value').trim();
      requireThat(v, 'Заполните поле.');
      return perform(i, id, act, v, act === 'interview' ? i.fields.getTextInputValue('voice') : null);
    },
    { defer: true },
  );
  r.confirm('ticket.action', (i, { id, act }) => perform(i, id, act));
}
