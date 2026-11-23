import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../src/database/store.js';
import { ConfigService } from '../src/core/config.js';
import { types } from '../src/core/catalog.js';
import { reserve, ticketRow, ticketPanel } from '../src/modules/tickets.js';
import { proofs, validatePolicy } from '../src/modules/forms.js';
import { escapeHtml } from '../src/services/transcript.js';
test('Анкеты и домены проходят строгую проверку', () => {
  Object.values(types).forEach(validatePolicy);
  assert.throws(() => proofs('https://youtube.com.bad.example/a', ['youtube.com']));
  assert.throws(() => proofs('https://youtube.com@bad.example/', ['youtube.com']));
  assert.deepEqual(proofs('https://youtube.com/a', ['youtube.com']), ['https://youtube.com/a']);
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
});
test('Резервирование переживает перезапуск и блокирует повторную форму', () => {
  const dir = mkdtempSync(join(tmpdir(), 'karma-ticket-'));
  let store = new DatabaseService(dir);
  try {
    store.guild('g');
    const r = { store, config: new ConfigService(store) },
      i = { guildId: 'g', user: { id: 'user' } },
      d = { key: 'join', policy: types.join, answers: { static: '00013', nick: 'Тест' } };
    const id = reserve(r, i, d);
    assert.throws(() => reserve(r, i, d));
    store.close();
    store = new DatabaseService(dir);
    const t = ticketRow(store, 'g', id);
    assert.equal(JSON.parse(t.answers).static, '00013');
    assert.throws(() => ticketRow(store, 'another', id));
    assert.match(ticketPanel({ store }, { ...t, state: 'open' }).embeds[0].description, /00013/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
