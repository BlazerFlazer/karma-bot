import { Client, GatewayIntentBits as G, Options, Partials } from 'discord.js';
import { contentIntent, membersIntent } from './env.js';
import { safeMentions } from './ui.js';
export function createClient() {
  return new Client({
    intents: [
      G.Guilds,
      G.GuildVoiceStates,
      G.GuildMessages,
      G.GuildModeration,
      G.GuildMessageReactions,
      ...(membersIntent ? [G.GuildMembers] : []),
      ...(contentIntent ? [G.MessageContent] : []),
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    allowedMentions: safeMentions,
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 15,
      GuildMemberManager: { maxSize: 30, keepOverLimit: (m) => m.id === m.client.user?.id },
      ReactionManager: 10,
      PresenceManager: 0,
      UserManager: 80,
    }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 300 } },
    rest: { retries: 2, timeout: 12000 },
  });
}
