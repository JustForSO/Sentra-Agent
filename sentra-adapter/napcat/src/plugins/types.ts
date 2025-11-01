import type { NapcatAdapter } from '../adapter/NapcatAdapter';

export interface AdapterPlugin {
  name: string;
  setup(adapter: NapcatAdapter): void;
  dispose?(): void;
}

export interface CommandContext {
  adapter: NapcatAdapter;
  event: import('../types/onebot').MessageEvent;
  args: string[];
  text: string;
  isGroup: boolean;
  reply: (message: import('../utils/message').MessageInput) => Promise<any>;
  send: (message: import('../utils/message').MessageInput) => Promise<any>;
}
