import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, normalizeMessageText } from '../../domain/message.ts';
import { DISPLAY_NAME_PATTERN, normalizeDisplayName } from '../../domain/display-name.ts';
import type { HandshakeAuth, SendMessagePayload } from './contract.ts';

const displayName = (label: string) =>
  z
    .string()
    .transform(normalizeDisplayName)
    .pipe(z.string().regex(DISPLAY_NAME_PATTERN, `${label} must be 2–32 characters: letters, digits, spaces, _ . -`));

export const handshakeAuthSchema = z.object({
  nickname: displayName('Nickname'),
  room: displayName('Room name'),
}) satisfies z.ZodType<HandshakeAuth>;

export const sendMessagePayloadSchema = z.object({
  text: z
    .string()
    .transform(normalizeMessageText)
    .pipe(
      z
        .string()
        .min(1, 'Message is empty')
        .max(MESSAGE_MAX_LENGTH, `Message is longer than ${MESSAGE_MAX_LENGTH} characters`),
    ),
}) satisfies z.ZodType<SendMessagePayload>;
