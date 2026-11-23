import { mappings, commandPermission } from './rbac.js';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { leaders, recruitment, roles as roleNames } from '../core/catalog.js';

// Descriptions, argument names, flags, choices and registration come from the running bot.
// These annotations explain the parts Discord's command manifest cannot express.
const categories = {
  setup: 'Администрирование',
  diagnostics: 'Администрирование',
  dashboard: 'Администрирование',
  bot: 'Администрирование',
  backup: 'Администрирование',
  security: 'Безопасность',
  ticket: 'Обращения',
  tier: 'Тиры',
  report: 'Жалобы',
  family: 'Семья',
  strike: 'Дисциплина',
  blacklist: 'Дисциплина',
  points: 'Очки',
  rank: 'Очки',
  achievements: 'Очки',
  leaderboard: 'Очки',
  voice: 'Голосовая активность',
  staff: 'Аналитика',
  event: 'Мероприятия',
  poll: 'Голосования',
  giveaway: 'Розыгрыши',
  suggest: 'Предложения',
  suggestion: 'Предложения',
  embed: 'Публикации',
  webhook: 'Публикации',
  rolepanel: 'Роли',
};

const actions = {
  'ticket open':
    'Открывает анкету выбранного типа. После отправки бот проверяет лимиты и создаёт приватное обращение.',
  'ticket panel': 'Размещает в текущем канале сообщение для подачи обращений.',
  'ticket list': 'Показывает до 20 ваших последних обращений, их статус и ссылку на канал.',
  'tier list':
    'Показывает настроенные тиры по порядку с их кодами и требованиями. Код нужен в анкете на тир.',
  'report user': 'Открывает приватную форму жалобы и подставляет выбранного пользователя.',
  'report status': 'Показывает решение и ответственного автору жалобы или уполномоченному проверяющему.',
  'report history': 'Показывает список жалоб, поданных с вашей учётной записи.',
  'family roster':
    'Открывает состав семьи с перелистыванием. Опция publish размещает обновляемую панель в текущем канале и требует прав администратора Discord.',
  'family add': 'Вносит участника в базу семьи с указанными статиком и игровым именем.',
  'family remove': 'После подтверждения исключает участника из состава семьи и сохраняет причину в истории.',
  'family promote': 'Повышает ранг в базе семьи и записывает изменение в историю участника.',
  'family demote': 'Понижает ранг в базе семьи и записывает изменение в историю участника.',
  'family search': 'Ищет по точному статику, Discord ID или части игрового имени.',
  'family note': 'Добавляет служебную заметку в историю участника.',
  'family profile':
    'Показывает игровой ник, ранг, тир и участие в мероприятиях. Статик и дисциплинарные сведения видны владельцу профиля и проверяющим.',
  'family stats': 'Считает участников в составе семьи и показывает, сколько профилей отмечено активными.',
  'family history': 'Открывает последние 20 записей об изменениях профиля с датами и исполнителями.',
  'family inactive': 'Меняет отметку активности в профиле участника и сохраняет изменение в его истории.',
  'strike add':
    'Регистрирует взыскание внутри семьи. Для понижения, исключения, чёрного списка и приостановки появляется подтверждение.',
  'strike remove': 'Снимает действующее взыскание по его номеру и записывает причину в журнал.',
  'strike list': 'Показывает действующие взыскания выбранного участника с основаниями и сроками.',
  'strike history': 'Показывает историю взысканий участника, включая снятые и истёкшие.',
  'strike settings':
    'Без параметра показывает порог уведомлений. С параметром threshold сохраняет новый порог.',
  'blacklist add': 'После подтверждения ограничивает подачу заявок по указанному идентификатору.',
  'blacklist remove': 'Снимает запись с указанным номером и фиксирует основание.',
  'blacklist check': 'Проверяет, действует ли ограничение по выбранному Discord ID, статику или нику.',
  'blacklist history': 'Показывает действующие и завершённые ограничения по выбранному идентификатору.',
  'points add': 'Начисляет очки участнику и сохраняет автора и основание операции.',
  'points remove': 'Списывает указанное число очков и сохраняет запись для проверки баланса.',
  'points history':
    'По умолчанию показывает историю собственного баланса. История другого участника доступна руководителям.',
  rank: 'Показывает персональный уровень и баланс KARMA POINTS.',
  achievements: 'Открывает список достижений, которые участник уже получил.',
  leaderboard: 'Составляет рейтинг по очкам за выбранный период.',
  'staff stats':
    'Показывает рассмотренные заявки, закрытия, нагрузку и время обработки для одного сотрудника.',
  'staff leaderboard': 'Собирает сводку работы сотрудников, включая число решений и сроки ответа.',
  'staff weekly': 'Объединяет решения, закрытия и сроки обработки за последние семь дней.',
  'staff report': 'Показывает рабочую нагрузку и сроки обработки за последние 30 дней.',
  'voice stats':
    'Показывает суммарное время и число голосовых посещений за весь период, семь и тридцать дней.',
  'voice weekly': 'Показывает голосовую активность участников за последние семь дней.',
  'voice leaderboard': 'Ранжирует участников по учтённому голосовому времени за последние 30 дней.',
  'voice reset': 'После подтверждения очищает голосовую статистику выбранного участника.',
  'event create': 'Размещает карточку события в настроенном канале и планирует напоминания.',
  'event edit': 'Меняет параметры запланированного события, обновляет его карточку и расписание напоминаний.',
  'event cancel': 'Помечает запланированное событие отменённым и снимает его напоминания.',
  'event start':
    'Переводит запланированное событие в активное состояние. С этого момента можно подтверждать явку.',
  'event end': 'Завершает начавшееся мероприятие и обновляет состояние его карточки.',
  'event list': 'Открывает расписание запланированных и начавшихся мероприятий этого сервера.',
  'event attendance':
    'Подтверждает присутствие. При включённом модуле очков награда начисляется один раз за мероприятие.',
  'giveaway create': 'Публикует розыгрыш с призом, сроком, числом победителей и условиями участия.',
  'giveaway end': 'Завершает розыгрыш, выбирает победителей из подходящих участников и обновляет карточку.',
  'giveaway cancel': 'Отменяет действующий розыгрыш без выдачи новых результатов.',
  'giveaway reroll': 'Выбирает новых победителей после завершения розыгрыша и обновляет исходное сообщение.',
  'poll create': 'Размещает в текущем канале голосование с выбранными вариантами и сроком окончания.',
  'poll end': 'Закрывает приём голосов и обновляет итоговые результаты в опубликованном сообщении.',
  'poll results': 'Показывает текущие итоги голосования участнику с доступом к каналу исходного сообщения.',
  suggest: 'Публикует предложение в настроенном канале и добавляет кнопки голосования.',
  suggestion: 'Обновляет статус и публичный комментарий в карточке предложения.',
  'embed create': 'Открывает личную форму оформления нового шаблона и предварительный просмотр.',
  'embed edit': 'Загружает сохранённый шаблон в личную форму редактирования.',
  'embed save': 'Копирует существующий шаблон под новым названием.',
  'embed send':
    'Отправляет шаблон в выбранный канал. Указание ID ранее отправленного сообщения обновляет его.',
  'embed list': 'Перечисляет сохранённые на этом сервере шаблоны по названию.',
  'embed delete': 'После подтверждения удаляет шаблон из библиотеки сервера.',
  'webhook create': 'Создаёт вебхук бота в выбранном канале. В ответе отображается его идентификатор.',
  'webhook list': 'Показывает названия и идентификаторы вебхуков бота в одном канале.',
  'webhook delete': 'После подтверждения удаляет указанный вебхук, принадлежащий боту.',
  'webhook send': 'Публикует сохранённый шаблон через вебхук бота в выбранном канале.',
  'rolepanel create':
    'Публикует панель самостоятельного выбора разрешённых ролей с кнопками, списком или реакциями.',
  'rolepanel verify': 'Публикует кнопку верификации для выдачи роли из настроек.',
  'security lockdown':
    'После подтверждения ограничивает отправку сообщений в настроенных публичных семейных каналах.',
  'security release': 'После подтверждения восстанавливает сохранённые права записи в каналах.',
  'backup create': 'Создаёт согласованный снимок SQLite в каталоге резервных копий.',
  'backup list': 'Возвращает доступные имена файлов для восстановления базы.',
  'backup restore': 'После подтверждения сохраняет текущую БД и восстанавливает выбранную копию.',
  setup: 'Открывает личный мастер привязки ролей, каналов и категорий к их назначениям в KARMA.',
  dashboard: 'Открывает личную административную панель Discord с разделами, настройками и журналом.',
  diagnostics: 'Проверяет настроенные назначения, права бота, включённые intents и состояние SQLite.',
  'bot status': 'Возвращает фактические показатели процесса, базы и соединения Discord.',
  ban: 'После подтверждения запрещает участнику возвращаться на сервер Discord до снятия бана.',
  unban: 'Снимает блокировку на сервере по точному Discord ID пользователя.',
  kick: 'После подтверждения исключает участника с сервера Discord.',
  timeout: 'Устанавливает участнику ограничение общения на указанное число минут.',
  untimeout: 'Снимает действующий тайм-аут общения в Discord.',
  warn: 'Добавляет предупреждение в журнал Discord-модерации.',
  warnings: 'Показывает последние предупреждения Discord-модерации для выбранного пользователя.',
  clear: 'После подтверждения удаляет указанное число недавних сообщений в текущем текстовом канале.',
  slowmode: 'Выставляет время в секундах между сообщениями участника в текущем текстовом канале.',
  lock: 'После подтверждения запрещает @everyone отправку сообщений в текущем текстовом канале.',
  unlock: 'Восстанавливает прежнее разрешение записи в канале, закрытом ботом через /lock.',
  nickname: 'Меняет отображаемый серверный ник выбранного участника Discord.',
  'role add': 'Добавляет участнику выбранную роль на сервере Discord и сохраняет основание.',
  'role remove': 'Снимает выбранную роль Discord и сохраняет действие в журнале.',
  'mod history': 'Показывает до 20 последних действий Discord-модерации в отношении участника.',
};

