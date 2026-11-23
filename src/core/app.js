import { ConfigService } from './config.js';
import { InteractionRouter } from './router.js';
import { createClient } from './client.js';
import { DatabaseService } from '../database/store.js';
import { logger } from './logger.js';
import { installSetup } from '../modules/setup.js';
import { installTickets } from '../modules/tickets.js';
import { installTicketActions } from '../modules/ticket-actions.js';
import { installFamily } from '../modules/family.js';
import { installModeration } from '../modules/moderation.js';
import { installActivity } from '../modules/activity.js';
import { installStaff } from '../modules/staff.js';
import { installEvents } from '../modules/events.js';
import { installCommunity } from '../modules/community.js';
import { installRoles } from '../modules/roles.js';
import { installEmbeds } from '../modules/embeds.js';
import { installSecurity } from '../modules/security.js';
import { installDashboard } from '../modules/dashboard.js';
import { installWebhooks } from '../modules/webhooks.js';
import { SchedulerService } from '../services/scheduler.js';
import { installControlComponents } from '../control/studio.js';
export function register(r) {
  for (const install of [
    installSetup,
    installTickets,
    installTicketActions,
    installFamily,
    installModeration,
    installActivity,
    installStaff,
    installEvents,
    installCommunity,
    installRoles,
    installEmbeds,
    installWebhooks,
    installSecurity,
    installDashboard,
    installControlComponents,
  ])
    install(r);
  return r;
}
export function app(dir) {
  const store = new DatabaseService(dir),
    client = createClient();
  const r = register(
    new InteractionRouter({ client, store, config: new ConfigService(store), log: logger(store.dir) }),
  );
  r.scheduler = new SchedulerService(r);
  return r;
}
