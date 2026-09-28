import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const HASHED_ASSET = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;

export type StaticHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createStaticHandler(directory: string): StaticHandler {
  const root = path.resolve(directory);
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`Static directory has no index.html: ${root}`);
  }

  return async (request, response) => {
    const requested = resolveInside(root, request.url ?? '/');
    if (requested === null) {
      respond(response, 404, 'Not Found');
      return;
    }

    const file = await findFile(requested);
    if (file) {
      sendFile(request, response, file);
    } else if (path.extname(requested) === '') {
      sendFile(request, response, indexFile);
    } else {
      respond(response, 404, 'Not Found');
    }
  };
}

function resolveInside(root: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  const resolved = path.resolve(root, `.${pathname}`);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

async function findFile(candidate: string): Promise<string | null> {
  try {
    const stats = await stat(candidate);
    if (stats.isFile()) {
      return candidate;
    }
    if (stats.isDirectory()) {
      return findFile(path.join(candidate, 'index.html'));
    }
  } catch {
    return null;
  }
  return null;
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string): void {
  const extension = path.extname(file);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': HASHED_ASSET.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file)
    .on('error', () => response.destroy())
    .pipe(response);
}

function respond(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}
