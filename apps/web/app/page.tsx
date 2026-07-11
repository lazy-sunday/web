'use client';

// Landing: fridge-door branding, Create room, Join with code, rules link.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HTTP_URL } from '../lib/config';

export default function LandingPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [deckCount, setDeckCount] = useState(1);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${HTTP_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckCount }),
      });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      const body = (await res.json()) as { code: string };
      router.push(`/r/${body.code}`);
    } catch {
      setError('Could not reach the game server. Is it running?');
      setCreating(false);
    }
  }

  function joinWithCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('Room codes are 6 letters/numbers.');
      return;
    }
    router.push(`/r/${trimmed}`);
  }

  return (
    <main className="shell landing">
      <div className="fridge">
        <div className="fridge-note">
          <h1 className="brand-title">LAZY SUNDAY</h1>
          <p className="brand-tagline">
            Dodge your chore list. Protect your day off. Shout &quot;Not me!&quot;
          </p>
        </div>
      </div>

      <div className="landing-actions">
        <button type="button" className="btn btn-primary btn-block" onClick={createRoom} disabled={creating}>
          {creating ? 'Setting up the fridge…' : 'Create room'}
        </button>

        <label className="create-setting">
          <span>
            <strong>Decks per room</strong>
            <small>Choose the table size before you invite everyone in.</small>
          </span>
          <select
            value={deckCount}
            aria-label="Decks per room"
            disabled={creating}
            onChange={(e) => setDeckCount(Number(e.target.value))}
          >
            {[1, 2, 3].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? 'deck' : 'decks'}
              </option>
            ))}
          </select>
        </label>

        <form className="join-row" onSubmit={joinWithCode}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Join with code"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Room code"
          />
          <button type="submit" className="btn btn-night">
            Join
          </button>
        </form>

        {error && <p className="form-error" role="alert">{error}</p>}

        <p className="rules-link">
          First Sunday? <Link href="/rules">Read the house rules</Link>
        </p>
      </div>
    </main>
  );
}
