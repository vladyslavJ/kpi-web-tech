import { createServer, type Server, type ServerResponse } from 'node:http';
import { createStaticHandler } from './static-files.ts';

export interface HttpServerOptions {
  readonly staticDir?: string | undefined;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const serveStatic = options.staticDir ? createStaticHandler(options.staticDir) : null;

  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
      return;
    }
    if (serveStatic && (request.method === 'GET' || request.method === 'HEAD')) {
      void serveStatic(request, response);
      return;
    }
    sendJson(response, 404, { error: 'Not Found' });
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
