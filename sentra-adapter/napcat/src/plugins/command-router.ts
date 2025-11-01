import type { AdapterPlugin, CommandContext } from './types';
import type { NapcatAdapter } from '../adapter/NapcatAdapter';
import { getPlainText } from '../events';

export interface CommandRouterOptions {
  prefix?: string; // e.g. '!'
  allowMentionAsPrefix?: boolean; // @bot cmd
}

type CommandHandler = (ctx: CommandContext) => Promise<void> | void;

export function createCommandRouter(options: CommandRouterOptions = {}) {
  const prefix = options.prefix ?? process.env.COMMAND_PREFIX ?? '!';
  const allowMentionAsPrefix = options.allowMentionAsPrefix ?? true;

  const commands = new Map<string, CommandHandler>();
  let handlerRef: ((ev: any) => void) | undefined;
  let attachedAdapter: NapcatAdapter | undefined;

  const plugin: AdapterPlugin & {
    command: (name: string, handler: CommandHandler) => void;
  } = {
    name: 'command-router',
    setup(adapter: NapcatAdapter) {
      attachedAdapter = adapter;
      handlerRef = async (ev: any) => {
        if (ev?.post_type !== 'message') return;
        const text = getPlainText(ev).trim();
        if (!text) return;

        const usedMention = allowMentionAsPrefix && adapter.isAtMe(ev);
        const usedPrefix = text.startsWith(prefix);
        if (!usedMention && !usedPrefix) return;

        let cmdLine = text;
        if (usedPrefix) {
          // remove prefix from the first token only
          if (!cmdLine.startsWith(prefix)) return;
          cmdLine = cmdLine.slice(prefix.length).trim();
        }

        const parts = cmdLine.split(/\s+/).filter(Boolean);
        if (parts.length === 0) return;
        const name = parts[0].toLowerCase();
        const args = parts.slice(1);
        const handler = commands.get(name);
        if (!handler) return;

        const ctx: CommandContext = {
          adapter,
          event: ev,
          args,
          text: cmdLine,
          isGroup: ev.message_type === 'group',
          reply: (message) => adapter.sendReply(ev, message),
          send: (message) => adapter.sendTo(ev, message),
        };
        try {
          await handler(ctx);
        } catch (e) {
          // swallow
        }
      };
      adapter.on('message', handlerRef as any);
    },
    dispose() {
      if (handlerRef && attachedAdapter) {
        attachedAdapter.off('message', handlerRef as any);
      }
      handlerRef = undefined;
      attachedAdapter = undefined;
    },
    command(name: string, handler: CommandHandler) {
      commands.set(name.toLowerCase(), handler);
    },
  };

  return plugin;
}
