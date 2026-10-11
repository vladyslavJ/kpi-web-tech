import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { UserRepository } from '../../application/ports.ts';
import { createUser, ROLES, type Role, type User, type UserId } from '../../domain/user.ts';
import { InMemoryUserRepository } from './in-memory.user-repository.ts';

const fileSchema = z.object({
  users: z.array(
    z.object({
      id: z.string().min(1),
      username: z.string(),
      passwordHash: z.string(),
      role: z.enum(ROLES),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export class JsonFileUserRepository implements UserRepository {
  readonly #file: string;
  readonly #memory: InMemoryUserRepository;
  #writes: Promise<void> = Promise.resolve();

  private constructor(file: string, memory: InMemoryUserRepository) {
    this.#file = file;
    this.#memory = memory;
  }

  static async open(file: string): Promise<JsonFileUserRepository> {
    const absolute = path.resolve(file);
    return new JsonFileUserRepository(
      absolute,
      new InMemoryUserRepository(await readUsers(absolute)),
    );
  }

  findById(id: UserId): Promise<User | undefined> {
    return this.#memory.findById(id);
  }

  findByUsername(username: string): Promise<User | undefined> {
    return this.#memory.findByUsername(username);
  }

  list(): Promise<readonly User[]> {
    return this.#memory.list();
  }

  count(): Promise<number> {
    return this.#memory.count();
  }

  countByRole(role: Role): Promise<number> {
    return this.#memory.countByRole(role);
  }

  async add(user: User): Promise<boolean> {
    const added = await this.#memory.add(user);
    if (added) {
      await this.#persist();
    }
    return added;
  }

  async update(user: User): Promise<void> {
    await this.#memory.update(user);
    await this.#persist();
  }

  async remove(id: UserId): Promise<boolean> {
    const removed = await this.#memory.remove(id);
    if (removed) {
      await this.#persist();
    }
    return removed;
  }

  #persist(): Promise<void> {
    const next = this.#writes.then(() => this.#write());
    this.#writes = next.catch(() => undefined);
    return next;
  }

  async #write(): Promise<void> {
    const users = await this.#memory.list();
    const content = JSON.stringify(
      {
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        })),
      },
      null,
      2,
    );
    await mkdir(path.dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${content}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}

async function readUsers(file: string): Promise<User[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const parsed = fileSchema.parse(JSON.parse(raw));
  return parsed.users.map((user) => createUser({ ...user, createdAt: new Date(user.createdAt) }));
}