const cautions = {
  setup: 'При совпадающих названиях выберите нужный ресурс в списке вручную.',
  dashboard: 'Для кнопок личной панели требуется актуальный доступ на сервере.',
  diagnostics: 'Удалённую роль или канал можно привязать повторно через /setup.',
  backup:
    'Команды копий доступны владельцу на установке с одним сервером. Восстановление возвращает данные SQLite, а сообщения и роли Discord требуют отдельной сверки.',
  ticket: 'Для создания обращения должны быть настроены категория каналов и роли проверяющих.',
  'ticket panel': 'Перед запуском откройте тот канал, где должны появиться кнопки для участников.',
  report:
    'Проверяйте номер самой жалобы. Доступ к зарегистрированной жалобе зависит от автора, предмета и состава проверяющих.',
  tier: 'Используйте точный код настроенного тира, например tier1. Роль Discord привязывается отдельно.',
  family: 'Сначала найдите правильный профиль. Статик хранится строкой вместе с ведущими нулями.',
  'family roster': 'Оставьте publish выключенным для личного просмотра.',
  strike: 'Для временного исключения укажите срок в днях. Для снятия нужен номер взыскания.',
  blacklist: 'Сверьте вид идентификатора. Статик, Discord ID и никнейм проверяются отдельно.',
  voice:
    'AFK-канал и исключённые категории пропускаются. Длительность учитывает сохранённые периоды связи бота.',
  points: 'Для списания нужен достаточный баланс. Введите причину, понятную при просмотре истории.',
  staff: 'Сравнивайте сроки и нагрузку с числом завершённых обращений за тот же период.',
  event: 'Обозначьте часовой пояс в дате либо используйте настроенное локальное время сервера.',
  'event attendance': 'Присутствие подтверждается после начала мероприятия.',
  giveaway:
    'Проверьте длительность в минутах и роли участия. При подведении итогов роли проверяются повторно.',
  poll: 'Разделите варианты знаком |. Каждый вариант должен иметь своё название.',
  suggest: 'Кнопки предложения появятся в канале предложений, назначенном через /setup.',
  suggestion: 'Укажите номер предложения, указанный в опубликованной карточке.',
  rolepanel:
    'Для публичной панели выберите обычные роли ниже роли бота. Служебные и привилегированные роли защищены.',
  webhook: 'Для действий с вебхуками участнику и боту нужно право управления вебхуками в выбранном канале.',
  embed:
    'Для картинок нужны HTTPS-ссылки. Для редактирования опубликованного сообщения выберите его исходный канал.',
  'embed save': 'Название для копии должно быть свободным.',
  security: 'Снятие аварийного режима выполняется командой /security release.',
  clear: 'Массовое удаление охватывает сообщения младше 14 дней.',
  lock: 'Запрет изменяется для @everyone в том текстовом канале, где вызвали команду.',
  unlock:
    'Обычная разблокировка работает для канала, закрытого через /lock. Для аварийного режима используйте /security release.',
};

