import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const actionModalSource = readFileSync(new URL('../components/ActionModal.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function declarationsFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected ${selector} to have a CSS rule`);
  return match[1]!;
}

describe('ActionModal player picker styles', () => {
  it('keeps every player picker class emitted by the component styled', () => {
    for (const className of ['player-picker', 'player-pick-btn', 'player-pick-name']) {
      assert.match(actionModalSource, new RegExp(`className="${className}"`));
      declarationsFor(`.${className}`);
    }
  });

  it('renders candidates as full-width, touch-friendly rows', () => {
    const picker = declarationsFor('.player-picker');
    assert.match(picker, /display:\s*flex/);
    assert.match(picker, /flex-direction:\s*column/);

    const button = declarationsFor('.player-pick-btn');
    assert.match(button, /display:\s*flex/);
    assert.match(button, /align-items:\s*center/);
    assert.match(button, /min-height:\s*48px/);

    const name = declarationsFor('.player-pick-name');
    assert.match(name, /flex:\s*1/);
    assert.match(name, /text-overflow:\s*ellipsis/);
  });

  it('retains a distinct disabled state for illegal targets', () => {
    const disabled = declarationsFor('.player-pick-btn:disabled');
    assert.match(disabled, /opacity:\s*0\.35/);
    assert.match(disabled, /cursor:\s*not-allowed/);
  });
});
