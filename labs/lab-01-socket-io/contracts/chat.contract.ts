export interface RoomDto {
  readonly id: string;
  readonly name: string;
}

export interface ParticipantDto {
  readonly id: string;
  readonly nickname: string;
  readonly joinedAt: string;
}

interface MessageBaseDto {
  readonly id: string;
  readonly sentAt: string;
}

export interface UserMessageDto extends MessageBaseDto {
  readonly type: 'user';
  readonly text: string;
  readonly author: Pick<ParticipantDto, 'id' | 'nickname'>;
}

export interface SystemMessageDto extends MessageBaseDto {
  readonly type: 'system';
  readonly text: string;
}

export type PresenceEvent = 'joined' | 'left';

export interface PresenceMessageDto extends MessageBaseDto {
  readonly type: 'presence';
  readonly event: PresenceEvent;
  readonly participant: Pick<ParticipantDto, 'id' | 'nickname'>;
}

export type MessageDto = UserMessageDto | SystemMessageDto | PresenceMessageDto;

export interface ChatSnapshotDto {
  readonly self: ParticipantDto;
  readonly room: RoomDto;
  readonly participants: readonly ParticipantDto[];
  readonly history: readonly MessageDto[];
}

export type ErrorCode = 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'NOT_JOINED' | 'INTERNAL_ERROR';

export interface ErrorDto {
  readonly code: ErrorCode;
  readonly message: string;
}

export type Ack<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ErrorDto };

export interface HandshakeAuth {
  readonly nickname: string;
  readonly room: string;
}

export interface SendMessagePayload {
  readonly text: string;
}

export interface ServerToClientEvents {
  'chat:snapshot': (snapshot: ChatSnapshotDto) => void;
  'message:new': (message: MessageDto) => void;
  'participant:joined': (participant: ParticipantDto) => void;
  'participant:left': (participant: ParticipantDto) => void;
}

export interface ClientToServerEvents {
  'message:send': (
    payload: SendMessagePayload,
    ack: (response: Ack<{ readonly id: string }>) => void,
  ) => void;
}
