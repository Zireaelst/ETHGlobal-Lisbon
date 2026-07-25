// /tapp/chat.ts — Bob's binding agent, the thing that runs *inside* the 0G agent-wrapper
// Tapp on AGENT_PORT (9000 by convention; see agent-wrapper/examples/demo-agent.py).
//
// P0(b) SPIKE VERSION: this is deliberately the "trivial custom agent" the spike asks for —
// it accepts a body and returns a hash it computed. It does NOT yet do the real
// decrypt -> recompute keccak256 -> match -> call 0G SI -> verify ogSig flow (that's Phase 3).
//
// Contract (confirmed from github.com/0gfoundation/agent-wrapper):
//   - Plain HTTP JSON handler, no wrapper imports, no signing code (README "What Your Agent Sees").
//   - Wrapper proxies :8080 -> AGENT_PORT (examples/demo-agent.py defaults to 9000) and signs
//     the raw response bytes it reads back (internal/proxy/proxy.go signResponse). So whatever
//     we write here becomes the exact preimage input of the seal-key signature — must be byte-stable.
//
// Per CLAUDE.md §9: byte-stable deterministic JSON, no re-stringification downstream.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.AGENT_PORT ?? 9000);
const AGENT_ID = process.env.AGENT_ID ?? 'bob-tapp-spike';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Deterministic, byte-stable JSON: fixed key order, no whitespace.
function stableJson(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);

  // "computes a hash it computed" — sha256 of the exact request body, hex-encoded.
  // (This mirrors the hex(sha256(body)) fold used in the wrapper's own seal-key preimage,
  // per CLAUDE.md §3.1(B) — so the demo shows the SAME hash primitive at two layers:
  // our agent hashes its input; the wrapper hashes our output.)
  const bodyHash = createHash('sha256').update(raw).digest('hex');

  const payload = stableJson({
    agentId: AGENT_ID,
    receivedBytes: raw.length,
    bodyHash,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(payload);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(stableJson({ status: 'healthy', agentId: AGENT_ID }));
    return;
  }
  if (req.method === 'POST' && req.url === '/chat') {
    handleChat(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: String(err) }));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

server.listen(PORT, () => {
  console.log(`[${AGENT_ID}] tapp/chat.ts listening on :${PORT} (POST /chat, GET /health)`);
});
