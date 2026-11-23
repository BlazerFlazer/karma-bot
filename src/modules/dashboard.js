import { PermissionFlagsBits as P } from 'discord.js';
import { cmd, sub, str } from '../core/router.js';
import { defaults, moduleNames, types } from '../core/catalog.js';
import { management, assignable } from '../core/access.js';
import { row, button, select, field, modal, card, respond, requireThat, statusPanel } from '../core/ui.js';
import { validatePolicy, validId, webUrl, ticketStates } from './forms.js';
import { roster } from './family.js';
import { stats } from './staff.js';
const sections = {
  home: 'Обзор',
  tickets: 'Обращения',
  recruit: 'Набор',
  tier: 'Система тиров',
  family: 'Состав семьи',
  moderation: 'Модерация',
  security: 'Безопасность',
  events: 'Мероприятия',
  analytics: 'Аналитика',
  roles: 'Роли',
  embeds: 'Шаблоны',
  audit: 'Журнал действий',
  settings: 'Настройки',
  backup: 'Резервные копии',
};
const groups = {
  brand: ['logo', 'banner', 'welcomeText', 'goodbyeText'],
  applications: ['acceptRole', 'rejectHours', 'nickname', 'domains', 'removeOnAccept'],
  points: ['attendancePoints', 'trainingPoints', 'achievementRewards'],
  general: ['timezone', 'retentionDays', 'reminders', 'excludedVoice', 'strikeThreshold'],
  protection: [
    'trustedRoles',
    'trustedUsers',
    'bannedWords',
    'blockedDomains',
    'antiInvite',
    'securityDelete',
    'logContent',
    'floodLimit',
    'mentionLimit',
    'raidLimit',
  ],
  roles: ['autoRole', 'verificationRole', 'minAccountDays'],
};
const groupNames = {
  brand: 'Оформление и приветствия',
  applications: 'Набор и тиры',
  general: 'Сроки, события и активность',
  points: 'Очки и награды',
  protection: 'Фильтры и безопасность',
  roles: 'Выдача ролей',
};
export function validateSettings(cfg) {
  for (const [k, v] of Object.entries(defaults)) {
    const x = cfg[k];
    if (Array.isArray(v)) requireThat(Array.isArray(x) && x.length <= 100, 'Проверьте список ' + k + '.');
    else requireThat(typeof x === typeof v, 'Проверьте тип ' + k + '.');
  }
  for (const [key, min, max] of [
    ['retentionDays', 1, 365],
    ['minAccountDays', 0, 365],
    ['rejectHours', 0, 8760],
    ['strikeThreshold', 1, 30],
    ['floodLimit', 2, 100],
    ['mentionLimit', 2, 100],
    ['raidLimit', 2, 100],
    ['attendancePoints', 0, 1000],
    ['trainingPoints', 0, 1000],
  ])
    requireThat(Number.isInteger(cfg[key]) && cfg[key] >= min && cfg[key] <= max, 'Проверьте ' + key + '.');
  requireThat(
    cfg.reminders.every((v) => Number.isInteger(v) && v >= 1 && v <= 10080) && cfg.reminders.length <= 10,
    'Проверьте интервалы напоминаний.',
  );
  for (const k of ['domains', 'blockedDomains'])
    requireThat(
      cfg[k].every((d) => typeof d === 'string' && /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(d)),
      'Укажите точные домены в нижнем регистре.',
    );
  for (const k of ['trustedUsers', 'trustedRoles', 'excludedVoice'])
    requireThat(cfg[k].every(validId), 'Проверьте ID в ' + k + '.');
  for (const k of ['verificationRole', 'autoRole'])
    requireThat(!cfg[k] || validId(cfg[k]), 'Проверьте ID роли.');
  requireThat(
    cfg.bannedWords.every((w) => typeof w === 'string' && w.trim() && w.length <= 80),
    'Проверьте фильтр слов.',
  );
  for (const k of ['logo', 'banner'])
    requireThat(!cfg[k] || webUrl(cfg[k]), 'Укажите HTTPS-ссылку на изображение.');
  for (const k of ['welcomeText', 'goodbyeText'])
    requireThat(cfg[k].length <= 1200, 'Текст слишком длинный.');
  try {
    new Intl.DateTimeFormat('ru', { timeZone: cfg.timezone });
  } catch {
    requireThat(false, 'Неизвестный часовой пояс IANA.');
  }
  requireThat(/^[a-z0-9_]{1,32}$/.test(cfg.acceptRole), 'Укажите ключ или ID роли принятия.');
  requireThat(
    cfg.removeOnAccept.length <= 5 &&
      cfg.removeOnAccept.every((k) => typeof k === 'string' && /^[a-z0-9_]{1,32}$/.test(k)),
    'Проверьте список снимаемых ролей.',
  );
  requireThat(
    cfg.achievementRewards.length <= 20 &&
      cfg.achievementRewards.every(
        (x) =>
          x &&
          typeof x.title === 'string' &&
          x.title.length > 0 &&
          x.title.length <= 80 &&
          Number.isInteger(x.points) &&
          x.points > 0 &&
          Number.isInteger(x.bonus) &&
          x.bonus >= 0 &&
          x.bonus <= 1000,
      ),
    'Проверьте пороги и награды достижений.',
  );
  return cfg;
}
export function botStatus(r) {
  const m = process.memoryUsage(),
    p = r.client.ws.ping;
  return [
    'Время работы: ' + Math.floor(process.uptime() / 60) + ' мин',
    'Память процесса: ' +
      (m.rss / 1048576).toFixed(1) +
      ' МиБ · heap ' +
      (m.heapUsed / 1048576).toFixed(1) +
      ' МиБ',
    'WebSocket: ' + (p < 0 ? 'нет замера' : p + ' мс'),
    'SQLite: ' + r.store.one('SELECT sqlite_version() v').v,
  ].join('\n');
}
function nav(section, page) {
  return [
    row(select('dsection', 'Перейти в раздел', Object.entries(sections))),
    row(
      button('dgo:home:0', 'На главную'),
      ...(section !== 'home'
        ? [
            button('dgo:' + section + ':' + Math.max(0, page - 1), 'Назад'),
            button('dgo:' + section + ':' + (page + 1), 'Далее'),
          ]
        : []),
    ),
  ];
}
function view(r, g, section = 'home', page = 0) {
  requireThat(Object.hasOwn(sections, section), 'Неизвестный раздел.');
  page = Math.max(0, Math.min(Number(page) || 0, 10000));
  const db = r.store,
    rows = [],
    actions = [],
    bindings = r.config.bindings(g, 'role'),
    offset = page * 10;
  const list = (sql, ...args) => db.all(sql + ' LIMIT 10 OFFSET ?', ...args, offset);
  const count = (sql, ...args) => db.one(sql, ...args).n;
  if (section === 'home') {
    rows.push(
      'Состав семьи: ' + count('SELECT count(*) n FROM family_members WHERE guild=?', g),
      'Открытые обращения: ' + count("SELECT count(*) n FROM tickets WHERE guild=? AND state='open'", g),
    );
    for (const [k, label] of [
      ['recruit', 'Заявки на вступление'],
      ['tier', 'Заявки на тир'],
      ['report', 'Жалобы'],
    ])
      rows.push(
        label +
          ': ' +
          count(
            "SELECT count(*) n FROM tickets WHERE guild=? AND state='open' AND json_extract(policy,'$.kind')=?",
            g,
            k,
          ),
      );
    rows.push(
      'Предстоящие мероприятия: ' +
        count("SELECT count(*) n FROM events WHERE guild=? AND state='scheduled'", g),
      '',
      botStatus(r),
    );
  }
  if (['tickets', 'recruit'].includes(section)) {
    const ts = list(
      'SELECT id,state,author,channel FROM tickets WHERE guild=? ' +
        (section === 'recruit' ? "AND json_extract(policy,'$.kind')='recruit' " : '') +
        'ORDER BY id DESC',
      g,
    );
    rows.push(
      ...ts.map(
        (t) =>
          '#' +
          t.id +
          ' · ' +
          ticketStates[t.state] +
          ' · <@' +
          t.author +
          '>' +
          (t.channel ? ' · <#' + t.channel + '>' : ''),
      ),
    );
    actions.push(row(button('typeedit', 'Настроить тип или анкету'), button('typekeys', 'Список типов')));
  }
  if (section === 'tier') {
    rows.push(
      ...list(
        "SELECT key,config FROM tier_definitions WHERE guild=? ORDER BY json_extract(config,'$.order'),key",
        g,
      ).map((t) => t.key + ' · ' + JSON.parse(t.config).title),
    );
    actions.push(row(button('tieredit', 'Создать или изменить тир')));
  }
  if (section === 'family') rows.push(roster(r, g, page).embeds[0].description);
  if (section === 'analytics') rows.push(stats(db, g, Date.now() - 7 * 86400000).embeds[0].description);
  if (section === 'moderation')
    rows.push(
      ...list('SELECT id,action,user,actor FROM moderation_cases WHERE guild=? ORDER BY id DESC', g).map(
        (x) => '#' + x.id + ' · ' + x.action + ' · <@' + x.user + '> · <@' + x.actor + '>',
      ),
    );
  if (section === 'security') {
    rows.push(
      ...list(
        "SELECT id,detail FROM audit_logs WHERE guild=? AND action='security.alert' ORDER BY id DESC",
        g,
      ).map((x) => '#' + x.id + ' · ' + JSON.parse(x.detail).label),
    );
    actions.push(row(button('settingsedit:protection', 'Изменить фильтры')));
  }
  if (section === 'events')
    rows.push(
      ...list('SELECT id,title,start FROM events WHERE guild=? ORDER BY start DESC', g).map(
        (e) => '#' + e.id + ' · ' + e.title + ' · <t:' + Math.floor(e.start / 1000) + ':f>',
      ),
    );
  if (section === 'roles') {
    rows.push(...Object.entries(bindings).map(([k, id]) => k + ' · <@&' + id + '>'));
    actions.push(
      row(button('settingsedit:roles', 'Настроить автовыдачу'), button('sethome', 'Привязать роли')),
    );
  }
  if (section === 'embeds')
    rows.push(
      ...list('SELECT name FROM embed_templates WHERE guild=? ORDER BY name', g).map((x) => x.name),
      'Создание и публикация через /embed.',
    );
  if (section === 'audit') {
    rows.push(
      ...list('SELECT * FROM audit_logs WHERE guild=? ORDER BY id DESC', g).map(
        (x) =>
          '#' +
          x.id +
          ' · <t:' +
          Math.floor(x.time / 1000) +
          ':f> · ' +
          x.action +
          ' · ' +
          x.actor +
          ' → ' +
          x.target,
      ),
    );
    actions.push(row(button('auditopen', 'Открыть событие по номеру')));
  }
  if (section === 'settings') {
    rows.push('Выберите группу настроек. Изменения применяются после просмотра и подтверждения.');
    actions.push(
      row(select('settingsgroup', 'Группа настроек', Object.entries(groupNames))),
      row(
        select(
          'toggle',
          'Включить или отключить модуль',
          Object.entries(moduleNames).map(([k, v]) => [
            k,
            v + ' · ' + (r.config.enabled(g, k) ? 'вкл' : 'выкл'),
          ]),
        ),
      ),
    );
  }
  if (section === 'backup') {
    rows.push(
      ...r.store.listBackups().map((n) => '\u2022 ' + n),
      'Восстановление доступно владельцу через /backup restore.',
    );
    actions.push(row(button('backnew', 'Создать копию'), button('jobs', 'Задачи с ошибками')));
  }
  return card(
    'KARMA Management · ' + sections[section],
    rows.join('\n') || 'Записей пока нет.',
    [...actions, ...nav(section, page)],
    r.config.settings(g),
  );
}
export const codeCheck = (key) =>
  requireThat(
    /^[a-z][a-z0-9_-]{0,29}$/.test(key) && !['constructor', 'prototype'].includes(key),
    'Код должен состоять из латинских букв, цифр, дефиса или подчёркивания.',
  );
