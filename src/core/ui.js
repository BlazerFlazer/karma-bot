import { MessageFlags } from 'discord.js';
export const ephemeral = MessageFlags.Ephemeral;
export function statusPanel(metrics) {
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: safeMentions,
    components: [
      {
        type: 17,
        accent_color: 0x303238,
        components: [
          { type: 10, content: '## KARMA SYSTEM · Состояние бота' },
          { type: 14, spacing: 1, divider: true },
          { type: 10, content: metrics },
        ],
      },
    ],
  };
}
export const safeMentions = { parse: [], repliedUser: false };
export const row = (...components) => ({ type: 1, components });
export const button = (custom_id, label, style = 2) => ({ type: 2, custom_id, label, style });
export const select = (custom_id, placeholder, options) => ({
  type: 3,
  custom_id,
  placeholder,
  options: options.map(([value, label]) => ({ value: String(value), label: String(label).slice(0, 100) })),
});
export const entity = (type, custom_id, placeholder, channel_types) => ({
  type,
  custom_id,
  placeholder,
  ...(channel_types ? { channel_types } : {}),
});
export function card(title, description, components = [], brand = {}) {
  const embed = {
    title: String(title).slice(0, 256),
    description: String(description || '—').slice(0, 4096),
    color: 0x303238,
    footer: { text: 'KARMA SYSTEM' },
  };
  if (brand.logo) embed.thumbnail = { url: brand.logo };
  if (brand.banner) embed.image = { url: brand.banner };
  return { embeds: [embed], components, allowedMentions: safeMentions };
}
export const field = (id, label, opts = {}) =>
  row({
    type: 4,
    custom_id: id,
    label: label.slice(0, 45),
    style: opts.long ? 2 : 1,
    required: opts.required !== false,
    max_length: opts.max || 800,
    ...(opts.placeholder?{placeholder:opts.placeholder.slice(0,100)}:{}),
    ...(opts.value ? { value: String(opts.value).slice(0, opts.max || 800) } : {}),
  });
export const modal = (custom_id, title, ...components) => ({
  custom_id,
  title: title.slice(0, 45),
  components,
});
export class InputError extends Error {}
export function requireThat(condition, message) {
  if (!condition) throw new InputError(message);
}
export async function respond(i, payload) {
  if (typeof payload === 'string') payload = card('KARMA SYSTEM', payload);
  return i.deferred || i.replied
    ? i.editReply(payload)
    : i.reply({ ...payload, flags: (payload.flags || 0) | ephemeral });
}
export function integer(value, min, max, label) {
  const n = Number(value);
  requireThat(
    String(value).trim() !== '' && Number.isSafeInteger(n) && n >= min && n <= max,
    'Проверьте ' + label + '.',
  );
  return n;
}
