import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const gameTableSource = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

describe('visible table slot numbers', () => {
  it('renders a slot badge for occupied and empty slots in every player area', () => {
    const badgeUses = gameTableSource.match(/<SlotNumber visualSlot=\{slot\.visualSlot\} \/>/g) ?? [];

    assert.equal(badgeUses.length, 6);
    assert.match(gameTableSource, /className="slot-number" aria-hidden="true"/);
  });

  it('keeps badges readable without intercepting card controls', () => {
    const rule = globalStyles.match(/\.slot-number\s*\{([^}]*)\}/);
    assert.ok(rule, 'Expected .slot-number to have a CSS rule');
    assert.match(rule[1]!, /position:\s*absolute/);
    assert.match(rule[1]!, /background:\s*rgba\(35, 46, 82, 0\.94\)/);
    assert.match(rule[1]!, /font-variant-numeric:\s*tabular-nums/);
    assert.match(rule[1]!, /pointer-events:\s*none/);
  });
});
