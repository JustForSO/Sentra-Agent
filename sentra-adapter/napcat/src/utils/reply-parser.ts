import type { MessageEvent, MessageSegment } from '../types/onebot';

/**
 * 引用消息解析器
 * 根据 NapCat 文档解析引用消息的详细信息
 */

export interface ReplyInfo {
    id: number;
    seq?: number;
    time?: number;
    sender?: {
        user_id: number;
        nickname?: string;
    };
    message?: MessageSegment[];
    raw_message?: string;
}

/**
 * 从消息中提取引用信息
 */
export function extractReplyInfo(ev: MessageEvent): ReplyInfo | null {
    const replySegment = ev.message.find(seg => seg.type === 'reply');
    if (!replySegment || !replySegment.data) {
        return null;
    }

    const data = replySegment.data as any;

    return {
        id: parseInt(data.id) || 0,
        seq: data.seq ? parseInt(data.seq) : undefined,
        time: data.time ? parseInt(data.time) : undefined,
        sender: data.qq ? {
            user_id: parseInt(data.qq),
            nickname: data.nickname,
        } : undefined,
        message: data.message,
        raw_message: data.text,
    };
}

/**
 * 格式化引用信息为可读文本
 */
export function formatReplyInfo(reply: ReplyInfo): string {
    const lines: string[] = [];

    lines.push(`引用消息 ID: ${reply.id}`);

    if (reply.sender) {
        lines.push(`发送者: ${reply.sender.nickname || reply.sender.user_id}`);
    }

    if (reply.time) {
        const date = new Date(reply.time * 1000);
        lines.push(`时间: ${date.toLocaleString('zh-CN')}`);
    }

    if (reply.raw_message) {
        lines.push(`内容: ${reply.raw_message}`);
    } else if (reply.message && reply.message.length > 0) {
        const types = reply.message.map(seg => seg.type).join(', ');
        lines.push(`内容类型: ${types}`);
    }

    return lines.join('\n');
}

/**
 * 检查消息中是否包含特定类型的段
 */
export function hasSegmentType(ev: MessageEvent, type: string): boolean {
    return ev.message.some(seg => seg.type === type);
}

/**
 * 获取消息中所有特定类型的段
 */
export function getSegmentsByType(ev: MessageEvent, type: string): MessageSegment[] {
    return ev.message.filter(seg => seg.type === type);
}

/**
 * 获取消息中的所有图片
 */
export function getImages(ev: MessageEvent): Array<{ file: string; url?: string }> {
    return ev.message
        .filter(seg => seg.type === 'image')
        .map(seg => ({
            file: seg.data?.file || '',
            url: seg.data?.url,
        }));
}

/**
 * 获取消息中的所有视频
 */
export function getVideos(ev: MessageEvent): Array<{ file: string; url?: string }> {
    return ev.message
        .filter(seg => seg.type === 'video')
        .map(seg => ({
            file: seg.data?.file || '',
            url: seg.data?.url,
        }));
}

/**
 * 获取消息中的所有文件
 */
export function getFiles(ev: MessageEvent): Array<{ file: string; name?: string; size?: number }> {
    return ev.message
        .filter(seg => seg.type === 'file')
        .map(seg => ({
            file: seg.data?.file || '',
            name: seg.data?.name,
            size: seg.data?.size ? parseInt(seg.data.size) : undefined,
        }));
}

/**
 * 获取消息中的所有语音
 */
export function getRecords(ev: MessageEvent): Array<{ file: string; url?: string }> {
    return ev.message
        .filter(seg => seg.type === 'record')
        .map(seg => ({
            file: seg.data?.file || '',
            url: seg.data?.url,
        }));
}

/**
 * 获取消息摘要
 */
export function getMessageSummary(ev: MessageEvent): string {
    const parts: string[] = [];

    for (const seg of ev.message) {
        switch (seg.type) {
            case 'text':
                parts.push(seg.data?.text || '');
                break;
            case 'image':
                parts.push('[图片]');
                break;
            case 'video':
                parts.push('[视频]');
                break;
            case 'file':
                parts.push(`[文件: ${seg.data?.name || '未知'}]`);
                break;
            case 'record':
                parts.push('[语音]');
                break;
            case 'at':
                if (seg.data?.qq === 'all') {
                    parts.push('[@全体成员]');
                } else {
                    parts.push(`[@${seg.data?.qq}]`);
                }
                break;
            case 'face':
                parts.push(`[表情${seg.data?.id}]`);
                break;
            case 'reply':
                // 处理引用消息
                const replyText = seg.data?.text || '';
                if (replyText) {
                    parts.push(`[引用: ${replyText}]`);
                } else {
                    parts.push('[引用消息]');
                }
                break;
            default:
                parts.push(`[${seg.type}]`);
        }
    }

    return parts.join('');
}
