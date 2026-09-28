import type { ChatNotifier } from '../../src/application/ports.ts';
import type { RoomMessage, SystemMessage } from '../../src/domain/message.ts';
import type { Participant } from '../../src/domain/participant.ts';

export class SpyNotifier implements ChatNotifier {
  readonly posted: RoomMessage[] = [];
  readonly announced: SystemMessage[] = [];
  readonly joined: Participant[] = [];
  readonly left: Participant[] = [];

  messagePosted(message: RoomMessage): void {
    this.posted.push(message);
  }

  announcementMade(message: SystemMessage): void {
    this.announced.push(message);
  }

  participantJoined(participant: Participant): void {
    this.joined.push(participant);
  }

  participantLeft(participant: Participant): void {
    this.left.push(participant);
  }
}
