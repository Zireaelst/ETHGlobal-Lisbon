// tests/gates/_recording-proxy.ts — Alice ile Bob arasına giren, HAM BYTE kaydeden proxy.
//
// BUILD-PLAN P1-C kriteri: "ağ dinlemesi kanıtı — tcpdump/proxy loglarında brief metni
// geçmiyor". tcpdump Windows'ta taşınabilir değil ve TLS'siz düz HTTP'de zaten aynı şeyi
// görürüz; bu proxy tam olarak bir ağ gözlemcisinin göreceği byte'ları biriktirir.
// Yakalanan döküm demo videosunda "gözlemcinin gördüğü" paneline doğrudan girebilir.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedExchange {
  method: string;
  path: string;
  requestBody: Buffer;
  status: number;
  responseBody: Buffer;
}

export interface RecordingProxy {
  url(): string;
  close(): Promise<void>;
  readonly exchanges: CapturedExchange[];
  /** Gözlemcinin gördüğü her şey: istek + yanıt gövdeleri tek tampon hâlinde. */
  captured(): Buffer;
}

export async function startRecordingProxy(targetUrl: string): Promise<RecordingProxy> {
  const exchanges: CapturedExchange[] = [];
  const target = targetUrl.replace(/\/$/, '');

  const server: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      await new Promise<void>((resolve) => req.on('end', () => resolve()));
      const requestBody = Buffer.concat(chunks);

      const upstream = await fetch(`${target}${req.url ?? '/'}`, {
        method: req.method,
        headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : requestBody,
      });
      const responseBody = Buffer.from(await upstream.arrayBuffer());

      exchanges.push({
        method: req.method ?? 'GET',
        path: (req.url ?? '/').split('?')[0] ?? '/',
        requestBody,
        status: upstream.status,
        responseBody,
      });

      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(responseBody);
    })().catch(() => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PROXY_ERROR' }));
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  return {
    exchanges,
    url: () => `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    captured: () => Buffer.concat(exchanges.flatMap((e) => [e.requestBody, e.responseBody])),
  };
}
