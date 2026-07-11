// Scripted verification client (Milestone 2).
//
// Creates a room over HTTP, joins 3 fake players over WebSocket, toggles Great
// Escape, starts the game, performs setup peeks, plays several turns from the
// per-player views, kills one socket and rejoins with its token to prove
// seat+view recovery, exercises the slap rate limit, and finally audits EVERY
// message each client ever received to prove no face-down card identity leaked
// outside the allowed contexts.
//
// Run:  PORT=8790 npm run dev -w @lazy-sunday/server   (or tsx src/main.ts)
//       npx tsx apps/server/scripts/verify-client.ts

import WebSocket from 'ws';
import { CARD_SPECS } from '@lazy-sunday/engine';

const PORT = Number(process.env['PORT'] ?? 8790);
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;

const CARD_NAMES = new Set<string>(CARD_SPECS.map((s) => s.name));

let failures = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------

type Json = Record<string, any>;

class Client {
  name: string;
  ws!: WebSocket;
  /** Everything this client ever received, for the privacy audit. */
  received: Json[] = [];
  playerId = '';
  token = '';
  lobby: Json | null = null;
  view: Json | null = null;
  private waiters: { pred: (m: Json) => boolean; resolve: (m: Json) => void }[] = [];

  constructor(name: string) {
    this.name = name;
  }

  connect(): Promise<void> {
    this.ws = new WebSocket(WS);
    this.ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Json;
      this.received.push(msg);
      if (msg['type'] === 'joined') {
        this.playerId = msg['playerId'];
        this.token = msg['token'];
      }
      if (msg['type'] === 'lobby') this.lobby = msg['lobby'];
      if (msg['type'] === 'view') this.view = msg['view'];
      for (const w of this.waiters.splice(0)) {
        if (w.pred(msg)) w.resolve(msg);
        else this.waiters.push(w);
      }
    });
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: Json): void {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor(pred: (m: Json) => boolean, label: string, timeoutMs = 5000): Promise<Json> {
    // check nothing already matched? (messages are consumed live; callers order carefully)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for ${label}`)), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  }

  waitEvent(type: string, extra?: (e: Json) => boolean, timeoutMs = 5000): Promise<Json> {
    return this.waitFor(
      (m) => m['type'] === 'event' && m['event']?.type === type && (!extra || extra(m['event'])),
      `event ${type}`,
      timeoutMs,
    );
  }
}

// ---------------------------------------------------------------------------
// Privacy audit
// ---------------------------------------------------------------------------

/** Find every path in `obj` where a card identity (a known card name) appears. */
function findCardNames(obj: unknown, path: string, hits: { path: string; name: string }[]): void {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findCardNames(v, `${path}[${i}]`, hits));
    return;
  }
  for (const [k, v] of Object.entries(obj as Json)) {
    if (k === 'name' && typeof v === 'string' && CARD_NAMES.has(v)) {
      hits.push({ path, name: v });
    }
    findCardNames(v, `${path}.${k}`, hits);
  }
}

/** Allowed contexts for a card identity in a message delivered to `recipientId`:
 *  doneTop, kept.discarded, discarded, tookFromDone, knockedOut, slap events,
 *  drawnCard/peek addressed to that player, and the round reveal. */
function isAllowedCardContext(msg: Json, hitPath: string, recipientId: string): boolean {
  if (msg['type'] === 'view') {
    if (hitPath.startsWith('$.view.doneTop')) return true;
    if (hitPath.startsWith('$.view.myDrawnCard')) return true; // viewFor only sets this for the recipient
    if (hitPath.startsWith('$.view.result.lists')) return true; // reveal is public
    return false;
  }
  if (msg['type'] === 'event') {
    const e = msg['event'] as Json;
    switch (e['type']) {
      case 'peek':
      case 'drawnCard':
        return e['to'] === recipientId; // private, must be addressed to the recipient
      case 'kept':
        return hitPath.startsWith('$.event.discarded');
      case 'discarded':
        return hitPath.startsWith('$.event.card');
      case 'tookFromDone':
        return hitPath.startsWith('$.event.taken') || hitPath.startsWith('$.event.discarded');
      case 'knockedOut':
      case 'slapCorrect':
      case 'slapWrong':
        return hitPath.startsWith('$.event.card');
      case 'roundRevealed':
        return hitPath.startsWith('$.event.result.lists');
      default:
        return false;
    }
  }
  return false;
}

