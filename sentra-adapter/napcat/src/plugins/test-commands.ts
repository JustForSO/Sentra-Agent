import type { SdkInvoke } from '../sdk';
import type { MessageEvent } from '../types/onebot';
import { segment } from '../utils/message';
import { ForwardBuilder } from '../utils/builder';
import { createLogger } from '../logger';
import {
  extractReplyInfo,
  formatReplyInfo,
  hasSegmentType,
  getImages,
  getVideos,
  getFiles,
  getRecords,
  getMessageSummary,
} from '../utils/reply-parser';

const log = createLogger(process.env.LOG_LEVEL as any || 'info');

/**
 * 测试命令插件
 * 
 * 功能：测试 NapCat 适配器的所有功能
 * 使用：所有命令以 # 开头
 * 
 * 包含功能：
 * - 消息发送（文本、图片、表情、@、合并转发等）
 * - 消息操作（撤回、获取消息详情等）
 * - 群组管理（禁言、踢人、全员禁言、设置名片等）
 * - 用户信息（获取用户信息、好友列表、点赞等）
 * - 文件操作（上传文件、获取文件列表等）
 * - 图片操作（获取图片信息、OCR 识别等）
 * - 系统信息（登录信息、状态、版本等）
 */
export function createTestCommandsPlugin(sdk: SdkInvoke) {
    const handler = async (ev: MessageEvent) => {
        const text = sdk.utils.getPlainText(ev).trim();

        // 只处理以 # 开头的命令
        if (!text.startsWith('#')) return;

        const args = text.slice(1).split(' ');
        const cmd = args[0];

        try {
            await handleCommand(sdk, ev, cmd, args.slice(1));
        } catch (err: any) {
            log.error({ err, cmd }, '命令执行失败');
            await sdk.send.reply(ev, `❌ 命令执行失败: ${err.message}`);
        }
    };

    sdk.on.message(handler);

    return {
        name: 'test-commands',
        dispose: () => {
            // 清理逻辑
        },
    };
}

