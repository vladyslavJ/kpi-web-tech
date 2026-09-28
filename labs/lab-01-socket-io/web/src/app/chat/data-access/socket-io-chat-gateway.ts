import { Injectable, type OnDestroy } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  ChatGateway,
  type ChatEventListener,
  type JoinRequest,
  type SendResult,
} from './chat-gateway';
import type {
  ClientToServerEvents,
  ErrorCode,
  ErrorDto,
  HandshakeAuth,
  ServerToClientEvents,
} from './contract';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5000;

@Injectable()
export class SocketIoChatGateway extends ChatGateway implements OnDestroy {
  #socket: ChatSocket | null = null;

  connect(request: JoinRequest, listener: ChatEventListener): void {
    this.disconnect();

    const auth: HandshakeAuth = { nickname: request.nickname, room: request.room };
    const socket: ChatSocket = io({ auth, autoConnect: false });

    socket.on('connect', () => listener({ type: 'status', status: 'connected' }));
    socket.on('disconnect', () => {
      listener({ type: 'status', status: socket.active ? 'reconnecting' : 'disconnected' });
    });
    socket.on('connect_error', (error) => {
      if (socket.active) {
        listener({ type: 'status', status: 'reconnecting' });
      } else {
        listener({ type: 'rejected', code: readErrorCode(error) });
      }
    });
    socket.on('chat:snapshot', (snapshot) => listener({ type: 'snapshot', snapshot }));
    socket.on('message:new', (message) => listener({ type: 'message', message }));
    socket.on('participant:joined', (participant) =>
      listener({ type: 'participant-joined', participant }),
    );
    socket.on('participant:left', (participant) =>
      listener({ type: 'participant-left', participant }),
    );

    this.#socket = socket;
    listener({ type: 'status', status: 'connecting' });
    socket.connect();
  }

  disconnect(): void {
    const socket = this.#socket;
    this.#socket = null;
    socket?.removeAllListeners();
    socket?.disconnect();
  }

  async send(text: string): Promise<SendResult> {
    const socket = this.#socket;
    if (!socket?.connected) {
      return { ok: false, code: 'OFFLINE' };
    }
    try {
      const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message:send', { text });
      return ack.ok ? { ok: true, id: ack.data.id } : { ok: false, code: ack.error.code };
    } catch {
      return { ok: false, code: 'TIMEOUT' };
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}

function readErrorCode(error: Error): ErrorCode {
  const data = (error as Error & { data?: Partial<ErrorDto> }).data;
  return data?.code ?? 'INTERNAL_ERROR';
}
