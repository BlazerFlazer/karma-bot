import { defaults, types } from './catalog.js';
export class ConfigService {
  constructor(store) {
    this.store = store;
  }
  settings(g) {
    return {
      ...defaults,
      ...JSON.parse(this.store.one('SELECT settings FROM guild_settings WHERE guild=?', g)?.settings || '{}'),
    };
  }
  save(g, settings, actor) {
    this.store.guild(g);
    const old = this.settings(g);
    this.store.tx(() => {
      this.store.run('UPDATE guild_settings SET settings=? WHERE guild=?', JSON.stringify(settings), g);
      this.store.audit(g, 'settings', actor, g, { before: old, after: settings });
    });
  }
  bindings(g, kind) {
    const table = kind === 'role' ? 'configured_roles' : 'configured_channels';
    return Object.fromEntries(
      this.store.all('SELECT key,id FROM ' + table + ' WHERE guild=?', g).map((x) => [x.key, x.id]),
    );
  }
  bind(g, kind, key, id, actor) {
    const table = kind === 'role' ? 'configured_roles' : 'configured_channels';
    this.store.guild(g);
    const before = this.bindings(g, kind)[key];
    this.store.tx(() => {
      this.store.run(
        'INSERT INTO ' + table + ' VALUES(?,?,?) ON CONFLICT(guild,key) DO UPDATE SET id=excluded.id',
        g,
        key,
        id,
      );
      this.store.audit(g, 'bind.' + kind, actor, key, { before, after: id });
    });
  }
  types(g) {
    return {
      ...types,
      ...Object.fromEntries(
        this.store
          .all('SELECT key,config FROM ticket_types WHERE guild=?', g)
          .map((r) => [r.key, JSON.parse(r.config)]),
      ),
    };
  }
  enabled(g, k) {
    return (
      this.store.one('SELECT enabled FROM module_settings WHERE guild=? AND name=?', g, k)?.enabled !== 0
    );
  }
  roleIds(g, keys) {
    const map = this.bindings(g, 'role');
    return [
      ...new Set(
        keys.map((k) => map[k] || (/^\d{17,20}$/.test(k) ? k : null)).filter((id) => id && id !== g),
      ),
    ];
  }
}
