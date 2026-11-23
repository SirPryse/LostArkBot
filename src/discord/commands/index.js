import { CORE_COMMANDS } from './registry.js';
import { helpCommand } from './help.js';

/** Every slash command the bot serves — the single list both the runtime
 * (discord/client.js) and `npm run deploy-commands` read, so a command
 * can't be registered with Discord but missing from the handler (or vice
 * versa). help.js reads CORE_COMMANDS directly. */
export const COMMANDS = [...CORE_COMMANDS, helpCommand];
