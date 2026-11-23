import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from '../core/env.js';
import { redact } from '../core/redact.js';

export class DatabaseService {
  constructor(dir = dataDir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'karma.sqlite'));
    this.db.function('karma_lower', { deterministic: true }, (s) => String(s ?? '').toLowerCase());
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=128; PRAGMA journal_size_limit=4194304; PRAGMA cache_size=-2048',
    );
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)');
    const migrations = new URL('./migrations/', import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((n) => /^\d+\.sql$/.test(n))
      .sort()) {
      const version = Number.parseInt(name, 10);
      if (!this.one('SELECT version FROM schema_migrations WHERE version=?', version))
        this.tx(() => {
          this.db.exec(readFileSync(new URL(name, migrations), 'utf8'));
          this.run('INSERT INTO schema_migrations VALUES(?)', version);
        });
    }
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  one(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  tx(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      if (result instanceof Promise) throw new TypeError('Асинхронная транзакция');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  guild(id) {
    this.run('INSERT OR IGNORE INTO guild_settings(guild) VALUES(?)', id);
  }
  audit(guild, action, actor, target, detail = {}) {
    return Number(
      this.run(
        'INSERT INTO audit_logs(guild,action,actor,target,detail,time) VALUES(?,?,?,?,?,?)',
        guild,
        action,
        actor,
        redact(target),
        JSON.stringify(redact(detail)),
        Date.now(),
      ).lastInsertRowid,
    );
  }
  draft(guild, user, kind, data, ttl = 900000) {
    this.run(
      'DELETE FROM drafts WHERE id IN (SELECT id FROM drafts WHERE guild=? AND user=? ORDER BY expires DESC LIMIT -1 OFFSET 19)',
      guild,
      user,
    );
    const id = randomUUID();
    this.run(
      'INSERT INTO drafts VALUES(?,?,?,?,?,?)',
      id,
      guild,
      user,
      kind,
      JSON.stringify(data),
      Date.now() + ttl,
    );
    return id;
  }
  task(key, guild, kind, payload, due) {
    this.run(
      "INSERT INTO scheduled_tasks(key,guild,kind,payload,due) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET due=excluded.due,payload=excluded.payload,state='pending',attempts=0",
      key,
      guild,
      kind,
      JSON.stringify(payload),
      due,
    );
  }
  listBackups() {
    const dir = join(this.dir, 'backups');
    mkdirSync(dir, { recursive: true });
    return readdirSync(dir)
      .filter((n) => /^karma-[\dTZ-]+-[\da-f]{8}\.sqlite$/.test(n))
      .sort()
      .reverse();
  }
  backup(protect) {
    const old = this.listBackups().filter((n) => n !== protect);
    const name =
      'karma-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.sqlite';
    const destination = join(this.dir, 'backups', name),
      staging = destination + '.part';
    try {
      this.run('VACUUM main INTO ?', staging);
      renameSync(staging, destination);
    } finally {
      if (existsSync(staging)) unlinkSync(staging);
    }
    for (const n of old.slice(protect ? 3 : 4)) unlinkSync(join(this.dir, 'backups', n));
    return name;
  }
  restore(name, guild) {
    if (!this.listBackups().includes(name)) throw new Error('Копия не найдена.');
    this.run('ATTACH DATABASE ? AS saved', join(this.dir, 'backups', name));
    try {
      for (const schema of ['main', 'saved']) {
        if (this.one('SELECT count(*) n FROM ' + schema + '.guild_settings WHERE guild<>?', guild).n)
          throw new Error('Копия содержит другой сервер.');
      }
      if (
        this.one('PRAGMA saved.quick_check').quick_check !== 'ok' ||
        this.all('PRAGMA saved.foreign_key_check').length
      )
        throw new Error('Повреждённая копия.');
      const tables = this.all(
        "SELECT name,sql FROM main.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const saved = this.all(
        "SELECT name,sql FROM saved.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const fromV1 =
        JSON.stringify(tables.filter((t) => !t.name.startsWith('control_'))) === JSON.stringify(saved) &&
        JSON.stringify(
          this.all('SELECT version FROM saved.schema_migrations ORDER BY version').map((v) => v.version),
        ) === '[1,2,3,4]';
      if (!fromV1 && JSON.stringify(tables) !== JSON.stringify(saved))
        throw new Error('Несовместимая схема.');
      const dependencies = new Map(
        tables.map(({ name }) => [
          name,
          this.all('PRAGMA main.foreign_key_list(' + name + ')').map((fk) => fk.table),
        ]),
      );
      const order = [];
      while (order.length < tables.length) {
        const ready = [...dependencies].filter(
          ([name, parents]) => !order.includes(name) && parents.every((parent) => order.includes(parent)),
        );
        if (!ready.length) throw new Error('Циклические связи в схеме резервной копии.');
        order.push(...ready.map(([name]) => name));
      }
      const safety = this.backup(name);
      this.tx(() => {
        const dataTables = order.filter((t) => t !== 'schema_migrations');
        for (const t of [...dataTables].reverse()) this.db.exec('DELETE FROM main.' + t);
        for (const t of dataTables)
          if (!fromV1 || !t.startsWith('control_'))
            this.db.exec('INSERT INTO main.' + t + ' SELECT * FROM saved.' + t);
        this.run('DELETE FROM drafts');
        for (const table of ['control_sessions', 'control_states', 'control_previews'])
          this.db.exec('DELETE FROM ' + table);
      });
      return safety;
    } finally {
      this.db.exec('DETACH DATABASE saved');
    }
  }
  close() {
    this.db.close();
  }
}
