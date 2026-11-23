import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
export function logger(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'runtime.log');
  return (event, error) => {
    const entry = {
      time: new Date().toISOString(),
      event,
      kind: error?.name?.replace(/[^a-z0-9_]/gi, '').slice(0, 60),
      code: String(error?.code || '')
        .replace(/[^a-z0-9_-]/gi, '')
        .slice(0, 32),
      location: error?.stack
        ?.split('\n')
        .slice(1)
        .find((x) => x.includes('/src/') || x.includes('\\src\\'))
        ?.replace(/^.*[\\/]src[\\/]/, 'src/')
        .slice(0, 150),
    };
    const line = JSON.stringify(entry);
    console.log(line);
    try {
      if (existsSync(file) && statSync(file).size > 256 * 1024) {
        if (existsSync(file + '.1')) unlinkSync(file + '.1');
        renameSync(file, file + '.1');
      }
      appendFileSync(file, line + '\n');
    } catch {
      console.error('Запись локального журнала недоступна.');
    }
  };
}
