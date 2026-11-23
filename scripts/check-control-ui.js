import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime, ids } from '../tests/helpers/runtime.js';
import { controlServer } from '../src/control/server.js';
import { random, hash } from '../src/control/auth.js';
const executable = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] &&
    join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!executable) throw Error('Укажите путь к Chrome / Chromium в CHROME_PATH.');
const delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  cleanup = [],
  r = runtime({ after: (fn) => cleanup.push(fn) }),
  profile = mkdtempSync(join(tmpdir(), 'karma-browser-'));
const service = controlServer(r, {
  origin: 'http://127.0.0.1',
  port: 0,
  host: '127.0.0.1',
  guild: ids.guild,
  app: ids.bot,
  secure: false,
});
const address = await service.listen(),
  origin = 'http://127.0.0.1:' + address.port;
service.options.origin = origin;
r.guild.name = 'KARMA · тестовый сервер';
r.results.name = 'объявления';
r.logChannel.name = 'журнал';
const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    '--user-data-dir=' + profile,
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const pending = new Map(),
  errors = [];
let sequence = 0,
  buffer = '';
browser.stdio[4].setEncoding('utf8');
browser.stdio[4].on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
    if (msg.method === 'Runtime.exceptionThrown')
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});
function call(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('CDP timeout ' + method));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
try {
  const target = (await call('Target.createTarget', { url: 'about:blank' })).targetId,
    session = (await call('Target.attachToTarget', { targetId: target, flatten: true })).sessionId;
  const c = (m, p) => call(m, p, session);
  await c('Runtime.enable');
  await c('Network.enable');
  await c('Page.enable');
  const js = async (expression) => {
    const v = await c('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (v.exceptionDetails) throw Error(v.exceptionDetails.exception.description);
    return v.result.value;
  };
  const until = async (expr) => {
    for (let i = 0; i < 80; i++) {
      if (await js(expr)) return;
      await delay(100);
    }
    throw Error('Ожидание ' + expr + ' · ' + (await js('document.body.innerText')).slice(-700));
  };
  const click = async (name) => {
    const e =
      '[...document.querySelectorAll("button")].find(el=>el.textContent.trim()===' +
      JSON.stringify(name) +
      ')';
    await until(e + '!=null');
    await js(e + '.click()');
  };
  const setSession = async (user) => {
    const token = random();
    r.store.run(
      'INSERT INTO control_sessions VALUES(?,?,?,?,?)',
      hash(token),
      ids.guild,
      user,
      JSON.stringify({ id: user, name: 'Александр', username: 'karma-test', avatar: null }),
      Date.now() + 600000,
    );
    await c('Network.setCookie', { url: origin, name: 'karma-session', value: token, httpOnly: true });
  };
  const navigate = async (path) => {
    await c('Page.navigate', { url: origin + path });
    await until('document.readyState==="complete"');
  };
  const page = async (key) => {
    await js('location.hash=' + JSON.stringify(key));
    await until(
      'document.querySelector("main .page")!=null && document.querySelector("main .heading h1, main .hero h1")!=null && location.hash===' +
        JSON.stringify('#' + key),
    );
    await delay(90);
    assert.equal(await js('!!document.querySelector(".errorbox")'), false, key);
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'), true, 'Переполнение ' + key);
  };
  const screenshot = async (name) => {
    if (!process.env.CONTROL_QA_OUTPUT) return;
    await js('document.fonts.ready.then(()=>true)');
    await delay(420);
    const shot = await c('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.CONTROL_QA_OUTPUT, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await c('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate('/');
  await until('!!document.querySelector(".identity-cta")');
  await screenshot('login');
  await navigate('/?auth=error');
  await until('document.body.innerText.includes("Повторить вход через Discord")');
  await setSession(ids.author);
  await navigate('/?state=denied');
  await until('document.body.innerText.includes("Доступ ограничен")');
  await setSession(ids.owner);
  await navigate('/');
  await until('!!document.querySelector(".hero")');
  await screenshot('overview');
  r.client.isReady = () => false;
  await js('location.hash="events"');
  await until('!!document.querySelector(".errorbox")');
  r.client.isReady = () => true;
  await click('Повторить');
  await until('!!document.querySelector("main .page")');
  for (const size of [1440, 1024, 768, 390, 320]) {
    await c('Emulation.setDeviceMetricsOverride', {
      width: size,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const k of [
      'overview',
      'inbox',
      'recruitment',
      'family',
      'events',
      'ticket',
      'tiers',
      'tiers?new=1',
      'embed',
      'publishing',
      'analytics',
      'roles',
      'moderation',
      'audit',
      'settings',
      'commands',
      'help',
      'profile',
      'notifications',
    ])
      await page(k);
    console.log('Маршруты и ширина', size);
  }
  await page('embed');
  await until('!!document.querySelector(".discord")');
  await click('Сохранить черновик');
  await until('location.hash.includes("id=")');
  await click('Подготовить к публикации');
  await until('[...document.querySelectorAll("button")].some(el=>el.textContent==="Опубликовать в Discord")');
  await click('Опубликовать в Discord');
  await until('!!document.querySelector("dialog select")');
  await js('document.querySelector("dialog select").value=' + JSON.stringify(ids.results));
  await click('Итоговый предпросмотр');
  await until('!!document.querySelector("dialog .discord")');
  assert.equal(r.results.saved.size, 0);
  await click('Подтвердить публикацию');
  await until('!!document.querySelector("dialog a[href*=discord]")');
  assert.equal(r.results.saved.size, 1);
  await js('document.querySelector("dialog").close()');
  await page('ticket');
  await click('Предпросмотр');
  await until('!!document.querySelector(".discord")');
  await click('Запустить симулятор');
  await click('Заполнить заявку');
  await until('!!document.querySelector("dialog form")');
  await js(
    'document.querySelector("dialog form input").value="Проверка";document.querySelector("dialog form").requestSubmit()',
  );
  await click('Открыть учебный канал');
  await click('Закрыть учебное обращение');
  await click('Готово');
  assert.equal(r.store.one('SELECT count(*) n FROM tickets').n, 0);
  assert.deepEqual(errors, []);
  console.log('OAuth-экраны, сохранение, итоговый предпросмотр, тестовая публикация и симулятор прошли.');
} finally {
  await call('Browser.close').catch(() => {});
  if (browser.exitCode === null)
    await Promise.race([new Promise((res) => browser.once('exit', res)), delay(2000)]);
  if (browser.exitCode === null) browser.kill();
  await service.close();
  for (const fn of cleanup) await fn();
  rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
