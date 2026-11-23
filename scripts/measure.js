import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { app } from '../src/core/app.js';
const dir = mkdtempSync(join(tmpdir(), 'karma-bench-'));
const runtime = app(dir),
  db = runtime.store,
  client = runtime.client;
try {
  const start = performance.now();
  db.guild('local');
  for (let n = 0; n < 10000; n++) db.audit('local', 'sample', 'tester', String(n));
  console.log(
    JSON.stringify({
      scenario: 'All modules + Discord client offline + SQLite, 10000 audit inserts',
      commands: runtime.commands.length,
      ms: Math.round(performance.now() - start),
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
      peakMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  );
} finally {
  await client.destroy();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
