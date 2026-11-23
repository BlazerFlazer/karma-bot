import { requireThat, integer } from '../core/ui.js';
import { recruitQuestions, tierQuestions, reportQuestions } from '../core/catalog.js';
export const priorityLabels = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', critical: 'Критический' };
export const statusLabels = {
  pending: 'Ожидает рассмотрения',
  review: 'На рассмотрении',
  interview: 'Приглашён на обзвон',
  waiting: 'Ожидает проверки',
  accepted: 'Принят',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
  expired: 'Просрочен',
};
export const ticketStates = {
  creating: 'Создаётся',
  open: 'Открыт',
  closed: 'Закрыт',
  archived: 'В архиве',
  deleted: 'Удалён',
  failed: 'Ошибка создания',
};
export const validId = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
export function webUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null;
  } catch {
    return null;
  }
}
export function proofs(raw, domains) {
  const links = raw.trim().split(/\s+/);
  requireThat(links.length > 0 && links.length <= 8, 'Укажите от одной до восьми ссылок.');
  for (const link of links) {
    const u = webUrl(link);
    requireThat(
      u && domains.includes(u.hostname.toLowerCase()),
      'Для доказательства нужен HTTPS URL на разрешённом домене.',
    );
  }
  return links;
}
export function validatePolicy(p) {
  if (p?.naming)
    requireThat(
      typeof p.naming === 'string' &&
        p.naming.includes('{id}') &&
        /^(?:[a-z0-9-]|\{id\}|\{type\}){1,70}$/.test(p.naming),
      'В шаблоне канала нужен {id}.',
    );
  if (p?.staffActions !== undefined)
    requireThat(
      Array.isArray(p.staffActions) &&
        p.staffActions.length <= 24 &&
        p.staffActions.every((s) =>
          [
            'claim',
            'unclaim',
            'transfer',
            'add',
            'remove',
            'rename',
            'close',
            'reopen',
            'archive',
            'priority',
            'escalate',
            'transcript',
            'accept',
            'reject',
            'info',
            'hold',
            'interview',
            'proof',
          ].includes(s),
        ),
      'Неизвестное действие панели.',
    );
  requireThat(
    p && typeof p === 'object' && ['recruit', 'tier', 'support', 'report'].includes(p.kind),
    'Проверьте тип анкеты.',
  );
  for (const key of ['title', 'description', 'welcome', 'category', 'parent', 'log'])
    requireThat(
      typeof p[key] === 'string' && p[key].trim() && p[key].length <= (key === 'title' ? 80 : 350),
      'Проверьте поле ' + key + '.',
    );
  requireThat(
    ['channel', 'thread'].includes(p.mode) && Object.hasOwn(priorityLabels, p.priority),
    'Проверьте режим и приоритет.',
  );
  requireThat(typeof p.emoji === 'string' && p.emoji.length <= 64, 'Проверьте emoji.');
  requireThat(
    Array.isArray(p.access) &&
      p.access.length > 0 &&
      p.access.length <= 20 &&
      p.access.every((k) => typeof k === 'string' && /^[a-z0-9_]{1,32}$/.test(k)),
    'Укажите роли доступа.',
  );
  for (const [k, max, min] of [
    ['limit', 10, 1],
    ['cooldown', 2592000, 0],
    ['autoClose', 8760, 0],
  ])
    requireThat(Number.isInteger(p[k]) && p[k] >= min && p[k] <= max, 'Проверьте ' + k + '.');
  requireThat(
    Array.isArray(p.questions) && p.questions.length >= 1 && p.questions.length <= 20,
    'Допустимо от 1 до 20 вопросов.',
  );
  if (p.allowed !== undefined)
    requireThat(
      Array.isArray(p.allowed) &&
        p.allowed.length <= 20 &&
        p.allowed.every((k) => typeof k === 'string' && /^[a-z0-9_]{1,32}$/.test(k)),
      'Проверьте роли заявителей.',
    );
  const keys = new Set();
  for (const q of p.questions) {
    requireThat(
      q &&
        (!q.input || ['short', 'long', 'select', 'user', 'role', 'channel'].includes(q.input)) &&
        (!q.max || (Number.isInteger(q.max) && q.max > 0 && q.max <= 500)) &&
        (!q.help || (typeof q.help === 'string' && q.help.length <= 100)) &&
        (!q.placeholder || (typeof q.placeholder === 'string' && q.placeholder.length <= 100)) &&
        (!q.validation || ['text', 'digits', 'url'].includes(q.validation)),
      'Проверьте свойства вопроса.',
    );
    if (q.input === 'select')
      requireThat(
        Array.isArray(q.options) &&
          q.options.length > 0 &&
          q.options.length <= 25 &&
          new Set(q.options).size === q.options.length &&
          q.options.every((v) => typeof v === 'string' && v.trim() && v.length <= 100),
        'Проверьте варианты вопроса.',
      );
    requireThat(
      q &&
        /^[a-z][a-z0-9_]{0,30}$/.test(q.key) &&
        !keys.has(q.key) &&
        typeof q.label === 'string' &&
        q.label.length > 0 &&
        q.label.length <= 45 &&
        typeof q.required === 'boolean',
      'Проверьте ключи и названия вопросов.',
    );
    keys.add(q.key);
  }
  const required = { recruit: recruitQuestions, tier: tierQuestions, report: reportQuestions, support: [] }[
    p.kind
  ];
  requireThat(
    required.every((q) =>
      p.questions.some((other) => other.key === q.key && (!q.required || other.required)),
    ),
    'Сохраните обязательные вопросы этой системы.',
  );
  return p;
}
export function validateAnswer(key, value, settings, kind) {
  if (key === 'nick')
    requireThat(
      value.trim().length > 0 && value.length <= 64,
      'Никнейм должен содержать от 1 до 64 символов.',
    );
  if (key === 'static')
    requireThat(/^\d{1,24}$/.test(value), 'Статик должен содержать только цифры, до 24 знаков.');
  if (key === 'age') integer(value, 1, 120, 'возраст OOC');
  if (key === 'target') requireThat(validId(value), 'Укажите Discord ID участника.');
  if (key === 'proof' && kind === 'tier') proofs(value, settings.domains);
}
export function validateQuestion(q, v) {
  requireThat(
    typeof v === 'string' && v.length <= (q.max || 500) && (!q.required || v.trim()),
    'Проверьте ответ «' + q.label + '».',
  );
  if (!v) return;
  if (q.input === 'select') requireThat(q.options.includes(v), 'Выберите вариант из списка.');
  if (['user', 'role', 'channel'].includes(q.input)) requireThat(validId(v), 'Выберите объект Discord.');
  if (q.validation === 'digits') requireThat(/^\d+$/.test(v), 'Введите цифры.');
  if (q.validation === 'url') requireThat(webUrl(v), 'Введите HTTPS-ссылку.');
}
export function blacklistMatch(db, g, user, answers) {
  return db.one(
    "SELECT id FROM blacklisted_members WHERE guild=? AND active=1 AND (expires IS NULL OR expires>?) AND ((kind='discord' AND value=?) OR (kind='static' AND value=?) OR (kind='nick' AND value=?)) LIMIT 1",
    g,
    Date.now(),
    user,
    answers.static || '',
    (answers.nick || '').trim().toLowerCase(),
  );
}
