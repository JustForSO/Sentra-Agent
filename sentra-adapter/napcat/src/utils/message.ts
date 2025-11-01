import { Message, MessageSegment } from '../types/onebot';

export type MessageInput = string | Message;

export function toSegments(input: MessageInput): Message {
  if (typeof input === 'string') {
    return [{ type: 'text', data: { text: input } }];
  }
  return input;
}

export const segment = {
  text: (text: string): MessageSegment => ({ type: 'text', data: { text } }),
  at: (qq: string | number): MessageSegment => ({ type: 'at', data: { qq: String(qq) } }),
  atAll: (): MessageSegment => ({ type: 'at', data: { qq: 'all' } }),
  image: (file: string): MessageSegment => ({ type: 'image', data: { file } }),
  reply: (id: number): MessageSegment => ({ type: 'reply', data: { id } }),
  face: (id: number): MessageSegment => ({ type: 'face', data: { id } }),
  record: (file: string): MessageSegment => ({ type: 'record', data: { file } }),
  video: (file: string): MessageSegment => ({ type: 'video', data: { file } }),
  xml: (data: string): MessageSegment => ({ type: 'xml', data: { data } }),
  json: (data: string): MessageSegment => ({ type: 'json', data: { data } }),
};
