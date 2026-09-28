import type { ChatSnapshotDto, ErrorCode, MessageDto, ParticipantDto } from './contract';

export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type ChatEvent =
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  | { readonly type: 'rejected'; readonly code: ErrorCode }
  | { readonly type: 'snapshot'; readonly snapshot: ChatSnapshotDto }
  | { readonly type: 'message'; readonly message: MessageDto }
  | { readonly type: 'participant-joined'; readonly participant: ParticipantDto }
  | { readonly type: 'participant-left'; readonly participant: ParticipantDto };

export type ChatEventListener = (event: ChatEvent) => void;

export interface JoinRequest {
  readonly nickname: string;
  readonly room: string;
}

export type SendErrorCode = ErrorCode | 'TIMEOUT' | 'OFFLINE';

export type SendResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly code: SendErrorCode };

export abstract class ChatGateway {
  abstract connect(request: JoinRequest, listener: ChatEventListener): void;
  abstract disconnect(): void;
  abstract send(text: string): Promise<SendResult>;
}
