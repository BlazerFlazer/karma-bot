import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../src/database/store.js';
import { ConfigService } from '../src/core/config.js';
export function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'karma-test-'));
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
test('binding сохраняет snowflake, транзакция откатывается', (t) => {
  const db = fixture(t),
    c = new ConfigService(db),
    id = '999999999999999999';
  c.bind('g', 'role', 'owner', id, 'a');
  assert.equal(c.bindings('g', 'role').owner, id);
  assert.throws(() =>
    db.tx(() => {
      db.run('DELETE FROM configured_roles');
      throw Error();
    }),
  );
  assert.equal(c.bindings('g', 'role').owner, id);
});
test('WAL snapshot восстанавливает данные и не допускает чужой сервер', (t) => {
  const db = fixture(t);
  db.guild('a');
  const snap = db.backup();
  db.audit('a', 'x', 'u', 'u');
  const safety = db.restore(snap, 'a');
  assert.ok(db.listBackups().includes(safety));
  assert.equal(db.one('SELECT COUNT(*) n FROM audit_logs').n, 0);
  db.guild('b');
  assert.throws(() => db.restore(snap, 'a'));
});
