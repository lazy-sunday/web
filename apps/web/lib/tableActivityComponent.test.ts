import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const componentSource = readFileSync(new URL('../components/TableActivity.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

describe('center-table announcement rendering', () => {
  it('shows concise copy while announcing the detailed activity text', () => {
    assert.match(componentSource, /\{entry\.centerText \?\? entry\.text\}/);
    assert.match(componentSource, /className="action-announce-text" aria-hidden/);
    assert.match(componentSource, /className="action-announce-sr">\{entry\.text\}<\/span>/);
  });

  it('visually hides the detailed screen-reader copy', () => {
    const rule = globalStyles.match(/\.action-announce-sr\s*\{([^}]*)\}/);
    assert.ok(rule, 'Expected .action-announce-sr to have a CSS rule');
    assert.match(rule[1]!, /position:\s*absolute/);
    assert.match(rule[1]!, /width:\s*1px/);
    assert.match(rule[1]!, /overflow:\s*hidden/);
  });
});
