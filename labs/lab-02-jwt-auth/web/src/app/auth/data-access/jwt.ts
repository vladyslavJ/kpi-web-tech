import type { TokenClaimsDto } from './contract';

export interface DecodedJwt {
  readonly parts: readonly [header: string, payload: string, signature: string];
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: TokenClaimsDto;
}

export function decodeJwt(token: string): DecodedJwt | null {
  const [header, payload, signature, ...rest] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined || rest.length > 0) {
    return null;
  }
  try {
    return {
      parts: [header, payload, signature],
      header: JSON.parse(decodeSegment(header)),
      payload: JSON.parse(decodeSegment(payload)),
    };
  } catch {
    return null;
  }
}

export function tamperPayload(
  token: string,
  change: (payload: TokenClaimsDto) => TokenClaimsDto,
): string {
  const decoded = decodeJwt(token);
  if (!decoded) {
    return token;
  }
  const [header, , signature] = decoded.parts;
  return `${header}.${encodeSegment(JSON.stringify(change(decoded.payload)))}.${signature}`;
}

function decodeSegment(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

function encodeSegment(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCharCode(byte),
  ).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
