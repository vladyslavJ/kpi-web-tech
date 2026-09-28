import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ParticipantId } from '../../domain/participant.ts';
import type { ClientToServerEvents, ServerToClientEvents } from './contract.ts';

export interface SocketData {
  nickname?: string;
  roomName?: string;
  participantId?: ParticipantId;
}

export type InterServerEvents = Record<never, never>;

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface SocketServerOptions {
  readonly corsOrigins: readonly string[];
  readonly maxPayloadBytes: number;
}

export function createSocketServer(httpServer: HttpServer, options: SocketServerOptions): ChatServer {
  return new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: [...options.corsOrigins] },
    serveClient: false,
    maxHttpBufferSize: options.maxPayloadBytes,
  });
}
