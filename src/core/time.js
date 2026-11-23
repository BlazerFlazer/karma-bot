import { requireThat } from './ui.js';
export function eventTime(raw, zone, now = Date.now()) {
  let when;
  if (/(Z|[+-]\d\d:\d\d)$/i.test(raw)) when = Date.parse(raw);
  else {
    const match = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)$/.exec(raw);
    requireThat(match, 'Формат времени: ГГГГ-ММ-ДД ЧЧ:ММ или ISO 8601 со смещением.');
    const [, y, m, d, h, min] = match.map(Number);
    const desired = Date.UTC(y, m - 1, d, h, min);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const local = (ts) => {
      const p = Object.fromEntries(fmt.formatToParts(ts).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    };
    const norm = new Date(desired);
    requireThat(
      norm.getUTCMonth() === m - 1 &&
        norm.getUTCDate() === d &&
        norm.getUTCHours() === h &&
        norm.getUTCMinutes() === min,
      'Некорректная дата.',
    );
    const candidates = new Set();
    for (const probe of [desired - 86400000, desired, desired + 86400000]) {
      const offset = local(probe) - probe,
        utc = desired - offset;
      if (local(utc) === desired) candidates.add(utc);
    }
    requireThat(candidates.size === 1, 'При переходе часов укажите явное смещение UTC.');
    [when] = candidates;
  }
  requireThat(Number.isFinite(when) && when > now, 'Укажите будущую дату и время.');
  return when;
}
