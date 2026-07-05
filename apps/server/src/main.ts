// LAZY SUNDAY authoritative game server.
// HTTP: POST /rooms creates a room. WS: everything else (see protocol.ts).

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './gameRoom.js';
import { createRoom, roomCount, startSweeper } from './rooms.js';

const PORT = Number(process.env['PORT'] ?? 8787);

const httpServer = createServer((req, res) => {
  // CORS: rooms are unguessable codes, not secrets; open CORS keeps dev simple.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'POST' && req.url === '/rooms') {
    const room = createRoom();
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

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (socket) => handleConnection(socket));

startSweeper();

httpServer.listen(PORT, () => {
  console.log(`[lazy-sunday] server listening on :${PORT}`);
});