function auditClient(c: Client): number {
  let violations = 0;
  for (const msg of c.received) {
    const hits: { path: string; name: string }[] = [];
    findCardNames(msg, '$', hits);
    for (const hit of hits) {
      if (!isAllowedCardContext(msg, hit.path, c.playerId)) {
        violations++;
        console.error(
          `LEAK to ${c.name}: "${hit.name}" at ${hit.path} in ${JSON.stringify(msg).slice(0, 200)}`,
        );
      }
    }
    // Belt and braces: a raw RoundState would carry these keys.
    const s = JSON.stringify(msg);
    if (s.includes('"rngState"') || s.includes('"finalTurnQueue"') && msg['type'] !== 'view') {
      // finalTurnQueue is part of RoundView (fine); rngState never is.
    }
    if (s.includes('"rngState"')) {
      violations++;
      console.error(`LEAK to ${c.name}: raw RoundState (rngState) in a message`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('== health check ==');
  const health = await fetch(`${HTTP}/health`).then((r) => r.json());
  assert(health.ok === true, 'server is up');

  console.log('== create room over HTTP ==');
  const { code } = (await fetch(`${HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckCount: 2 }),
  }).then((r) => r.json())) as {
    code: string;
  };
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(code), `room code ${code} uses the unambiguous alphabet`);

  console.log('== join 3 players ==');
  const alice = new Client('alice');
  const bob = new Client('bob');
  const carol = new Client('carol');
  for (const [c, color] of [
    [alice, '#F5A62B'],
    [bob, '#8FA2DC'],
    [carol, '#6BA368'],
  ] as const) {
    await c.connect();
    const joined = c.waitFor((m) => m['type'] === 'joined', 'joined');
    c.send({ type: 'join', roomCode: code, name: c.name, color });
    await joined;
    assert(c.playerId.length > 0 && c.token.length > 0, `${c.name} got playerId + token`);
  }
  await alice.waitFor((m) => m['type'] === 'lobby' && m['lobby'].players.length === 3, '3-player lobby');
  assert(alice.lobby!['players'][0].isHost === true, 'first joiner is host');
  assert(alice.lobby!['players'].every((p: Json) => p['connected'] === true), 'all connection dots green');
  assert(alice.lobby!['toggles'].deckCount === 2, 'room creation selected two decks');

  console.log('== toggles ==');
  const nonHostErr = bob.waitFor((m) => m['type'] === 'error', 'notHost error');
  bob.send({ type: 'setToggle', toggle: 'greatEscape', value: true });
  assert((await nonHostErr)['code'] === 'notHost', 'non-host cannot toggle');
  const nonHostDeckErr = bob.waitFor((m) => m['type'] === 'error', 'notHost deck-count error');
  bob.send({ type: 'setToggle', toggle: 'deckCount', value: 3 });
  assert((await nonHostDeckErr)['code'] === 'notHost', 'non-host cannot change deck count');
  const toggled = alice.waitFor(
    (m) => m['type'] === 'lobby' && m['lobby'].toggles.greatEscape === true,
    'greatEscape on',
  );
  alice.send({ type: 'setToggle', toggle: 'greatEscape', value: true });
  await toggled;
  assert(true, 'host toggled Great Escape');
  const deckCountChanged = alice.waitFor(
    (m) => m['type'] === 'lobby' && m['lobby'].toggles.deckCount === 3,
    'deck count changed',
  );
  alice.send({ type: 'setToggle', toggle: 'deckCount', value: 3 });
  await deckCountChanged;
  assert(true, 'host changed deck count before starting');

  console.log('== start game ==');
  const notHostStart = carol.waitFor((m) => m['type'] === 'error', 'notHost start');
  carol.send({ type: 'startGame' });
  assert((await notHostStart)['code'] === 'notHost', 'non-host cannot start');
  const viewsUp = Promise.all(
    [alice, bob, carol].map((c) => c.waitFor((m) => m['type'] === 'view', 'first view')),
  );
  alice.send({ type: 'startGame' });
  await viewsUp;
  assert(alice.view!['phase'] === 'setupPeek', 'round begins in setupPeek');
  assert(alice.view!['deckCount'] === 162 - 18 - 1, 'deck = 3x54 - 3x6 dealt - 1 DONE flip');
  const deckLocked = alice.waitFor((m) => m['type'] === 'error', 'deck-count lock error');
  alice.send({ type: 'setToggle', toggle: 'deckCount', value: 1 });
  assert((await deckLocked)['code'] === 'wrongStatus', 'deck count locks after the game starts');
  assert(alice.view!['deckCount'] === 162 - 18 - 1, 'locked deck count leaves the active round unchanged');
  assert(
    [alice, bob, carol].every((c) => c.view!['players'].every((p: Json) => p['listSize'] === 6)),
    'everyone sees 6 face-down slots per player',
  );

  console.log('== setup peeks ==');
  for (const c of [alice, bob, carol]) {
    const peek = c.waitEvent('peek');
    c.send({ type: 'command', command: { type: 'setupPeek', slots: [0, 1] } });
    const e = (await peek)['event'] as Json;
    assert(
      e['to'] === c.playerId && e['reveals'].length === 2 && CARD_NAMES.has(e['reveals'][0].card.name),
      `${c.name} received their own 2-card peek`,
    );
  }
  await alice.waitFor((m) => m['type'] === 'view' && m['view'].phase === 'turn', 'turn phase');
  assert(alice.view!['currentPlayer'] === alice.playerId, 'round 1 starts at seat 0 (alice)');

  const clientById = new Map([alice, bob, carol].map((c) => [c.playerId, c]));

  async function playOneTurn(style: 'keep' | 'discard'): Promise<void> {
    const currentId = alice.view!['currentPlayer'] as string;
    const cur = clientById.get(currentId)!;
    const drawn = cur.waitEvent('drawnCard');
    cur.send({ type: 'command', command: { type: 'draw' } });
    const card = ((await drawn)['event'] as Json)['card'] as Json;
    const done = alice.waitFor(
      (m) =>
        m['type'] === 'event' &&
        (m['event'].type === 'kept' || m['event'].type === 'discarded') &&
        m['event'].player === currentId,
      'turn resolution',
    );
    if (style === 'keep') {
      cur.send({ type: 'command', command: { type: 'keepDrawn', slot: 2 } });
    } else {
      cur.send({ type: 'command', command: { type: 'discardDrawn', withAction: false } });
    }
    const resolution = (await done)['event'] as Json;
    if (style === 'keep') {
      assert(
        resolution['type'] === 'kept' && CARD_NAMES.has(resolution['discarded'].name),
        `${cur.name} kept ${card['name'] ? 'their drawn card' : '?'} — replaced card went face-up to DONE`,
      );
    } else {
      assert(resolution['type'] === 'discarded' && resolution['card'].name === card['name'],
        `${cur.name} discarded the drawn card face-up`);
    }
    await alice.waitFor((m) => m['type'] === 'view' && m['view'].currentPlayer !== currentId, 'next turn view');
  }

  console.log('== play three turns (draw/keep, draw/discard) ==');
  await playOneTurn('keep'); // alice
  await playOneTurn('discard'); // bob
  await playOneTurn('keep'); // carol

  console.log('== wrong-turn command is rejected ==');
  {
    const notYourTurn = bob.waitFor((m) => m['type'] === 'error', 'notYourTurn');
    bob.send({ type: 'command', command: { type: 'draw' } });
    const err = await notYourTurn;
    assert(err['code'] === 'notYourTurn' || err['code'] === 'wrongPhase', `bob out-of-turn draw rejected (${err['code']})`);
  }

  console.log('== kill bob and rejoin with his token ==');
  const bobToken = bob.token;
  const bobId = bob.playerId;
  const bobListSize = bob.view!['players'].find((p: Json) => p['id'] === bobId)!['listSize'];
  bob.ws.terminate();
  await alice.waitFor(
    (m) =>
      m['type'] === 'lobby' &&
      m['lobby'].players.find((p: Json) => p.id === bobId)?.connected === false,
    'bob shows disconnected',
  );
  assert(true, 'others see bob disconnected');

  const bob2 = new Client('bob2');
  await bob2.connect();
  const rejoined = bob2.waitFor((m) => m['type'] === 'joined', 'rejoined');
  const viewBack = bob2.waitFor((m) => m['type'] === 'view', 'view after rejoin');
  const reconnected = alice.waitFor(
    (m) =>
      m['type'] === 'lobby' &&
      m['lobby'].players.find((p: Json) => p.id === bobId)?.connected === true,
    'bob shows reconnected',
  );
  bob2.send({ type: 'join', roomCode: code, name: 'bob', color: '#8FA2DC', token: bobToken });
  await rejoined;
  assert(bob2.playerId === bobId, 'token rejoin recovers the same seat/playerId');
  await viewBack;
  assert(
    bob2.view!['players'].find((p: Json) => p['id'] === bobId)!['listSize'] === bobListSize,
    'rejoined view matches pre-kill list size',
  );
  assert(bob2.view!['phase'] === 'turn', 'rejoined mid-game straight into the turn phase');
  await reconnected;
  assert(true, 'others see bob reconnected');

  console.log('== three more turns with the rejoined socket ==');
  const order = [alice, bob2, carol];
  clientById.set(bobId, bob2);
  await playOneTurn('discard');
  await playOneTurn('keep');
  await playOneTurn('discard');
  void order;

  console.log('== slap rate limit (stale expectedTopId, so no state change) ==');
  {
    // carol fires 4 slaps inside 2s; first 3 come back slapTooLate, the 4th is dropped
    let tooLate = 0;
    let rateLimited = 0;
    const doneCollecting = new Promise<void>((resolve) => {
      const check = () => {
        if (tooLate + rateLimited >= 4) resolve();
      };
      carol.ws.on('message', (raw: Buffer) => {
        const m = JSON.parse(raw.toString()) as Json;
        if (m['type'] === 'event' && m['event'].type === 'slapTooLate' && m['event'].player === carol.playerId) {
          tooLate++;
          check();
        }
        if (m['type'] === 'error' && m['code'] === 'rateLimited') {
          rateLimited++;
          check();
        }
      });
    });
    for (let i = 0; i < 4; i++) {
      carol.send({
        type: 'command',
        command: { type: 'slap', owner: alice.playerId, slot: 0, expectedTopId: 'stale-id-on-purpose' },
      });
    }
    await Promise.race([
      doneCollecting,
      new Promise((_, rej) => setTimeout(() => rej(new Error('slap test timeout')), 5000)),
    ]);
    assert(tooLate === 3 && rateLimited === 1, `3 slaps returned tooLate, 4th rate-limited (${tooLate}/${rateLimited})`);
  }

  console.log('== forceSkipTurn is not client-sendable ==');
  {
    const err = carol.waitFor((m) => m['type'] === 'error', 'forceSkip rejected');
    carol.send({ type: 'command', command: { type: 'forceSkipTurn' } });
    assert((await err)['code'] === 'badMessage', 'client forceSkipTurn rejected');
  }

  console.log('== privacy audit: no face-down identity ever left the server ==');
  let leaks = 0;
  for (const c of [alice, bob, bob2, carol]) leaks += auditClient(c);
  assert(leaks === 0, `0 leaks across ${[alice, bob, bob2, carol].reduce((n, c) => n + c.received.length, 0)} delivered messages`);

  // Cross-check: bob's peek reveals were never delivered to alice/carol.
  const foreignPeeks = [alice, carol].flatMap((c) =>
    c.received.filter((m) => m['type'] === 'event' && m['event'].type === 'peek' && m['event'].to !== c.playerId),
  );
  assert(foreignPeeks.length === 0, 'no peek event was delivered to a non-addressee');

  for (const c of [alice, bob2, carol]) c.ws.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('VERIFICATION CRASHED:', err);
  process.exit(1);
});
