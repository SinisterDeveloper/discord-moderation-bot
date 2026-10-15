import { createServer } from 'node:http';
export function startHealth(host: string, port: number, ready: () => boolean) {
  const server = createServer((request, response) => {
    if (request.url !== '/livez' && request.url !== '/readyz') {
      response.writeHead(404).end();
      return;
    }
    const ok = request.url === '/livez' || ready();
    response.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: ok ? 'ok' : 'not_ready' }));
  });
  server.listen(port, host);
  return server;
}