const publishes = new Set([
  'ticket panel',
  'family roster',
  'rolepanel create',
  'rolepanel verify',
  'event create',
  'event edit',
  'event start',
  'event end',
  'event cancel',
  'event attendance',
  'poll create',
  'poll end',
  'giveaway create',
  'giveaway end',
  'giveaway reroll',
  'giveaway cancel',
  'suggest',
  'suggestion',
  'embed send',
  'webhook send',
]);

const administrators = new Set([
  'setup',
  'dashboard',
  'diagnostics',
  'embed',
  'webhook',
  'security',
  'rolepanel',
]);
const publicRoots = new Set(['rank', 'achievements', 'leaderboard', 'bot', 'suggest', 'report']);
const publicPaths = new Set([
  'ticket open',
  'ticket list',
  'tier list',
  'family profile',
  'family roster',
  'family stats',
  'voice stats',
  'voice weekly',
  'voice leaderboard',
  'points history',
  'event list',
  'poll results',
]);

function ruleFor(def, sub, module) {
  const root = def.name;
  const path = [root, sub].filter(Boolean).join(' ');
  if (root === 'backup') return 'owner';
  if (administrators.has(root) || ['ticket panel', 'voice reset', 'strike settings'].includes(path))
    return 'admin';
  if (module === 'moderation' && def.default_member_permissions) return 'native';
  if (publicRoots.has(root) || publicPaths.has(path) || def.type === 2 || def.type === 3) return 'public';
  if (root === 'staff' || ['family search', 'family history'].includes(path)) return 'recruitment';
  if (root === 'event' && sub !== 'create') return 'organizer';
  if (['family', 'strike', 'blacklist', 'points', 'event', 'poll', 'giveaway', 'suggestion'].includes(root))
    return 'leaders';
  return def.default_member_permissions ? 'native' : 'unknown';
}

