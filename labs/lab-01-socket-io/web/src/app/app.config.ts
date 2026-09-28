import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { ChatGateway } from './chat/data-access/chat-gateway';
import { SocketIoChatGateway } from './chat/data-access/socket-io-chat-gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ChatGateway, useClass: SocketIoChatGateway },
  ],
};
