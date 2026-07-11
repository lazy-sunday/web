// LAZY SUNDAY authoritative game server.
// HTTP: POST /rooms creates a room. WS: everything else (see protocol.ts).

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { isValidDeckCount } from '@lazy-sunday/engine';
import { handleConnection } from './gameRoom.js';
import { createRoom, roomCount, startSweeper } from './rooms.js';

const PORT = Number(process.env['PORT'] ?? 8787);

const httpServer = createServer(async (req, res) => {
  // CORS: rooms are unguessable codes, not secrets; open CORS keeps dev simple.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'POST' && req.url === '/rooms') {
    const body = await readJsonBody(req);
    const deckCount = body && typeof body === 'object' && 'deckCount' in body ? body.deckCount : undefined;
    if (deckCount !== undefined && !isValidDeckCount(deckCount)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'deckCount must be an integer from 1 to 3' }));
      return;
    }
    const room = createRoom(deckCount);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: room.code }));
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (socket) => handleConnection(socket));

startSweeper();

httpServer.listen(PORT, () => {
  console.log(`[lazy-sunday] server listening on :${PORT}`);
});
