export type MessageSegment = {
  type: string;
  data: Record<string, any>;
};

export type Message = MessageSegment[];

export type PostType = 'message' | 'notice' | 'request' | 'meta_event';

export interface OBEventBase {
  time: number;
  self_id: number;
  post_type: PostType;
}

export type MessageType = 'private' | 'group';

export interface MessageEvent extends OBEventBase {
  post_type: 'message';
  message_type: MessageType;
  message_id: number;
  user_id?: number;
  group_id?: number;
  message: Message;
  raw_message: string;
  sender?: {
    user_id: number;
    nickname?: string;
    card?: string;
    role?: string;
  };
  sub_type?: string;
}

export interface NoticeEvent extends OBEventBase {
  post_type: 'notice';
  notice_type: string;
  [key: string]: any;
}

export interface RequestEvent extends OBEventBase {
  post_type: 'request';
  request_type: string;
  [key: string]: any;
}

export interface MetaEvent extends OBEventBase {
  post_type: 'meta_event';
  meta_event_type: string;
  [key: string]: any;
}

export type OneBotEvent = MessageEvent | NoticeEvent | RequestEvent | MetaEvent;

export type OneBotStatus = 'ok' | 'failed';

export interface OneBotResponse<T = any> {
  status: OneBotStatus;
  retcode: number;
  data?: T;
  message?: string;
  echo?: string | number;
}

/**
 * Common OneBot 11 API action names
 */
export type OB11Action =
  | 'send_private_msg'
  | 'send_group_msg'
  | 'delete_msg'
  | 'get_msg'
  | 'get_login_info'
  | 'get_group_list'
  | 'get_group_member_list'
  | 'set_group_kick'
  | 'set_group_ban'
  | 'set_group_whole_ban'
  | 'set_group_card'
  | 'set_group_name'
  | 'get_stranger_info'
  | 'send_like'
  | string; // allow vendor-specific extensions

// ---- Refined OneBot 11 Events (common subtypes) ----

export interface GroupIncreaseNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'group_increase';
  sub_type: 'approve' | 'invite';
  group_id: number;
  user_id: number; // new member
  operator_id: number; // operator
}

export interface GroupDecreaseNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'group_decrease';
  sub_type: 'leave' | 'kick' | 'kick_me';
  group_id: number;
  user_id: number; // member
  operator_id?: number; // operator
}

export interface GroupAdminNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'group_admin';
  sub_type: 'set' | 'unset';
  group_id: number;
  user_id: number;
}

export interface GroupUploadNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'group_upload';
  group_id: number;
  user_id: number;
  file: { id: string; name: string; size: number; busid?: number };
}

export interface FriendAddNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'friend_add';
  user_id: number;
}

export interface GroupRecallNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'group_recall';
  group_id: number;
  user_id: number;
  operator_id: number;
  message_id: number;
}

export interface FriendRecallNotice extends OBEventBase {
  post_type: 'notice';
  notice_type: 'friend_recall';
  user_id: number;
  message_id: number;
}

export type OB11NoticeEvent =
  | GroupIncreaseNotice
  | GroupDecreaseNotice
  | GroupAdminNotice
  | GroupUploadNotice
  | FriendAddNotice
  | GroupRecallNotice
  | FriendRecallNotice
  | NoticeEvent; // fallback

export interface FriendRequest extends OBEventBase {
  post_type: 'request';
  request_type: 'friend';
  user_id: number;
  comment?: string;
  flag: string;
}

export interface GroupRequest extends OBEventBase {
  post_type: 'request';
  request_type: 'group';
  sub_type: 'add' | 'invite';
  group_id: number;
  user_id: number;
  comment?: string;
  flag: string;
}

export type OB11RequestEvent = FriendRequest | GroupRequest | RequestEvent; // fallback

export interface HeartbeatMeta extends OBEventBase {
  post_type: 'meta_event';
  meta_event_type: 'heartbeat';
  status?: any;
  interval?: number;
}

export interface LifecycleMeta extends OBEventBase {
  post_type: 'meta_event';
  meta_event_type: 'lifecycle';
  sub_type?: 'enable' | 'disable' | 'connect';
}

export type OB11MetaEvent = HeartbeatMeta | LifecycleMeta | MetaEvent; // fallback

export type OB11Event = MessageEvent | OB11NoticeEvent | OB11RequestEvent | OB11MetaEvent;
