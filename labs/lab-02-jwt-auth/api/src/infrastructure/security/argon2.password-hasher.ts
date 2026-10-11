import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports.ts';

export interface Argon2Options {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltBytes: number;
  readonly hashBytes: number;
}

export const OWASP_ARGON2ID: Argon2Options = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  saltBytes: 16,
  hashBytes: 32,
};

const ALGORITHM = 'argon2id';
const VERSION = 19;

interface ParsedHash {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

export class Argon2PasswordHasher implements PasswordHasher {
  readonly #options: Argon2Options;

  constructor(options: Argon2Options = OWASP_ARGON2ID) {
    this.#options = options;
  }

  async hash(password: string): Promise<string> {
    const { memoryKiB, passes, parallelism, saltBytes, hashBytes } = this.#options;
    const salt = randomBytes(saltBytes);
    const hash = await derive(password, { memoryKiB, passes, parallelism, salt, hashBytes });
    return [
      '',
      ALGORITHM,
      `v=${VERSION}`,
      `m=${memoryKiB},t=${passes},p=${parallelism}`,
      toPhcBase64(salt),
      toPhcBase64(hash),
    ].join('$');
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (!parsed) {
      return false;
    }
    const actual = await derive(password, { ...parsed, hashBytes: parsed.hash.length });
    return timingSafeEqual(actual, parsed.hash);
  }
}

function derive(
  password: string,
  params: {
    memoryKiB: number;
    passes: number;
    parallelism: number;
    salt: Buffer;
    hashBytes: number;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      ALGORITHM,
      {
        message: password,
        nonce: params.salt,
        memory: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.hashBytes,
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

function parse(encoded: string): ParsedHash | undefined {
  const parts = encoded.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== '' ||
    parts[1] !== ALGORITHM ||
    parts[2] !== `v=${VERSION}`
  ) {
    return undefined;
  }
  const params = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? '');
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const hash = Buffer.from(parts[5] ?? '', 'base64');
  if (!params || salt.length < 8 || hash.length < 16) {
    return undefined;
  }
  return {
    memoryKiB: Number(params[1]),
    passes: Number(params[2]),
    parallelism: Number(params[3]),
    salt,
    hash,
  };
}

function toPhcBase64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}
