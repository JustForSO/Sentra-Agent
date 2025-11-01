import type { Message, MessageSegment } from '../types/onebot';

export class MessageBuilder {
  private segs: MessageSegment[] = [];

  static from(input: string | Message): MessageBuilder {
    const b = new MessageBuilder();
    if (typeof input === 'string') return b.text(input);
    b.segs.push(...input);
    return b;
  }

  text(text: string) { this.segs.push({ type: 'text', data: { text } }); return this; }
  at(qq: string | number) { this.segs.push({ type: 'at', data: { qq: String(qq) } }); return this; }
  atAll() { this.segs.push({ type: 'at', data: { qq: 'all' } }); return this; }
  image(file: string) { this.segs.push({ type: 'image', data: { file } }); return this; }
  reply(id: number) { this.segs.push({ type: 'reply', data: { id } }); return this; }
  face(id: number) { this.segs.push({ type: 'face', data: { id } }); return this; }
  record(file: string) { this.segs.push({ type: 'record', data: { file } }); return this; }
  video(file: string) { this.segs.push({ type: 'video', data: { file } }); return this; }
  xml(data: string) { this.segs.push({ type: 'xml', data: { data } }); return this; }
  json(data: string) { this.segs.push({ type: 'json', data: { data } }); return this; }

  push(seg: MessageSegment) { this.segs.push(seg); return this; }
  concat(msg: Message) { this.segs.push(...msg); return this; }

  build(): Message { return [...this.segs]; }
}

export type ForwardNode = { type: 'node'; data: { name?: string; uin?: string | number; content: Message } };

export class ForwardBuilder {
  private nodes: ForwardNode[] = [];

  node(content: Message, name?: string, uin?: string | number) {
    this.nodes.push({ type: 'node', data: { name, uin, content } });
    return this;
  }

  build(): ForwardNode[] { return [...this.nodes]; }
}