async function handleCommand(
    sdk: SdkInvoke,
    ev: MessageEvent,
    cmd: string,
    args: string[]
) {
    // ========== 帮助命令 ==========
    if (cmd === 'help' || cmd === '帮助') {
        const help = [
            '🧪 测试命令列表 (以 # 开头)',
            '',
            '📝 消息发送:',
            '  #text - 发送文本消息',
            '  #at - @ 某人',
            '  #atall - @ 全体成员',
            '  #image - 发送图片',
            '  #face - 发送表情',
            '  #reply - 引用回复',
            '  #forward - 合并转发消息',
            '',
            '📋 消息操作:',
            '  #recall - 撤回消息',
            '  #getmsg - 获取消息详情',
            '  #replyinfo - 查看引用消息详情',
            '  #replyctx - 查看引用上下文',
            '  #summary - 获取消息摘要',
            '  #history [数量] - 获取历史消息',
            '  #markallread - 标记全部会话为已读',
            '',
            '👥 群组管理:',
            '  #grouplist - 获取群列表',
            '  #groupinfo - 获取群信息',
            '  #memberlist - 获取群成员列表',
            '  #ban <@user> <秒数> - 禁言',
            '  #unban <@user> - 解除禁言',
            '  #kick <@user> - 踢出群聊',
            '  #muteall - 全员禁言',
            '  #unmuteall - 解除全员禁言',
            '  #setcard <@user> <名片> - 设置群名片',
            '',
            '👤 用户信息:',
            '  #userinfo <@user> - 获取用户信息',
            '  #friendlist - 获取好友列表',
            '  #like <@user> - 点赞',
            '  #friendscats - 获取分组好友',
            '  #unidir - 获取单向好友',
            '',
            '📁 文件操作:',
            '  #uploadfile - 上传文件（需要文件路径）',
            '  #filelist - 获取群文件列表',
            '',
            '🖼️ 图片操作:',
            '  #imageinfo - 获取图片信息',
            '  #ocr - OCR 识别图片',
            '',
            '⚙️ 系统信息:',
            '  #logininfo - 获取登录信息',
            '  #status - 获取状态',
            '  #version - 获取版本信息',
            '  #online - 获取在线客户端',
            '',
            '🔧 工具:',
            '  #ping - 测试连接',
            '  #echo <内容> - 回显内容',
        ];
        await sdk.send.reply(ev, help.join('\n'));
        return;
    }

    // ========== 消息发送测试 ==========

    if (cmd === 'text') {
        await sdk.send.reply(ev, '这是一条文本消息');
        return;
    }

    if (cmd === 'at') {
        if (ev.message_type === 'group') {
            await sdk.send.reply(ev, [segment.at(ev.user_id!), segment.text(' 你好！')]);
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'atall') {
        if (ev.message_type === 'group') {
            await sdk.send.reply(ev, [segment.atAll(), segment.text(' 大家好！')]);
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'image') {
        // 发送网络图片
        await sdk.send.reply(ev, [
            segment.text('这是一张图片：\n'),
            segment.image('https://picsum.photos/200/300'),
        ]);
        return;
    }

    if (cmd === 'face') {
        // 发送表情
        await sdk.send.reply(ev, [segment.face(1), segment.text(' 微笑')]);
        return;
    }

    if (cmd === 'reply') {
        // 引用回复
        await sdk.send.reply(ev, '这是一条引用回复');
        return;
    }

    if (cmd === 'forward') {
        // 合并转发消息
        if (ev.message_type === 'group') {
            const nodes = new ForwardBuilder()
                .node([segment.text('第一条消息')], '用户A', '10001')
                .node([segment.text('第二条消息')], '用户B', '10002')
                .node([segment.text('第三条消息')], '用户C', '10003')
                .build();

            await sdk.send.forwardGroup(ev.group_id!, nodes);
            await sdk.send.reply(ev, '✅ 已发送合并转发消息');
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    // ========== 消息操作测试 ==========

    if (cmd === 'recall') {
        const response = await sdk.send.reply(ev, '这条消息将在 3 秒后撤回');
        const msgId = (response.data as any)?.message_id;
        if (msgId) {
            setTimeout(async () => {
                await sdk.message.recall(msgId);
            }, 3000);
        }
        return;
    }

    if (cmd === 'getmsg') {
        const msgInfo = await sdk.message.get(ev.message_id);
        await sdk.send.reply(ev, `消息详情:\n${JSON.stringify(msgInfo.data, null, 2)}`);
        return;
    }

    if (cmd === 'replyinfo') {
        const replyInfo = extractReplyInfo(ev);
        if (replyInfo) {
            const formatted = formatReplyInfo(replyInfo);
            await sdk.send.reply(ev, `引用消息详情:\n${formatted}`);
        } else {
            await sdk.send.reply(ev, '当前消息没有引用其他消息');
        }
        return;
    }

    if (cmd === 'replyctx') {
        const ctx = await sdk.utils.getReplyContext(ev);
        const lines = [
            `引用ID: ${ctx.reply?.id ?? '-'}`,
            `被引用: ${ctx.referredPlain || '(空)'}`,
            `当前: ${ctx.currentPlain || '(空)'}`,
        ];
        const m = ctx.media;
        if (m.images?.length) {
            lines.push(`\n图片(${m.images.length}):`);
            m.images.slice(0, 3).forEach((x, i) => {
                lines.push(`#${i+1} ${x.file || x.filename || ''} (${x.size || '-'})`);
            });
        }
        if (m.videos?.length) {
            lines.push(`\n视频(${m.videos.length}):`);
            m.videos.slice(0, 3).forEach((x, i) => {
                lines.push(`#${i+1} ${x.file || ''} (${x.size || '-'})`);
                if (x.url) lines.push(`  ${x.url}`);
            });
        }
        if (m.files?.length) {
            lines.push(`\n文件(${m.files.length}):`);
            m.files.slice(0, 3).forEach((x, i) => {
                lines.push(`#${i+1} ${x.name || ''} (${x.size || '-'})`);
                if (x.url) lines.push(`  ${x.url}`);
            });
        }
        if (m.records?.length) {
            lines.push(`\n语音(${m.records.length}):`);
            m.records.slice(0, 3).forEach((x, i) => {
                lines.push(`#${i+1} ${x.file || ''} [${x.format || ''}]`);
            });
        }
        if (m.forwards?.length) {
            lines.push(`\n合并转发(${m.forwards.length}):`);
            m.forwards.slice(0, 2).forEach((x, i) => {
                lines.push(`#${i+1} ${x.count || 0}条消息`);
                if (x.preview && x.preview.length) {
                    x.preview.forEach(p => lines.push(`  ${p}`));
                }
            });
        }
        if (m.faces?.length) {
            lines.push(`\n表情(${m.faces.length}):`);
            m.faces.slice(0, 5).forEach((x, i) => {
                lines.push(`#${i+1} [${x.id}] ${x.text || ''}`);
            });
        }
        await sdk.send.reply(ev, lines.join('\n'));
        return;
    }

    if (cmd === 'summary') {
        const summary = getMessageSummary(ev);
        const images = getImages(ev);
        const videos = getVideos(ev);
        const files = getFiles(ev);
        const records = getRecords(ev);
        
        const info = [
            `消息摘要: ${summary}`,
            `图片数量: ${images.length}`,
            `视频数量: ${videos.length}`,
            `文件数量: ${files.length}`,
            `语音数量: ${records.length}`,
        ];
        
        if (images.length > 0) {
            info.push(`\n图片列表:`);
            images.forEach((img, i) => {
                info.push(`  ${i + 1}. ${img.file}`);
            });
        }
        
        if (files.length > 0) {
            info.push(`\n文件列表:`);
            files.forEach((file, i) => {
                const size = file.size ? ` (${(file.size / 1024).toFixed(2)} KB)` : '';
                info.push(`  ${i + 1}. ${file.name || file.file}${size}`);
            });
        }
        
        await sdk.send.reply(ev, info.join('\n'));
        return;
    }

    if (cmd === 'history') {
        const count = args[0] ? parseInt(args[0]) : 20;
        
        if (ev.message_type === 'group') {
            const history = await sdk.message.getGroupHistory(ev.group_id!, undefined, count);
            const messages = (history.data as any)?.messages || [];
            await sdk.send.reply(ev, `获取到 ${messages.length} 条历史消息`);
        } else if (ev.message_type === 'private') {
            const history = await sdk.message.getFriendHistory(ev.user_id!, undefined, count);
            const messages = (history.data as any)?.messages || [];
            await sdk.send.reply(ev, `获取到 ${messages.length} 条历史消息`);
        }
        return;
    }

    if (cmd === 'markallread') {
        await sdk.message.markAllAsRead();
        await sdk.send.reply(ev, '已标记全部会话为已读');
        return;
    }

    // ========== 群组管理测试 ==========

    if (cmd === 'grouplist') {
        const groups = await sdk.group.list();
        const groupData = groups.data as any[];
        const list = groupData
            .slice(0, 10)
            .map((g: any) => `${g.group_id} - ${g.group_name}`)
            .join('\n');
        await sdk.send.reply(ev, `群列表 (前10个):\n${list}`);
        return;
    }

    if (cmd === 'groupinfo') {
        if (ev.message_type === 'group') {
            const info = await sdk.group.info(ev.group_id!);
            const data = info.data as any;
            const text = [
                `群信息:`,
                `群号: ${data.group_id}`,
                `群名: ${data.group_name}`,
                `成员数: ${data.member_count}`,
                `最大成员数: ${data.max_member_count}`,
            ].join('\n');
            await sdk.send.reply(ev, text);
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'memberlist') {
        if (ev.message_type === 'group') {
            const members = await sdk.group.memberList(ev.group_id!);
            const memberData = members.data as any[];
            const count = memberData.length;
            await sdk.send.reply(ev, `群成员数: ${count}`);
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'ban') {
        if (ev.message_type === 'group') {
            const atSeg = ev.message.find((seg) => seg.type === 'at');
            if (atSeg && args[0]) {
                const userId = parseInt(atSeg.data.qq);
                const duration = parseInt(args[0]) || 60;
                await sdk.group.ban(ev.group_id!, userId, duration);
                await sdk.send.reply(ev, `✅ 已禁言 ${duration} 秒`);
            } else {
                await sdk.send.reply(ev, '用法: #ban @用户 秒数');
            }
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'unban') {
        if (ev.message_type === 'group') {
            const atSeg = ev.message.find((seg) => seg.type === 'at');
            if (atSeg) {
                const userId = parseInt(atSeg.data.qq);
                await sdk.group.ban(ev.group_id!, userId, 0);
                await sdk.send.reply(ev, '✅ 已解除禁言');
            } else {
                await sdk.send.reply(ev, '用法: #unban @用户');
            }
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'kick') {
        if (ev.message_type === 'group') {
            const atSeg = ev.message.find((seg) => seg.type === 'at');
            if (atSeg) {
                const userId = parseInt(atSeg.data.qq);
                await sdk.group.kick(ev.group_id!, userId);
                await sdk.send.reply(ev, '✅ 已踢出');
            } else {
                await sdk.send.reply(ev, '用法: #kick @用户');
            }
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'muteall') {
        if (ev.message_type === 'group') {
            await sdk.group.wholeBan(ev.group_id!, true);
            await sdk.send.reply(ev, '✅ 已开启全员禁言');
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'unmuteall') {
        if (ev.message_type === 'group') {
            await sdk.group.wholeBan(ev.group_id!, false);
            await sdk.send.reply(ev, '✅ 已关闭全员禁言');
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    if (cmd === 'setcard') {
        if (ev.message_type === 'group') {
            const atSeg = ev.message.find((seg) => seg.type === 'at');
            if (atSeg && args[0]) {
                const userId = parseInt(atSeg.data.qq);
                const card = args.slice(0).join(' ');
                await sdk.group.setCard(ev.group_id!, userId, card);
                await sdk.send.reply(ev, `✅ 已设置群名片: ${card}`);
            } else {
                await sdk.send.reply(ev, '用法: #setcard @用户 名片内容');
            }
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    // ========== 用户信息测试 ==========

    if (cmd === 'userinfo') {
        const atSeg = ev.message.find((seg) => seg.type === 'at');
        const userId = atSeg ? parseInt(atSeg.data.qq) : ev.user_id!;

        const info = await sdk.user.info(userId);
        const data = info.data as any;
        const text = [
            `用户信息:`,
            `QQ: ${data.user_id}`,
            `昵称: ${data.nickname}`,
            `性别: ${data.sex}`,
            `年龄: ${data.age}`,
        ].join('\n');
        await sdk.send.reply(ev, text);
        return;
    }

    if (cmd === 'friendlist') {
        const friends = await sdk.user.friendList();
        const friendData = friends.data as any[];
        const count = friendData.length;
        await sdk.send.reply(ev, `好友数: ${count}`);
        return;
    }

    if (cmd === 'friendscats') {
        const res = await sdk.user.getFriendsWithCategory();
        const data = res.data as any;
        const total = Array.isArray(data?.friends) ? data.friends.length : (Array.isArray(data) ? data.length : 0);
        await sdk.send.reply(ev, `分组好友: ${total}`);
        return;
    }

    if (cmd === 'unidir') {
        const res = await sdk.user.getUnidirectionalFriendList();
        const list = res.data as any[];
        await sdk.send.reply(ev, `单向好友: ${Array.isArray(list) ? list.length : 0}`);
        return;
    }

    if (cmd === 'like') {
        const atSeg = ev.message.find((seg) => seg.type === 'at');
        if (atSeg) {
            const userId = parseInt(atSeg.data.qq);
            await sdk.user.sendLike(userId, 10);
            await sdk.send.reply(ev, '✅ 已点赞 10 次');
        } else {
            await sdk.send.reply(ev, '用法: #like @用户');
        }
        return;
    }

    // ========== 文件操作测试 ==========

    if (cmd === 'uploadfile') {
        await sdk.send.reply(ev, '文件上传需要提供本地文件路径，请在代码中配置');
        return;
    }

    if (cmd === 'filelist') {
        if (ev.message_type === 'group') {
            const files = await sdk.file.getGroupRoot(ev.group_id!);
            const fileData = files.data as any;
            await sdk.send.reply(ev, `群文件:\n${JSON.stringify(fileData, null, 2)}`);
        } else {
            await sdk.send.reply(ev, '此命令仅在群聊中可用');
        }
        return;
    }

    // ========== 图片操作测试 ==========

    if (cmd === 'imageinfo') {
        const imageSeg = ev.message.find((seg) => seg.type === 'image');
        if (imageSeg) {
            const imageInfo = await sdk.media.getImage(imageSeg.data.file);
            await sdk.send.reply(ev, `图片信息:\n${JSON.stringify(imageInfo.data, null, 2)}`);
        } else {
            await sdk.send.reply(ev, '请在消息中包含图片');
        }
        return;
    }

    if (cmd === 'ocr') {
        const imageSeg = ev.message.find((seg) => seg.type === 'image');
        if (imageSeg) {
            const ocrResult = await sdk.media.ocrImage(imageSeg.data.file);
            const texts = (ocrResult.data as any).texts || [];
            const result = texts.map((t: any) => t.text).join('\n');
            await sdk.send.reply(ev, `OCR 识别结果:\n${result || '未识别到文字'}`);
        } else {
            await sdk.send.reply(ev, '请在消息中包含图片');
        }
        return;
    }

    // ========== 系统信息测试 ==========

    if (cmd === 'logininfo') {
        const info = await sdk.system.loginInfo();
        const data = info.data as any;
        const text = [`登录信息:`, `QQ: ${data.user_id}`, `昵称: ${data.nickname}`].join('\n');
        await sdk.send.reply(ev, text);
        return;
    }

    if (cmd === 'status') {
        const status = await sdk.system.status();
        const data = status.data as any;
        const text = [
            `状态信息:`,
            `在线: ${data.online ? '是' : '否'}`,
            `状态: ${data.status || '未知'}`,
        ].join('\n');
        await sdk.send.reply(ev, text);
        return;
    }

    if (cmd === 'online') {
        const res = await sdk.system.getOnlineClients();
        const list = res.data as any[];
        await sdk.send.reply(ev, `在线客户端: ${Array.isArray(list) ? list.length : 0}`);
        return;
    }

    if (cmd === 'version') {
        const version = await sdk.system.versionInfo();
        const data = version.data as any;
        const text = [
            `版本信息:`,
            `应用: ${data.app_name}`,
            `版本: ${data.app_version}`,
            `协议: ${data.protocol_version}`,
        ].join('\n');
        await sdk.send.reply(ev, text);
        return;
    }

    // ========== 工具测试 ==========

    if (cmd === 'ping') {
        const start = Date.now();
        await sdk.send.reply(ev, 'pong');
        const latency = Date.now() - start;
        await sdk.send.reply(ev, `延迟: ${latency}ms`);
        return;
    }

    if (cmd === 'echo') {
        const content = args.join(' ') || '(空)';
        await sdk.send.reply(ev, content);
        return;
    }

    // 未知命令
    await sdk.send.reply(ev, `❌ 未知命令: ${cmd}\n使用 #help 查看帮助`);
}