export const tierSeed = {
  title: 'Тир 1',
  description: '',
  requirements: '',
  role: '',
  order: 1,
  cooldown: 86400,
  reviewers: ['high', 'leader', 'owner'],
};
export function installDashboard(r) {
  const db = r.store;
  r.command(cmd('bot', 'Состояние приложения', sub('status', 'Память, соединение и SQLite')), (i) =>
    respond(i, statusPanel(botStatus(r))),
  );
  r.command(
    {
      ...cmd('dashboard', 'Панель управления KARMA'),
      default_member_permissions: P.Administrator.toString(),
    },
    (i) => {
      management(i);
      return respond(i, view(r, i.guildId));
    },
  );
  r.on('dgo', (i, [s, p]) => {
    management(i);
    return i.update(view(r, i.guildId, s, p));
  });
  r.on('dsection', (i) => {
    management(i);
    return i.update(view(r, i.guildId, i.values[0], 0));
  });
  r.on('auditopen', (i) => {
    management(i);
    return i.showModal(modal('auditread', 'Запись журнала', field('id', 'Номер события', { max: 15 })));
  });
  r.on('auditread', (i) => {
    management(i);
    const x = db.one(
      'SELECT * FROM audit_logs WHERE guild=? AND id=?',
      i.guildId,
      i.fields.getTextInputValue('id'),
    );
    requireThat(x, 'Событие не найдено.');
    return respond(
      i,
      card(
        'Событие #' + x.id,
        x.action +
          ' · <t:' +
          Math.floor(x.time / 1000) +
          ':f>\nИсполнитель: ' +
          x.actor +
          '\nОбъект: ' +
          x.target +
          '\n' +
          JSON.stringify(JSON.parse(x.detail), null, 2),
      ),
    );
  });
  r.on('toggle', (i) => {
    management(i);
    const k = i.values[0];
    requireThat(Object.hasOwn(moduleNames, k), 'Неизвестный модуль.');
    return r.preview(
      i,
      'toggle',
      { k, on: !r.config.enabled(i.guildId, k) },
      (r.config.enabled(i.guildId, k) ? 'Отключить' : 'Включить') + ' модуль «' + moduleNames[k] + '»?',
    );
  });
  r.confirm('toggle', (i, { k, on }) => {
    management(i);
    db.run('INSERT OR REPLACE INTO module_settings VALUES(?,?,?)', i.guildId, k, Number(on));
    db.audit(i.guildId, 'settings.module', i.user.id, k, { on });
    if (k === 'voice' && !on)
      db.run('UPDATE voice_sessions SET ended=last_seen WHERE guild=? AND ended IS NULL', i.guildId);
    return respond(i, view(r, i.guildId, 'settings'));
  });
  function settingsForm(i, k) {
    management(i);
    requireThat(Object.hasOwn(groups, k), 'Неизвестная группа.');
    const cfg = r.config.settings(i.guildId),
      value = Object.fromEntries(groups[k].map((n) => [n, cfg[n]]));
    return i.showModal(
      modal(
        'cfgsave:' + k,
        groupNames[k],
        field('json', 'Параметры JSON', { value: JSON.stringify(value, null, 2), long: true, max: 4000 }),
      ),
    );
  }
  r.on('settingsgroup', (i) => settingsForm(i, i.values[0]));
  r.on('settingsedit', (i, [k]) => settingsForm(i, k));
  function parse(i) {
    try {
      return JSON.parse(i.fields.getTextInputValue('json'));
    } catch {
      requireThat(false, 'Проверьте синтаксис JSON.');
    }
  }
  r.on('cfgsave', (i, [k]) => {
    management(i);
    const d = parse(i);
    requireThat(
      d && typeof d === 'object' && Object.keys(d).every((n) => groups[k]?.includes(n)),
      'Неизвестный параметр.',
    );
    validateSettings({ ...r.config.settings(i.guildId), ...d });
    return r.preview(i, 'cfg', { d }, JSON.stringify(d, null, 2).slice(0, 3500));
  });
  r.confirm('cfg', (i, { d }) => {
    management(i);
    const cfg = validateSettings({ ...r.config.settings(i.guildId), ...d });
    r.config.save(i.guildId, cfg, i.user.id);
    return respond(i, view(r, i.guildId, 'settings'));
  });
  for (const [route, kind] of [
    ['typeedit', 'type'],
    ['tieredit', 'tier'],
  ]) {
    r.on(route, (i) => {
      management(i);
      return i.showModal(
        modal(
          'editkey:' + kind,
          'Выберите конфигурацию',
          field('key', kind === 'tier' ? 'Код тира · например tier1' : 'Код типа · например support', {
            max: 30,
            placeholder:
              kind === 'tier'
                ? 'Новый код или код из /tier list'
                : 'Введите код новой или существующей категории',
          }),
        ),
      );
    });
  }
  r.on('typekeys', (i) => {
    management(i);
    return respond(
      i,
      card(
        'Типы обращений',
        Object.entries(r.config.types(i.guildId))
          .map(([k, p]) => k + ' · ' + p.title)
          .join('\n'),
      ),
    );
  });
  r.on('editkey', (i, [kind]) => {
    management(i);
    const key = i.fields.getTextInputValue('key').trim();
    codeCheck(key);
    return respond(
      i,
      card('Редактор · ' + key, 'Откройте форму параметров.', [
        row(button('editconfig:' + kind + ':' + key, 'Открыть форму', 1)),
      ]),
    );
  });
  r.on('editconfig', (i, [kind, key]) => {
    management(i);
    codeCheck(key);
    const d =
      kind === 'tier'
        ? JSON.parse(
            db.one('SELECT config FROM tier_definitions WHERE guild=? AND key=?', i.guildId, key)?.config ||
              'null',
          ) || tierSeed
        : r.config.types(i.guildId)[key] || types.support;
    return i.showModal(
      modal(
        'saveconfig:' + kind + ':' + key,
        'Настройки · ' + key,
        field('json', 'Параметры JSON', { value: JSON.stringify(d, null, 2), long: true, max: 4000 }),
      ),
    );
  });
  r.on('saveconfig', (i, [kind, key]) => {
    management(i);
    const d = parse(i);
    validateStudioConfig(kind, key, d);
    return r.preview(i, 'saveconfig', { kind, key, d }, JSON.stringify(d, null, 2).slice(0, 3600));
  });
  r.confirm('saveconfig', async (i, { kind, key, d }) => {
    management(i);
    await saveStudioConfig(r, i, kind, key, d);
    return respond(i, 'Конфигурация сохранена.');
  });
  r.command(
    cmd('tier', 'Доступные тиры', sub('list', 'Требования и коды тиров')),
    (i) => {
      const rows = db.all(
        "SELECT key,config FROM tier_definitions WHERE guild=? ORDER BY json_extract(config,'$.order'),key LIMIT 40",
        i.guildId,
      );
      return respond(
        i,
        card(
          'Тиры семьи',
          rows
            .map((t) => {
              const d = JSON.parse(t.config);
              return '**' + d.title + '** · код ' + t.key + '\n' + d.description + ' ' + d.requirements;
            })
            .join('\n') || 'Тиры пока не настроены.',
        ),
      );
    },
    { module: 'tier' },
  );
  const owner = (i) => {
    requireThat(i.user.id === i.guild.ownerId, 'Только владелец сервера может управлять копиями.');
    requireThat(
      r.client.guilds.cache.size === 1 && !db.one('SELECT 1 FROM guild_settings WHERE guild<>?', i.guildId),
      'Копии через Discord доступны для установки на одном сервере.',
    );
  };
  r.command(
    cmd(
      'backup',
      'Резервное копирование',
      sub('create', 'Создать копию'),
      sub('list', 'Список копий'),
      sub('restore', 'Восстановить копию', str('name', 'Имя копии')),
    ),
    (i) => {
      owner(i);
      const a = i.options.getSubcommand();
      if (a === 'list')
        return respond(i, card('Резервные копии', db.listBackups().join('\n') || 'Копий нет.'));
      if (a === 'create') return respond(i, 'Сохранено: ' + db.backup());
      const name = i.options.getString('name');
      requireThat(db.listBackups().includes(name), 'Копия не найдена.');
      return r.preview(
        i,
        'restore',
        { name },
        'Заменить текущие данные копией ' +
          name +
          '? Перед восстановлением будет сохранена текущая база. Права и сообщения в Discord существуют отдельно.',
      );
    },
    { defer: true },
  );
  r.on(
    'backnew',
    (i) => {
      owner(i);
      return respond(i, 'Сохранено: ' + db.backup());
    },
    { defer: true },
  );
  r.confirm('restore', (i, { name }) => {
    owner(i);
    requireThat(
      r.busy === 1 && !r.scheduler?.running && !r.locks.active.size && !r.gatewayBusy,
      'Идёт другая операция. Повторите подтверждение позже.',
    );
    const safety = db.restore(name, i.guildId);
    r.scheduler?.recover();
    db.audit(i.guildId, 'backup.restore', i.user.id, name, { safety });
    return respond(i, 'База восстановлена. Предыдущая версия: ' + safety);
  });
  r.on('jobs', (i) => {
    management(i);
    const rows = db.all(
      "SELECT key FROM scheduled_tasks WHERE guild=? AND state='failed' ORDER BY due LIMIT 25",
      i.guildId,
    );
    return respond(
      i,
      card(
        'Задачи с ошибками',
        'После исправления настроек выберите задачу для повторной попытки.',
        rows.length
          ? [
              row(
                select(
                  'jobretry',
                  'Повторить задачу',
                  rows.map((x) => [x.key, x.key]),
                ),
              ),
            ]
          : [],
      ),
    );
  });
  r.on('jobretry', (i) => {
    management(i);
    db.run(
      "UPDATE scheduled_tasks SET attempts=0,state='pending',due=? WHERE guild=? AND key=? AND state='failed'",
      Date.now(),
      i.guildId,
      i.values[0],
    );
    return respond(i, 'Задача возвращена в очередь.');
  });
}

