import { createHash } from 'node:crypto';
import { card, requireThat } from '../core/ui.js';
import { finishDecision, notify } from '../modules/review.js';
import { closeTicket, materialize, ticketRow, syncTicket } from '../modules/tickets.js';
import { endCommunity, panel } from '../modules/community.js';
import { eventCard, reminders } from '../modules/events.js';
import { deliverPanel, publicationTables } from './publication.js';
import { stats } from '../modules/staff.js';
import { reconcileVoice } from '../modules/activity.js';
import { cleanWindows, privatePost } from '../modules/security.js';
import { assignable } from '../core/access.js';
import { roster } from '../modules/family.js';
import { deliverAudit } from './audit-feed.js';
const day = 86400000;
async function postOnce(r, job, c, payload) {
  if (r.store.one('SELECT 1 FROM deliveries WHERE key=?', job.key)) return;
  const nonce = createHash('sha256').update(job.key).digest('hex').slice(0, 24);
  const msg = await c.send({ ...payload, nonce, enforceNonce: true });
  r.store.run(
    'INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?,?)',
    job.key,
    job.guild,
    c.id,
    msg.id,
    Date.now(),
  );
}
export class SchedulerService {
  constructor(r) {
    this.r = r;
    this.running = false;
    this.lastMaintenance = 0;
  }
  recover() {
    const { store: db } = this.r;
    db.run("UPDATE scheduled_tasks SET state='pending' WHERE state='running'");
    // Insert missing work only. Retain retry counts and deadlines across reconnects.
    const ensure = (key, g, kind, payload, due) =>
      db.run(
        'INSERT OR IGNORE INTO scheduled_tasks(key,guild,kind,payload,due) VALUES(?,?,?,?,?)',
        key,
        g,
        kind,
        JSON.stringify(payload),
        due,
      );
    for (const t of db.all(
      "SELECT id,guild,operation,state FROM tickets WHERE state='creating' OR operation IS NOT NULL",
    )) {
      const op = t.operation ? 'decision' : 'create';
      ensure(op + ':' + t.id, t.guild, t.operation ? 'decision' : 'createTicket', { id: t.id }, Date.now());
    }
    for (const [k, table] of [
      ['giveaway', 'giveaways'],
      ['poll', 'polls'],
    ])
      for (const x of db.all('SELECT id,guild,ends FROM ' + table + " WHERE state='open'"))
        ensure(k + ':' + x.id, x.guild, 'communityEnd', { k, id: x.id }, x.ends);
    for (const g of this.r.client.guilds.cache.values()) {
      db.guild(g.id);
      ensure('weekly:' + g.id, g.id, 'weekly', {}, Date.now() + 7 * day);
      ensure('feed:' + g.id, g.id, 'auditFeed', {}, Date.now() + 15000);
    }
    for (const [kind, table] of Object.entries(publicationTables)) {
      for (const x of db.all('SELECT * FROM ' + table + ' WHERE channel IS NOT NULL AND message IS NULL')) {
        if (kind === 'event') reminders(this.r, x);
        const payload = kind === 'event' ? eventCard(db, x) : panel(db, kind, x);
        ensure('publish:' + kind + ':' + x.id, x.guild, 'publish', { kind, id: x.id, payload }, Date.now());
      }
    }
    reconcileVoice(this.r);
  }
  start() {
    this.recover();
    this.timer = setInterval(() => this.tick().catch((e) => this.r.log('scheduler', e)), 15000);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }
  maintenance(now) {
    const r = this.r,
      db = r.store;
    db.run('DELETE FROM drafts WHERE expires<=?', now);
    for (const table of ['control_sessions', 'control_states', 'control_previews'])
      db.run('DELETE FROM ' + table + ' WHERE expires<=?', now);
    db.run('DELETE FROM cooldowns WHERE until<=?', now);
    cleanWindows();
    if (r.client.isReady()) db.run('UPDATE voice_sessions SET last_seen=? WHERE ended IS NULL', now);
    for (const { guild } of db.all('SELECT guild FROM guild_settings')) {
      const cutoff = now - r.config.settings(guild).retentionDays * day;
      db.run(
        "DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE guild=? AND time<? AND action NOT IN ('channel.lock','channel.unlock') LIMIT 250)",
        guild,
        cutoff,
      );
      db.run('DELETE FROM deliveries WHERE guild=? AND created<?', guild, cutoff);
      db.run(
        "UPDATE tickets SET answers='{}',reason=NULL WHERE guild=? AND closed<? AND answers<>'{}' AND operation IS NULL",
        guild,
        cutoff,
      );
      db.run(
        "UPDATE reports SET context='{}',decision=NULL WHERE ticket IN (SELECT id FROM tickets WHERE guild=? AND closed<?)",
        guild,
        cutoff,
      );
      db.run(
        "UPDATE applications SET details='{}' WHERE guild=? AND ticket IN (SELECT id FROM tickets WHERE closed<?)",
        guild,
        cutoff,
      );
      db.run(
        "UPDATE application_history SET detail='' WHERE time<? AND ticket IN (SELECT id FROM tickets WHERE guild=?) AND detail<>''",
        cutoff,
        guild,
      );
    }
  }
  async tick() {
    if (this.running || this.r.stopping || !this.r.client.isReady()) return;
    this.running = true;
    try {
      const r = this.r,
        db = r.store,
        now = Date.now();
      if (now - this.lastMaintenance >= 60000) {
        this.maintenance(now);
        this.lastMaintenance = now;
      }
      const jobs = db.all(
        "SELECT * FROM scheduled_tasks WHERE state='pending' AND due<=? ORDER BY due LIMIT 8",
        now,
      );
      for (const job of jobs) {
        if (r.stopping) break;
        if (
          !db.run(
            "UPDATE scheduled_tasks SET state='running' WHERE key=? AND state='pending' AND due=?",
            job.key,
            job.due,
          ).changes
        )
          continue;
        try {
          await this.execute(job);
          db.run("DELETE FROM scheduled_tasks WHERE key=? AND state='running'", job.key);
        } catch (e) {
          r.log('task.' + job.kind, e);
          const attempts = job.attempts + 1;
          db.run(
            "UPDATE scheduled_tasks SET state=?,attempts=?,due=? WHERE key=? AND state='running'",
            attempts >= 5 ? 'failed' : 'pending',
            attempts,
            Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
            job.key,
          );
          if (attempts >= 5) db.audit(job.guild, 'task.failed', 'system', job.key, { kind: job.kind });
        }
      }
    } finally {
      this.running = false;
    }
  }
  async execute(job) {
    const r = this.r,
      db = r.store,
      g = r.client.guilds.cache.get(job.guild),
      d = JSON.parse(job.payload);
    requireThat(g, 'Сервер недоступен.');
    switch (job.kind) {
      case 'publish':
        return r.locks.with(job.key, () => deliverPanel(r, g, d, true));
      case 'ticketPanel':
        return r.locks.with('ticket:' + d.id, async () => {
          const t = ticketRow(db, g.id, d.id);
          if (t.state !== 'deleted') await syncTicket(r, t, await g.channels.fetch(t.channel));
        });
      case 'closeTicket':
        return r.locks.with('ticket:' + d.id, async () => {
          const t = ticketRow(db, g.id, d.id);
          if (t.state === 'open' && !t.operation) await closeTicket(r, g, t, d.actor, d.reason, d.appStatus);
        });
      case 'createTicket':
        return r.locks.with('ticket:' + d.id, async () => {
          const t = ticketRow(db, g.id, d.id);
          if (t.state === 'creating') await materialize(r, g, t);
        });
      case 'decision':
        return r.locks.with('ticket:' + d.id, () => {
          const t = ticketRow(db, g.id, d.id);
          return r.locks.with('member:' + g.id + ':' + t.author, () => finishDecision(r, g, d.id));
        });
      case 'autoclose':
        return r.locks.with('ticket:' + d.id, async () => {
          const t = ticketRow(db, g.id, d.id);
          if (t.state === 'open' && !t.operation)
            await closeTicket(r, g, t, g.client.user.id, 'Истёк срок ожидания.', 'expired');
        });
      case 'dm':
        return notify(r, g, d.user, d.title, d.message);
      case 'postResult':
        return postOnce(r, job, await g.channels.fetch(d.channel), card('Результат рассмотрения', d.text));
      case 'deleteMessage':
        try {
          const c = await g.channels.fetch(d.channel);
          await c.messages.delete(d.message);
        } catch (e) {
          if (![10003, 10008].includes(e.code)) throw e;
        }
        return;
      case 'communityEnd':
        return r.locks.with(d.k + ':' + d.id, () => endCommunity(r, g, d.k, d.id));
      case 'reminder': {
        const e = db.one('SELECT * FROM events WHERE id=? AND guild=?', d.id, g.id);
        if (e?.state === 'scheduled' && e.start > Date.now() && r.config.enabled(g.id, 'events'))
          await postOnce(
            r,
            job,
            await g.channels.fetch(e.channel),
            card('Скоро мероприятие', e.title + ' · <t:' + Math.floor(e.start / 1000) + ':R>'),
          );
        return;
      }
      case 'temprole': {
        try {
          const m = await g.members.fetch(d.user);
          if (m.roles.cache.has(d.role))
            await m.roles.remove(assignable(g, await g.roles.fetch(d.role), r.config));
        } catch (e) {
          if (![10007, 10011].includes(e.code)) throw e;
        }
        return;
      }
      case 'unsuspend': {
        if (
          !db.one(
            "SELECT 1 FROM strikes WHERE guild=? AND user=? AND kind='suspend' AND active=1 AND expires>?",
            g.id,
            d.u,
            Date.now(),
          )
        )
          db.run('UPDATE family_members SET active=1 WHERE guild=? AND user=?', g.id, d.u);
        return;
      }
      case 'expireAudit':
        db.run("DELETE FROM audit_logs WHERE guild=? AND id=? AND action='message.content'", g.id, d.id);
        return;
      case 'auditFeed':
        await deliverAudit(r, g);
        db.task(job.key, g.id, job.kind, {}, Date.now() + 60000);
        return;
      case 'roster': {
        const p = db.one('SELECT * FROM roster_panels WHERE guild=?', g.id);
        if (!p) return;
        if (r.config.enabled(g.id, 'family')) {
          const c = await g.channels.fetch(p.channel),
            m = await c.messages.fetch(p.message);
          const payload = roster(r, g.id, p.page);
          if (
            m.embeds[0]?.description !== payload.embeds[0].description ||
            m.embeds[0]?.title !== payload.embeds[0].title
          )
            await m.edit(payload);
        }
        db.task(job.key, g.id, job.kind, {}, Date.now() + 300000);
        return;
      }
      case 'weekly': {
        await privatePost(r, g, 'staff_only', stats(db, g.id, Date.now() - 7 * day));
        db.task(job.key, g.id, 'weekly', {}, Date.now() + 7 * day);
        return;
      }
      default:
        throw new Error('Unknown scheduler handler');
    }
  }
}