function accessFor(r, actor) {
  const guild = actor.guild;
  const guildId = guild?.id || guild;
  const member = actor.member;
  const userId = member?.id || member?.user?.id;
  const owner = Boolean(userId) && userId === guild?.ownerId;
  const native = (bits) => owner || !!member?.permissions?.has(bits);
  const admin = native(P.Administrator);
  const bindings = r.config.bindings(guildId, 'role');
  const has = (keys) =>
    admin ||
    keys.some((key) => {
      const id = bindings[key];
      return id && id !== guildId && member?.roles?.cache?.has(id);
    });
  const lead = has(leaders);
  // Organizer access is conditional on an actual event in this guild.
  const organizes =
    !lead &&
    !!userId &&
    !!r.store?.one('SELECT 1 FROM events WHERE guild=? AND organizer=? LIMIT 1', guildId, userId);
  return {
    guildId,
    native,
    public: !!userId,
    owner,
    admin,
    leaders: lead,
    recruitment: has(recruitment),
    organizer: lead || organizes,
    unknown: false,
  };
}

const policyLabels = {
  owner: ['Владелец сервера Discord', ['Владелец сервера Discord']],
  admin: ['Discord · Administrator', ['Администраторы Discord']],
  leaders: ['Руководство семьи', [...leaders.map((k) => roleNames[k]), 'Администраторы Discord']],
  recruitment: ['Сотрудники набора', [...recruitment.map((k) => roleNames[k]), 'Администраторы Discord']],
  organizer: [
    'Организатор своего мероприятия или руководство',
    ['Организатор мероприятия', ...leaders.map((k) => roleNames[k]), 'Администраторы Discord'],
  ],
  public: ['Участие на сервере', ['Участники сервера']],
  unknown: ['Проверяется обработчиком команды', []],
};

