export function redact(value) {
  if (typeof value === 'string')
    return value
      .replace(/https?:\/\/[^\s/]+\/api(?:\/v\d+)?\/webhooks\/\d+\/[^\s]+/gi, '[webhook]')
      .replace(/(?:mfa\.[\w-]{20,}|[\w-]{18,}\.[\w-]{5,}\.[\w-]{16,})/g, '[секрет]')
      .replace(/(?:token|password|пароль|токен|authorization|cookie)\s*[:=]\s*\S+/gi, '[секрет]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|password|authorization|cookie|secret/i.test(k) ? '[секрет]' : redact(v),
      ]),
    );
  return value;
}
