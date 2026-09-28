import { Injectable } from '@angular/core';
import {
  ChatGateway,
  type ChatEvent,
  type ChatEventListener,
  type JoinRequest,
  type SendResult,
} from '../../src/app/chat/data-access/chat-gateway';

@Injectable()
export class FakeChatGateway extends ChatGateway {
  request: JoinRequest | null = null;
  readonly sent: string[] = [];
  nextSendResult: SendResult = { ok: true, id: 'server-id' };
  #listener: ChatEventListener | null = null;

  connect(request: JoinRequest, listener: ChatEventListener): void {
    this.request = request;
    this.#listener = listener;
  }

  disconnect(): void {
    this.request = null;
    this.#listener = null;
  }

  async send(text: string): Promise<SendResult> {
    this.sent.push(text);
    return this.nextSendResult;
  }

  emit(event: ChatEvent): void {
    this.#listener?.(event);
  }
}