const examples = {
  user: '@Участник',
  organizer: '@Организатор',
  role: '@Участник семьи',
  role1: '@Объявления',
  channel: '#объявления',
  reason: 'Нарушение правил общения',
  id: '42',
  type: 'join',
  static: '00421',
  nick: 'Alex_Karma',
  query: '00421',
  text: 'Провести тренировку в субботу',
  name: 'Объявление семьи',
  template: 'Объявление семьи',
  as: 'Анонс тренировки',
  title: 'Тренировка',
  location: 'Особняк',
  time: '2030-06-02 20:00',
  capacity: '20',
  amount: '10',
  minutes: '30',
  winners: '1',
  prize: 'Игровой приз',
  question: 'Когда провести сбор?',
  options: 'Суббота|Воскресенье',
  threshold: '3',
  days: '7',
  comment: 'Внесли в план на выходные',
  value: '00421',
  count: '5',
  seconds: '10',
};
function exampleValue(o, root, sub) {
  if (root === 'unban' && o.name === 'id') return '<Discord ID участника>';
  if (root === 'webhook' && o.name === 'id') return '<ID из /webhook list>';
  if (root === 'backup' && sub === 'restore' && o.name === 'name') return '<имя из /backup list>';
  if (root === 'blacklist' && o.name === 'kind') return 'static';
  if (o.choices?.length) return String(o.choices[0].value);
  if (examples[o.name] !== undefined) return examples[o.name];
  if (o.type === 6) return '@Участник';
  if (o.type === 8) return '@Роль';
  if (o.type === 7) return '#канал';
  if (o.type === 4 || o.type === 10) return String(o.min_value ?? 1);
  if (o.type === 5) return 'true';
  return '<' + o.description.toLowerCase() + '>';
}

function leaves(options, path = []) {
  const branches = options.filter((o) => o.type === 1 || o.type === 2);
  if (!branches.length) return [{ path, args: options, description: '' }];
  return branches.flatMap((o) =>
    o.type === 2
      ? leaves(o.options || [], [...path, o.name])
      : [{ path: [...path, o.name], args: o.options || [], description: o.description }],
  );
}
function describeArgument(o) {
  const limits = [];
  if (o.choices?.length) limits.push(o.choices.map((c) => c.name).join(' / '));
  if (o.min_value !== undefined || o.max_value !== undefined)
    limits.push(
      [
        o.min_value === undefined ? '' : 'от ' + o.min_value,
        o.max_value === undefined ? '' : 'до ' + o.max_value,
      ]
        .filter(Boolean)
        .join(' '),
    );
  if (o.max_length !== undefined) limits.push('до ' + o.max_length + ' символов');
  return { name: o.name, description: [o.description, ...limits].join(' · '), required: !!o.required };
}

