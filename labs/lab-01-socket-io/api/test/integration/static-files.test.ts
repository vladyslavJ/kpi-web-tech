import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp, type App } from '../../src/app.ts';
import type { AppConfig } from '../../src/config.ts';
import { createStaticHandler } from '../../src/infrastructure/http/static-files.ts';
import { ManualScheduler } from '../fakes/manual.scheduler.ts';
import { silentLogger } from '../fakes/system.ts';

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function get(port: number, rawPath: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serving the built client', { timeout: 10_000 }, () => {
  let workspace: string;
  let app: App;
  let port: number;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'chat-static-'));
    const root = path.join(workspace, 'browser');
    await mkdir(root);
    await writeFile(path.join(root, 'index.html'), '<title>Chat</title>');
    await writeFile(path.join(root, 'main-ABCD1234.js'), 'console.log("app");');
    await writeFile(path.join(workspace, 'secret.txt'), 'top secret');

    const config: AppConfig = {
      environment: 'test',
      port: 0,
      corsOrigins: [],
      historyLimit: 50,
      maxPayloadBytes: 16 * 1024,
      autoMessage: { text: 'auto', intervalMs: 21_000 },
      rateLimit: { capacity: 3, refillPerSecond: 1 },
      logLevel: 'error',
      logFormat: 'json',
      staticDir: root,
    };
    app = createApp(config, { scheduler: new ManualScheduler(), logger: silentLogger });
    ({ port } = await app.start());
  });

  after(async () => {
    await app.stop();
    await rm(workspace, { recursive: true, force: true });
  });

  it('serves index.html at the root without long-term caching', async () => {
    const response = await get(port, '/');

    assert.equal(response.status, 200);
    assert.equal(response.body, '<title>Chat</title>');
    assert.match(String(response.headers['content-type']), /^text\/html/);
    assert.equal(response.headers['cache-control'], 'no-cache');
  });

  it('serves hashed assets with an immutable cache policy', async () => {
    const response = await get(port, '/main-ABCD1234.js');

    assert.equal(response.status, 200);
    assert.match(String(response.headers['content-type']), /^text\/javascript/);
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  it('falls back to index.html for client-side routes', async () => {
    const response = await get(port, '/room/general');

    assert.equal(response.status, 200);
    assert.equal(response.body, '<title>Chat</title>');
  });

  it('answers 404 for missing files and for paths outside the directory', async () => {
    for (const rawPath of ['/missing.js', '/../secret.txt', '/..%2Fsecret.txt', '/%2e%2e/secret.txt']) {
      const response = await get(port, rawPath);
      assert.equal(response.status, 404, rawPath);
      assert.notEqual(response.body, 'top secret', rawPath);
    }
  });

  it('keeps the health check working', async () => {
    const response = await get(port, '/health');

    assert.equal(response.status, 200);
    assert.match(response.body, /"status":"ok"/);
  });

  it('refuses to start without an index.html', () => {
    assert.throws(() => createStaticHandler(workspace + '-missing'), /no index\.html/);
  });
});
