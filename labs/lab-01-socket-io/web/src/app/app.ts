import { Component, inject } from '@angular/core';
import { ChatStore } from './chat/data-access/chat-store';
import { ChatRoom } from './chat/ui/chat-room/chat-room';
import { JoinForm } from './chat/ui/join-form/join-form';

@Component({
  selector: 'app-root',
  imports: [ChatRoom, JoinForm],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(ChatStore);
}