/** Read-only documentation for commands registered in this running process. */
export function commandCatalog(r, actor) {
  const mapped =
    r.config.store &&
    actor?.member &&
    [...mappings(r.config, actor.guild).keys()].some((id) => actor.member.roles.cache.has(id));
  const access = accessFor(r, actor);
  const moduleStates = new Map();
  function enabled(module) {
    if (!module) return true;
    if (!moduleStates.has(module)) moduleStates.set(module, r.config.enabled(access.guildId, module));
    return moduleStates.get(module);
  }
  const entries = [];
  for (const def of r.commands) {
    const handler = r.routes.get('cmd.' + def.name);
    if (!handler) continue;
    const module = handler.module;
    const contextMenu = def.type === 2 || def.type === 3;
    const category =
      categories[def.name] ||
      (contextMenu ? 'Жалобы' : module === 'moderation' ? 'Модерация' : 'Другие команды');
    for (const leaf of leaves(def.options || [])) {
      const sub = leaf.path.join(' ');
      const path = [def.name, ...leaf.path].join(' ');
      const name = (contextMenu ? '' : '/') + path;
      const rule = ruleFor(def, sub, module);
      const bits = rule === 'native' ? BigInt(def.default_member_permissions) : 0n;
      const effective = commandPermission(def.name, sub);
      const permitted =
        (rule === 'native' ? access.native(bits) : access[rule]) &&
        (!mapped || !effective || actor.permissions.has(effective));
      const [permission, roles] =
        rule === 'native'
          ? [
              'Discord · ' + new PermissionsBitField(bits).toArray().join(', '),
              ['Участники с указанным правом Discord'],
            ]
          : policyLabels[rule];
      const args = leaf.args.map(describeArgument);
      const target = def.type === 2 ? 'участнике' : 'сообщении';
      const menuUsage = 'Контекстное меню на ' + target + ' → Приложения → ' + name;
      const mistake =
        cautions[path] ||
        cautions[def.name] ||
        (module === 'moderation'
          ? 'Проверьте права сотрудника и бота на действие, положение их ролей и канал вызова.'
          : 'Команда работает в контексте текущего сервера Discord.');
      const exampleArgs = leaf.args.filter(
        (o) => o.required || (path === 'ticket open' && o.name === 'type'),
      );
      entries.push({
        name,
        category,
        description:
          actions[path] ||
          leaf.description ||
          def.description ||
          'Открывает форму жалобы на ' +
            (def.type === 2 ? 'участника.' : 'сообщение и сохраняет его доступный контекст.'),
        syntax: contextMenu
          ? menuUsage
          : [name, ...args.map((a) => (a.required ? '<' + a.name + '>' : '[' + a.name + ']'))].join(' '),
        arguments: args,
        permission,
        roles: [...roles],
        private: true,
        publishes: publishes.has(path),
        example: contextMenu
          ? menuUsage
          : [name, ...exampleArgs.map((o) => o.name + ':' + exampleValue(o, def.name, sub))].join(' '),
        mistakes: [mistake],
        related: [],
        status:
          !enabled(module) || (module === 'report' && (contextMenu || sub === 'user') && !enabled('tickets'))
            ? 'Отключена'
            : permitted
              ? 'Доступна'
              : 'Ограничена',
      });
    }
  }
  for (const entry of entries) {
    entry.related = entries
      .filter((other) => other !== entry && other.category === entry.category)
      .slice(0, 3)
      .map((other) => other.name);
  }
  return entries;
}

