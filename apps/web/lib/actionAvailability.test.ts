import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { unavailableActionMessage } from './actionMeta';

const gameTableSource = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');

describe('two-other-player action availability', () => {
  it('uses a natural two-player note for effort 10 and 12', () => {
    const note = unavailableActionMessage('needsTwoOtherPlayers');
    assert.equal(note, 'Bring more friends for more fun. This action needs at least 3 players.');
  });

  it('disables only Play and keeps Just discard available', () => {
    assert.match(gameTableSource, /disabled=\{inFlight \|\| actionUnavailableReason !== null\}/);
    assert.match(gameTableSource, /aria-describedby=\{actionUnavailableReason \? 'action-unavailable-note' : undefined\}/);
    assert.match(gameTableSource, /className="decision-unavailable-note"/);
    assert.match(gameTableSource, /className="btn btn-ghost" disabled=\{inFlight\} onClick=\{onDiscard\}/);
  });
});