export function validateStudioConfig(kind, key, d) {
  codeCheck(key);
  if (kind === 'tier') {
    requireThat(
      d &&
        validId(d.role) &&
        typeof d.title === 'string' &&
        d.title.length > 0 &&
        d.title.length <= 80 &&
        Number.isInteger(d.order) &&
        Math.abs(d.order) <= 1000 &&
        Number.isInteger(d.cooldown) &&
        d.cooldown >= 0 &&
        d.cooldown <= 2592000 &&
        Array.isArray(d.reviewers) &&
        d.reviewers.length > 0 &&
        d.reviewers.length <= 20 &&
        d.reviewers.every((k) => typeof k === 'string' && /^[a-z0-9_]+$/.test(k)) &&
        typeof d.description === 'string' &&
        typeof d.requirements === 'string',
      'Проверьте поля тира, роль и проверяющих.',
    );
    if (d.questions) validatePolicy({ ...types.tier, questions: d.questions });
    if (d.domains !== undefined)
      requireThat(
        Array.isArray(d.domains) &&
          d.domains.length <= 40 &&
          d.domains.every((x) => typeof x === 'string' && /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(x)),
        'Проверьте домены доказательств.',
      );
  } else {
    validatePolicy(d);
    if (Object.hasOwn(types, key))
      requireThat(types[key].kind === d.kind, 'У встроенного типа сохраните вид анкеты.');
    requireThat(
      key !== 'staff' || d.mode === 'channel',
      'Жалобы на администрацию требуют отдельного канала.',
    );
  }
}
export async function saveStudioConfig(r, i, kind, key, d, beforeWrite = () => {}, afterWrite = () => {}) {
  const db = r.store;
  validateStudioConfig(kind, key, d);
  if (kind === 'tier') assignable(i.guild, await i.guild.roles.fetch(d.role), r.config, true);
  if (kind === 'type' && !Object.hasOwn(r.config.types(i.guildId), key))
    requireThat(
      Object.keys(r.config.types(i.guildId)).length < 25,
      'Публичная панель поддерживает 25 типов.',
    );
  const table = kind === 'tier' ? 'tier_definitions' : 'ticket_types';
  db.tx(() => {
    beforeWrite();
    db.run('INSERT OR REPLACE INTO ' + table + ' VALUES(?,?,?)', i.guildId, key, JSON.stringify(d));
    db.audit(i.guildId, 'settings.' + kind, i.user.id, key, { after: d });
    afterWrite();
  });
}
