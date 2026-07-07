# Deployment and Configuration

The repository currently contains separate server and web packages. Deployment can be done as separate services or as a combined platform setup, but the current code expects the browser to talk to the realtime server through a configured WebSocket URL.

## Server Runtime

Package: `@lazy-sunday/server`

Entrypoint:

```sh
npm run start -w @lazy-sunday/server
```

Development:

```sh
npm run dev:server
```

Environment:

- `PORT`: HTTP/WebSocket port. Defaults to `8787`.

HTTP endpoints:

- `POST /rooms`: create room.
- `GET /health`: health check and room count.

The server uses in-memory rooms. A deploy restart drops live rooms. Keep one server replica unless room state is moved to a shared store.

## Web Runtime

Package: `@lazy-sunday/web`

Development:

```sh
npm run dev:web
```

Production build:

```sh
npm run build -w @lazy-sunday/web
npm run start -w @lazy-sunday/web
```

Environment:

- `NEXT_PUBLIC_WS_URL`: WebSocket URL for the game server. Defaults to `ws://localhost:8787`.

The web app derives the HTTP URL for room creation by replacing the `ws` scheme with `http`. For production, use a secure `wss://` URL so derived room creation uses `https://`.

## Health Checks

Use `GET /health` for the current server. It returns JSON similar to:

```json
{ "ok": true, "rooms": 0 }
```

If a hosting provider expects a different path such as `/healthz`, add that endpoint deliberately and update this document.

## Realtime Deployment Notes

- WebSockets require a host/proxy that supports HTTP upgrade.
- Idle proxy timeouts may close sockets; the client automatically reconnects with its room token.
- Reconnection restores the seat only while the room still exists in server memory.
- Multiple replicas will not share rooms.
- A deploy restart is observable by players as room loss unless persistence is added.

## Production Checklist

- Set `PORT` as required by the host.
- Set `NEXT_PUBLIC_WS_URL` to the public `wss://` server URL.
- Confirm `POST /rooms` works from the deployed web origin.
- Confirm `GET /health` returns 200.
- Create a room from the deployed web app.
- Join from two browsers or devices.
- Refresh during a round and confirm token-based reconnect.
- Test a slap from two clients and confirm exactly one winner.
- Run an engine test pass before deploying code that changes rules.

See [Realtime server](./realtime-server.md) for server behavior and [Testing and verification](./testing.md) for checks.
