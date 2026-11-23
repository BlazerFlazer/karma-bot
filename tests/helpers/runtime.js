import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Collection, PermissionsBitField as Perms, PermissionFlagsBits as P } from 'discord.js';
import { app } from '../../src/core/app.js';
export const ids = {
  guild: '100000000000000001',
  owner: '100000000000000002',
  bot: '100000000000000003',
  author: '100000000000000004',
  reviewer: '100000000000000005',
  staff: '100000000000000006',
  log: '100000000000000007',
  category: '100000000000000008',
  channel: '100000000000000009',
  member: '100000000000000010',
  results: '100000000000000011',
};
export function runtime(t) {
  const dir = mkdtempSync(join(tmpdir(), 'karma-integration-')),
    r = app(dir);
  t.after(async () => {
    await r.client.destroy();
    r.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const errors = [];
  r.log = (event, e) => errors.push({ event, e });
  r.errors = errors;
  const bot = { id: ids.bot },
    people = new Collection(),
    roles = new Collection(),
    channels = new Collection();
  const guild = {
    id: ids.guild,
    ownerId: ids.owner,
    name: 'Тест',
    memberCount: 3,
    client: {
      user: bot,
      users: {
        fetch: async () => ({
          send: async () => {
            throw Object.assign(Error('DM closed'), { code: 50007 });
          },
        }),
      },
    },
    roles: { cache: roles, fetch: async (id) => (id ? roles.get(id) : roles) },
    members: {
      cache: people,
      me: { id: ids.bot, permissions: new Perms(P.Administrator) },
      fetch: async (arg) => people.get(arg.user || arg),
    },
    channels: { cache: channels, fetch: async (id) => (id ? channels.get(id) : channels) },
    voiceStates: { cache: new Collection() },
  };
  guild.roles.everyone = { id: ids.guild };
  for (const id of [ids.staff, ids.member])
    roles.set(id, { id, name: id, guild, editable: true, managed: false, permissions: new Perms(0n) });
  function member(id, roleIds) {
    const cache = new Collection(roleIds.map((k) => [k, roles.get(k)]));
    return {
      id,
      user: { id, bot: false },
      permissions: new Perms(0n),
      manageable: true,
      roles: {
        cache,
        add: async (x) => cache.set(x.id || x, x),
        remove: async (x) => cache.delete(x.id || x),
      },
    };
  }
  people.set(ids.author, member(ids.author, []));
  people.set(ids.reviewer, member(ids.reviewer, [ids.staff]));
  people.set(ids.owner, member(ids.owner, []));
  function channel(id, type = 0) {
    const messages = new Collection(),
      overwrites = new Collection();
    const c = {
      id,
      type,
      guild,
      parentId: ids.category,
      isThread: () => false,
      messages: {
        fetch: async (arg) => (typeof arg === 'string' ? messages.get(arg) : messages),
        delete: async (mid) => messages.delete(mid),
      },
      permissionOverwrites: { cache: overwrites, edit: async () => {}, delete: async () => {} },
      permissionsFor: (m) => new Perms(m.id === ids.guild ? 0n : P.Administrator),
      send: async (payload) => {
        const mid = String(200000000000000000n + BigInt(messages.size));
        const m = {
          id: mid,
          createdAt: new Date(),
          author: { id: ids.bot, username: 'KARMA' },
          content: payload.content || '',
          attachments: new Collection(),
          embeds: payload.embeds || [],
          payload,
          edit: async (body) => {
            m.payload = body;
            m.embeds = body.embeds || [];
            return m;
          },
        };
        messages.set(mid, m);
        return m;
      },
      saved: messages,
    };
    channels.set(id, c);
    return c;
  }
  const log = channel(ids.log);
  log.permissionOverwrites.cache.set(ids.guild, {
    id: ids.guild,
    type: 0,
    deny: new Perms(P.ViewChannel),
    allow: new Perms(),
  });
  const results = channel(ids.results);
  channel(ids.category, 4);
  guild.channels.create = async (opts) => {
    const c = channel(ids.channel);
    c.topic = opts.topic;
    c.name = opts.name;
    c.overwriteInput = opts.permissionOverwrites;
    for (const o of opts.permissionOverwrites)
      c.permissionOverwrites.cache.set(o.id, {
        id: o.id,
        type: o.id === ids.author || o.id === ids.bot ? 1 : 0,
        allow: new Perms(o.allow || 0n),
        deny: new Perms(o.deny || 0n),
      });
    return c;
  };
  Object.assign(r, {
    client: {
      user: bot,
      guilds: { cache: new Collection([[ids.guild, guild]]) },
      ws: { ping: 25 },
      isReady: () => true,
      destroy: async () => {},
    },
    guild,
    people,
    channels,
    results,
    logChannel: log,
  });
  r.store.guild(ids.guild);
  r.config.bind(ids.guild, 'role', 'high', ids.staff, ids.owner);
  r.config.bind(ids.guild, 'role', 'member', ids.member, ids.owner);
  for (const [key, id] of [
    ['cat_recruitment', ids.category],
    ['ticket_logs', ids.log],
    ['application_results', ids.results],
  ])
    r.config.bind(ids.guild, 'channel', key, id, ids.owner);
  return r;
}
export function interaction(r, params = {}) {
  const user = params.userId || ids.author,
    channel = params.channel || r.channels.get(ids.channel) || r.results;
  const replies = [];
  return {
    id: '310000000000000001',
    client: r.client,
    user: { id: user, username: 'Тест' },
    member: r.people.get(user),
    memberPermissions: new Perms(user === ids.owner ? P.Administrator : 0n),
    appPermissions: new Perms(P.Administrator),
    guild: r.guild,
    guildId: ids.guild,
    channel,
    channelId: channel.id,
    customId: params.customId,
    commandName: params.commandName,
    values: params.values,
    message: params.message,
    options: params.options,
    fields: { getTextInputValue: (k) => params.fields[k] ?? '' },
    inCachedGuild: () => true,
    isRepliable: () => true,
    isCommand: () => !!params.commandName,
    replies,
    async reply(p) {
      this.replied = true;
      replies.push(p);
    },
    async update(p) {
      this.replied = true;
      replies.push(p);
    },
    async editReply(p) {
      replies.push(p);
    },
    async deferReply() {
      this.deferred = true;
    },
    async showModal(p) {
      this.replied = true;
      replies.push(p);
    },
    async followUp(p) {
      replies.push(p);
    },
  };
}