function guide(id, title, intro, commands, ...steps) {
  return { id, title, intro, commands, steps };
}
export const guides = [
  guide(
    'start',
    'Первый запуск',
    'Подготовьте сервер и проверьте путь одной заявки до подключения остальных сотрудников.',
    ['/setup', '/diagnostics', '/bot status'],
    'В Discord откройте /setup и привяжите существующие роли, каналы и закрытые журналы.',
    'Выполните /diagnostics. Исправьте привязки, помеченные как отсутствующие.',
    'Войдите в KARMA CONTROL через Discord. Для первого назначения полномочий используйте аккаунт владельца сервера.',
  ),
  guide(
    'overview',
    'Обзор и показатели',
    'Рабочий обзор собирает доступные вам данные этого сервера.',
    ['/bot status', '/staff weekly', '/family stats'],
    'Откройте обзор и проверьте состояние соединения бота.',
    'Перейдите в раздел обращений для работы с конкретной заявкой. Права проверяются ещё раз на самой записи.',
    'Для сверки соединения и памяти выполните /bot status в Discord.',
  ),
  guide(
    'ticket-studio',
    'Студия обращений',
    'Тип обращения определяет анкету, приватное пространство и состав проверяющих.',
    ['/ticket open', '/ticket panel', '/setup'],
    'Выберите действующий тип или шаблон с подходящей анкетой.',
    'Проверьте обязательные вопросы, роли проверяющих, категорию и закрытый журнал транскриптов.',
    'Откройте предпросмотр. Сохраните черновик и отдельно подтвердите публикацию в выбранном канале.',
  ),
  guide(
    'inbox',
    'Входящие обращения',
    'Назначение ответственного помогает коллегам видеть, кто уже ведёт обращение.',
    ['/ticket list', '/report status'],
    'Откройте нужную запись и сверьте номер, тип и автора.',
    'Возьмите свободный тикет. Для смены ответственного используйте передачу сотруднику с доступом.',
    'Перед закрытием укажите причину. Транскрипту требуется журнал с подходящими правами просмотра.',
  ),
  guide(
    'recruitment',
    'Рассмотрение заявки',
    'Анкета вступления сохраняет статик как строку, включая ведущие нули.',
    ['/ticket open', '/family profile', '/staff stats'],
    'Заявитель выбирает тип join и заполняет анкету. Если вопросов больше пяти, продолжение открывается отдельной кнопкой.',
    'Проверяющий берёт заявку, согласует время и голосовой канал обзвона или запрашивает сведения.',
    'Примите заявку или укажите причину отклонения. Для принятия нужны соответствующее право и доступ к роли принятого участника.',
  ),
  guide(
    'tiers',
    'Код и настройка тира',
    'Код связывает анкету с определением тира. Например, tier1 может обозначать «Тир 1».',
    ['/tier list', '/ticket open', '/dashboard'],
    'Для нового тира выберите уникальный код. В Discord он начинается со строчной латинской буквы, содержит до 30 символов и может включать цифры, дефис и подчёркивание.',
    'Задайте название, порядок, роль, требования, проверяющих и интервал между заявками. Для изменения существующего тира используйте его прежний код.',
    'Сохраните настройку. Проверьте её через /tier list. Кнопку подачи публикуйте отдельным действием.',
    'При рассмотрении проверьте материал по ссылке лично. Бот проверяет разрешённый HTTPS-домен.',
  ),
  guide(
    'embeds',
    'Шаблоны сообщений',
    'Один шаблон можно использовать для нескольких объявлений.',
    ['/embed create', '/embed edit', '/embed send'],
    'Введите заголовок, описание, цвет и при необходимости HTTPS-ссылку для изображения.',
    'Проверьте поля и кнопки в предпросмотре. В шаблонах поддерживаются переменные семейного бота, например {username} и {server}.',
    'Сохраните черновик. При публикации проверьте канал, а при обновлении — также исходное сообщение.',
  ),
  guide(
    'permissions',
    'Роли и полномочия',
    'Доступ определяется идентификаторами актуальных ролей на сервере.',
    ['/setup', '/diagnostics', '/rolepanel create'],
    'Откройте управление ролями под учётной записью с правом изменения полномочий.',
    'Выберите роль Discord и проверьте операции чтения, изменения и публикации отдельно.',
    'Сохраните разрешения и проверьте доступ с учётной записи сотрудника. Для восстановления исходного доступа используйте владельца сервера.',
    'Панель /rolepanel create предназначена для самостоятельного выбора безопасных ролей участниками.',
  ),
  guide(
    'publishing',
    'Публикация в Discord',
    'Черновик можно подготовить и проверить до отправки в канал.',
    ['/ticket panel', '/embed send', '/webhook send'],
    'Выберите подготовленный материал и откройте окончательный предпросмотр.',
    'Сверьте назначение канала, доступ к нему и права бота отправлять сообщения и встраиваемые материалы.',
    'Подтвердите публикацию и откройте ссылку на результат. Для изменения уже размещённой панели выберите обновление исходного сообщения.',
  ),
  guide(
    'family',
    'Состав и история семьи',
    'Идентифицируйте участника по статику или Discord ID, особенно при совпадающих игровых именах.',
    ['/family search', '/family history', '/family roster'],
    'Найдите участника и откройте профиль. Сохраните ведущие нули при вводе статика.',
    'Перед сменой ранга просмотрите историю. Для служебного комментария используйте /family note.',
    'Откройте /family roster для просмотра состава. Опция publish размещает общую обновляемую панель.',
  ),
  guide(
    'moderation',
    'Модерация и дисциплина',
    'Выговор семьи и действие Discord оформляются в разных журналах.',
    ['/strike add', '/mod history', '/timeout'],
    'Для внутреннего взыскания выберите /strike add. Для ограничения общения на сервере используйте /timeout.',
    'Проверьте положение ролей, участника и срок. Укажите конкретную причину.',
    'Проверьте результат в /strike history или /mod history. Для обжалования участник может открыть тикет типа appeal.',
  ),
  guide(
    'troubleshooting',
    'Если действие недоступно',
    'Проверяйте отдельно состояние бота, право на операцию и доступ к самому каналу или заявке.',
    ['/diagnostics', '/bot status', '/setup'],
    'Проверьте состояние бота. При истекшем сеансе заново войдите через Discord.',
    'Вызовите /diagnostics после переименования, замены или удаления роли и канала.',
    'При ошибке публикации проверьте права в канале и доступность исходного сообщения. При конфликте редактирования заново откройте актуальную версию черновика.',
  ),
];
