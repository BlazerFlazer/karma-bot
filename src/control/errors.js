export class ControlError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function check(condition, status, message) {
  if (!condition) throw new ControlError(status, message);
}
export const string = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
export const snow = (v) => typeof v === 'string' && /^\d{17,20}$/.test(v);
export function object(v) {
  check(v && typeof v === 'object' && !Array.isArray(v), 400, 'Ожидается объект.');
  return v;
}
export function requirePermission(actor, key) {
  check(actor.permissions.has(key), 403, 'Для этого действия требуется другое разрешение.');
}
export const pageOffset = (v) => Math.max(0, Math.min(100000, Number.parseInt(v) || 0));
