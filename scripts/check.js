import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.js') ? [path] : [];
  });
}
const paths = ['src', 'scripts', 'tests', 'web/public'].flatMap(files);
for (const path of paths) {
  const run = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(1);
}
console.log('Проверено файлов JS:', paths.length);
