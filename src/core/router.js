import { Events } from 'discord.js';
import { button, card, ephemeral, InputError, requireThat, respond, row } from './ui.js';
import { Locks } from './access.js';
import { interactionPermission, nativeAllowed } from '../control/rbac.js';

export const opt = (type, name, description, required = true, extra = {}) => ({
  type,
  name,
  description,
  required,
  ...extra,
});
export const sub = (name, description, ...options) => ({ type: 1, name, description, options });
export const cmd = (name, description, ...options) => ({
  type: 1,
  name,
  description,
  options,
  contexts: [0],
  integration_types: [0],
});
export const menu = (name, type) => ({ name, type, contexts: [0], integration_types: [0] });
export const str = (name, label, required = true, extra = {}) => opt(3, name, label, required, extra);
export const num = (name, label, required = true, min = 1, max = 1000000) =>
  opt(4, name, label, required, { min_value: min, max_value: max });
export const user = (name = 'user', label = 'Участник', required = true) => opt(6, name, label, required);
export const ch = (name = 'channel', label = 'Текстовый канал', required = true) =>
  opt(7, name, label, required, { channel_types: [0] });
export const role = (name = 'role', label = 'Роль', required = true) => opt(8, name, label, required);
export const choices = (...pairs) => ({ choices: pairs.map(([value, name]) => ({ value, name })) });
export class InteractionRouter {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.commands = [];
    this.routes = new Map();
    this.confirmations = new Map();
    this.locks = new Locks();
    this.busy = 0;
    this.on(
      'confirm',
      async (i, [id]) => {
        const d = this.readDraft(i, id, 'confirm');
        requireThat(
          this.store.run('DELETE FROM drafts WHERE id=?', id).changes,
          'Подтверждение использовано.',
        );
        requireThat(
          nativeAllowed(this.config, i.guild, i.member, interactionPermission(d.action, [], i, d.data)),
          'Доступ к действию изменился.',
        );
        const action = this.confirmations.get(d.action);
        requireThat(action, 'Подтверждение устарело.');
        return action(i, d.data);
      },
      { defer: true },
    );
  }
  command(def, fn, options = {}) {
    this.commands.push(def);
    this.on('cmd.' + def.name, fn, options);
  }
  on(key, fn, options = {}) {
    if (this.routes.has(key)) throw new Error('Duplicate route ' + key);
    this.routes.set(key, { fn, ...options });
  }
  confirm(key, fn) {
    this.confirmations.set(key, fn);
  }
  preview(i, action, data, description) {
    const id = this.store.draft(i.guildId, i.user.id, 'confirm', { action, data }, 300000);
    return respond(
      i,
      card('Подтверждение действия', description, [row(button('confirm:' + id, 'Подтвердить', 4))]),
    );
  }
  readDraft(i, id, kind) {
    const d = this.store.one(
      'SELECT data FROM drafts WHERE id=? AND guild=? AND user=? AND kind=? AND expires>?',
      id,
      i.guildId,
      i.user.id,
      kind,
      Date.now(),
    );
    requireThat(d, 'Форма устарела или принадлежит другому участнику.');
    return JSON.parse(d.data);
  }
  enabled(i, module) {
    requireThat(this.config.enabled(i.guildId, module), 'Раздел отключён в панели управления.');
  }
  async dispatch(i) {
    if (!i.isRepliable()) return;
    this.busy++;
    try {
      requireThat(i.inCachedGuild(), 'Команда доступна на сервере.');
      const [key, ...args] = i.isCommand() ? ['cmd.' + i.commandName] : (i.customId || '').split(':');
      const handler = this.routes.get(key);
      requireThat(handler, 'Панель устарела. Откройте команду заново.');
      this.store.guild(i.guildId);
      if (handler.module) this.enabled(i, handler.module);
      requireThat(
        nativeAllowed(this.config, i.guild, i.member, interactionPermission(key, args, i)),
        'Действие ограничено правами KARMA CONTROL.',
      );
      if (handler.defer) await i.deferReply({ flags: ephemeral });
      await handler.fn(i, args);
    } catch (error) {
      if (!(error instanceof InputError)) {
        this.log('interaction', error);
        if (i.guildId)
          try {
            this.store.audit(
              i.guildId,
              'bot.error',
              i.user.id,
              i.commandName || i.customId?.split(':')[0] || 'interaction',
              { code: String(error.code || error.name).slice(0, 40) },
            );
          } catch {}
      }
      const msg =
        error instanceof InputError
          ? error.message
          : 'Действие не завершено. Проверьте настройки, права бота и журнал.';
      if (i.deferred || !i.replied) await respond(i, card('Действие недоступно', msg)).catch(() => {});
      else await i.followUp({ ...card('Действие недоступно', msg), flags: ephemeral }).catch(() => {});
    } finally {
      this.busy--;
    }
  }
  connect() {
    this.client.on(Events.InteractionCreate, (i) => this.dispatch(i));
  }
}
