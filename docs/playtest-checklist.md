# LAZY SUNDAY — 3-Player Playtest Checklist

Three friends, three browsers (or one host + two guests on their own devices),
one room. This script drives a full match through every rule in
**Section 9 (Edge Cases)** of `lazy-sunday-rules-v1.md`, plus caller-lock, both
scoring branches, tie-to-caller, Great Escape at exactly 100, and mid-game
reconnection.

Players in this script: **Alice** (host), **Bob**, **Carol**. Swap in real
names, just keep track of who's who — the steps say "Alice" etc. throughout.

> **UI note for testers on the M3 build:** as of Milestone 3 the web client has
> lobby + basic turn UI (draw, keep/discard, take-from-DONE, call "NOT ME!").
> The **actions UI** (choosing action targets/slots — Check the List, Knock It
> Out, Let's Trade, Switcheroo, Snoop, Not My Job, Landlord's Notice, I'm Busy)
> and the **slap ("Done it!") button** arrive in **M4/M5**. Steps below that
> need them are marked **[NEEDS M4]** (actions) or **[NEEDS M5]** (slap). On an
> M3 build you can still exercise everything else; skip the marked steps or
> substitute the dev console / `apps/server/scripts/playtest-e2e.ts` to trigger
> the underlying engine command and just observe the resulting view/events.

Legend for "what to verify": each step names the rule section it proves,
matching `lazy-sunday-rules-v1.md` §-numbers and this repo's `CLAUDE.md`
invariants.

---

## 0. Setup

1. Alice opens the app, creates a room (`POST /rooms` via the lobby "create
   game" button), and shares the room code.
2. Bob and Carol join with that code, pick names/colors.
   - **Verify:** all three see a 3-player lobby; Alice is flagged host; all
     three connection dots are green.
3. Alice turns ON both toggles: **Match to 100** and **The Great Escape**
   (§8). Leave turn timeout at default.
   - **Verify:** Bob/Carol's lobby view updates to show both toggles on (host
     controls broadcast to everyone).
4. Alice clicks **Start Game**.
   - **Verify:** all three land in `setupPeek` phase; each sees 6 face-down
     slots per player (18 cards dealt) and a deck count of `54 - 18 - 1 = 35`
     (§3.1–3.2).

---

## 1. Setup peek (§3.3)

5. Each of Alice, Bob, Carol privately picks any 2 of their own 6 cards to
   peek.
   - **Verify:** each player sees ONLY their own 2 revealed cards, privately.
     No one else's screen shows anything. Confirm out loud that nobody else
     can see your screen.
6. Each tries to peek a second time.
   - **Verify:** the client refuses / server would reject with
     `alreadyPeeked` — "once, and never again" (§3.3).
7. Once all three have peeked, the round moves to `turn` phase starting with
   Alice (round 1 starts at seat 0).
   - **Verify:** the UI clearly shows whose turn it is.

---

## 2. Ordinary turns — draw/keep and draw/discard (§4A)

8. Alice draws from the deck, looks at it privately, and **keeps** it into
   any occupied slot.
   - **Verify:** only Alice saw the drawn card. The card it replaced appears
     face-up on the DONE pile for everyone. Bob/Carol never see what Alice
     drew or what was already in that slot.
9. Bob draws and **discards** it face-up onto DONE (declining any action even
   if it's an action card — see §3 below for actually using one).
   - **Verify:** everyone sees the discarded card's identity now that it's
     face-up (discards are public the moment they hit DONE).
10. Carol takes the **top DONE-pile card** into her list instead of drawing.
    - **Verify:** she must swap it in (can't just bounce it back); the card
      she swapped out appears face-up on DONE. Taking from DONE never offers
      an action, even if the card taken is an action card (§4B).

---

## 3. Section 9.4 — Targeting constraints, via real actions **[NEEDS M4]**

Play turns (draw, decline to keep) until each of these action cards comes up
for the *acting* player as the drawn-and-discarded card. Since the deal is
random, keep drawing/discarding chores until one of these actions surfaces
naturally, or (faster) have the host use the dev harness once and just
observe the UI reaction — the point of this section is the UI's target
picker, not manufacturing the exact draw.

11. **Switcheroo drawn and discarded-with-action** by whoever draws it.
    - Try to target **yourself** as one of the two players.
    - **Verify:** UI blocks it, or server returns `invalidTarget` — "Switcheroo
      targets two OTHER players (§9.4)."
    - Now pick two *other* players legitimately.
    - **Verify:** action resolves; a card is blind-swapped between those two
      players only; the acting player's own list is untouched; nobody peeked.
12. **"Not My Job" drawn and discarded-with-action.**
    - Try to move a card *from yourself* or *to yourself*.
    - **Verify:** rejected with `invalidTarget` (§9.4 — must be two players
      other than the actor).
    - Do it correctly: card moves unseen from one opponent's list to another
      opponent's list; list sizes update (the "from" list shrinks, the "to"
      list grows).
13. **Landlord's Notice drawn and discarded-with-action.**
    - Target **yourself**.
    - **Verify:** this is explicitly ALLOWED (§9.4: "may target anyone,
      including the user") — the top deck card goes face-down onto your own
      list, unseen even by you.
    - On a later draw of the same card, target an opponent instead.
    - **Verify:** also allowed, also unseen by anyone.

---

## 4. Section 9.5 — Knock It Out self-discard **[NEEDS M4]**

14. Whoever draws **Knock It Out** and discards-with-action peeks at one of
    their own cards, then chooses to discard it immediately.
    - **Verify:** the peeked card is now face-up on DONE (public). Confirm no
      further action fires — Knock It Out's self-discard is "a normal
      discard" that "triggers no further action" (§9.5), even though the
      discarded card might itself have been an action card.
15. Immediately after that discard, have another player try to quick-discard
    a matching card **[NEEDS M5]**.
    - **Verify:** the slap is legal and resolves normally — §9.5 says this
      discard "may set up quick-discard matches." This confirms Knock It
      Out's output behaves like any other face-up DONE card for slap
      purposes.

---

## 5. Section 9.6 — Simultaneous slap arbitration **[NEEDS M5]**

16. Set up a known DONE top (e.g. via normal play, get "Feed the Cat" on top)
    where at least two players believe they hold a matching card.
17. On a signal ("go!"), have Bob and Carol both hit **Done it!** on their
    matching cards as close to simultaneously as you can manage (within the
    same second).
    - **Verify:** exactly ONE of them gets `slapCorrect`; the other gets
      `slapTooLate` and suffers **no penalty** — "fastest fingers first...
      first tap registered by the server wins... later slaps for the same
      match are returned without penalty" (§6, §9.6). Whichever one is
      "too late" should be able to immediately re-slap the NEW top if it's
      again a match (chain slap) — try it.
18. Have all three fire slaps on the SAME card within the 2-second rate-limit
    window (send 4+ rapid slaps from one player).
    - **Verify:** first few come back `slapTooLate`, and once the per-player
      slap rate limit trips, further slaps get a `rateLimited` error instead
      of being forwarded to the engine (spam protection, not a rule per se,
      but confirms the server doesn't wedge under slap spam).

---

## 6. Section 9.7 — Face-down gift after slapping an opponent **[NEEDS M5]**

19. Have Alice correctly slap one of **Bob's** cards (an opponent card that
    matches DONE's top).
    - **Verify:** Bob's card is exposed face-up on DONE (public — everyone
      saw the identity when it was slapped). Bob's list shrinks by one
      (temporarily — a gap opens). Alice now owes Bob a gift; the game
      pauses everything else until she gives it (`giftPending`).
20. Alice picks ANY card from her own list to give Bob, face-down.
    - **Verify:** Bob's list returns to its original size, with the new card
      inserted at the gap. Bob's UI must NOT reveal what the card is — "the
      receiver may not look at it" (§6, §9.7). Alice (the giver) knows what
      she gave — that's intentional; she should remember it for later.
21. Try, as Bob, to peek at the card you just received.
    - **Verify:** no peek event is delivered to Bob; nothing in the UI shows
      it. This is a private engine invariant — confirm nothing leaks even in
      dev tools / network tab.

---

## 7. Section 9.3 — "I'm Busy" eating the final turn **[NEEDS M4 for casting; works either way for the skip itself]**

This is the most timing-sensitive case — set it up deliberately near the end
of the round.

22. Get the round close to a "NOT ME!" call (any player low on effort).
23. Before calling, have one player draw-and-discard **"I'm Busy"** targeting
    the player who is about to become the caller's *last remaining opponent*
    in turn order — or more simply, target whichever opponent will get the
    LAST final turn after the call.
24. That target player calls **"NOT ME!"** themselves, OR (better test) a
    DIFFERENT player calls "NOT ME!" after the "I'm Busy" flag is already set
    on the eventual last-final-turn player.
    - **Verify sequence:**
      a. "NOT ME!" is called; every other player gets queued exactly one
         final turn, in seat order (§7).
      b. When the queue reaches the player with `skipNextTurn` still set,
         their final turn is skipped outright — the UI should show a
         `turnSkipped` event with `wasFinalTurn: true`, and that player does
         NOT get to act at all before reveal.
      c. **Verify the rule text literally:** "if a skipped player's turn was
         their one final turn after a call, that turn is simply lost. Brutal.
         Intended." (§9.3) — confirm the game does NOT give them a makeup
         turn, does NOT let them draw, and proceeds straight to reveal (or
         the next queued player) as if they'd done nothing.

---

## 8. Caller lock (§7)

25. Before or during final turns, try (as any non-caller) to:
    - target the caller with **Let's Trade**, **Switcheroo**, or
      **Not My Job [NEEDS M4]**
    - **Verify:** rejected with `callerLocked` — the caller's list can't be
      touched by these four actions during final turns.
    - target the caller with **Landlord's Notice**.
    - **Verify:** ALSO rejected — Landlord's Notice is in the caller-lock list
      even though §9.4 lets it target anyone in the *unlocked* case.
    - target the caller with **Snoop** or **"I'm Busy"**.
    - **Verify:** these are ALLOWED even against the locked caller — the lock
      only names Trade/Switcheroo/Not My Job/Landlord's Notice and
      quick-discards (§7).
    - quick-discard (slap) one of the caller's cards **[NEEDS M5]**.
    - **Verify:** rejected with `callerLocked` — "no one may quick-discard the
      caller's cards." The caller themself, however, CAN still slap their own
      cards during this window — have the caller try it on a genuine match.
      **Verify:** it succeeds.

---

## 9. Section 9.1 — Deck exhaustion & reshuffle

26. Deliberately burn through the deck: have players repeatedly draw and
    discard (declining actions) for several rounds of turns. Watch the
    `deckCount` in the UI tick down.
27. When the deck hits 0 and someone draws (or a slap penalty needs to draw),
    watch what happens.
    - **Verify:** a `deckReshuffled` event fires. The DONE pile (all of it
      EXCEPT its current top card) gets shuffled into a fresh deck; the DONE
      pile itself resets to just that one top card. Deck count jumps back up.
      This must happen transparently — the draw or penalty that triggered it
      still completes in the same turn (§9.1).
28. Confirm identities of reshuffled cards are NOT revealed to anyone during
    the reshuffle — it's a silent, private shuffle.

---

## 10. Section 9.2 — Empty list

29. Engineer (via normal trading/slapping/Not My Job over several turns) a
    player down to **0 cards** in their list. (Repeated correct self-slaps or
    being on the losing end of a few Not My Job / Switcheroo moves gets you
    there fastest.)
    - **Verify:** the UI shows that player's list size as 0, not an error
      state, not frozen.
30. On that player's turn, have them **draw and keep**.
    - **Verify:** per §9.2 "draw-and-keep only adds a card back" — the card
      goes straight into the (only) slot 0, with no card discarded in
      exchange. There is no `discarded` card in the resulting event.
31. On a later turn (or the same test player after being re-populated and
    re-emptied), have them **draw and discard** instead.
    - **Verify:** allowed normally — discarding doesn't need a list at all.
32. Have the empty-list player try to **take from the DONE pile**.
    - **Verify:** rejected (`emptyList`) — taking from DONE requires swapping
      out a card you don't have. They must draw from the deck or call "NOT
      ME!" instead.
33. Have the empty-list player call **"NOT ME!"**.
    - **Verify:** allowed — §9.2 explicitly permits calling "NOT ME!" with an
      empty list; their total is 0 for scoring purposes.

---

## 11. Calling "NOT ME!" and both scoring branches (§7)

34. **Branch A — caller wins (strictly lowest or tied-lowest):** engineer a
    round (via peeking/trading/memory) where the caller genuinely holds the
    lowest total, or exactly ties another player's total. Call "NOT ME!",
    play out final turns, reach reveal.
    - **Verify:** caller scores **0**. Everyone else scores their own
      face-up total. If it was an exact tie, confirm the rule text: "ties go
      to the caller" — the tying opponent does NOT also get 0, they score
      their own total (whatever it equals).
35. **Branch B — caller loses:** engineer (or just let it happen naturally)
    a round where at least one opponent strictly beats the caller's total.
    - **Verify:** caller scores **50** (not their actual total). Every other
      player, INCLUDING the one who actually had the best total, scores
      their own face-up total — nobody else gets a bonus for beating the
      caller; the 50 penalty is purely on the caller.
36. In both branches, confirm the reveal screen shows all lists face-up with
    correct per-card efforts and a matching sum, for all three players.

---

## 12. The Great Escape at exactly 100 (§8)

37. Across several rounds, track cumulative scores (visible in lobby/between
    rounds standings). Engineer (via choosing who calls and roughly steering
    totals — this needs a few rounds of setup, or deliberately bad play) a
    player's cumulative score to land on **exactly 100** after a round's
    scoring is applied.
    - **Verify:** a `greatEscape` event fires for that player and their score
      **resets to 50**, not staying at 100 and not continuing to accumulate
      past it. Confirm this check happens BEFORE the Match-to-100 end check —
      landing exactly on 100 should NOT end the match if Great Escape is on;
      it should bounce them back to 50 and the match continues.
38. As a control, get a DIFFERENT player's score to cross 100 by landing
    ABOVE it (e.g. 97 -> 110), not exactly on it.
    - **Verify:** no Great Escape triggers for them (didn't land exactly on
      100); instead this should trigger match-over (§8 Match to 100): the
      match ends immediately, and the player(s) with the LOWEST cumulative
      score are declared winners (`matchOver` event, `winners` list) — note
      the winner is NOT necessarily the person who crossed 100; it's whoever
      has the lowest total at that moment, which could be anyone.
39. Confirm the lobby "next round" control disables/hides once `matchOver` is
    true.

---

## 13. Reconnection mid-game

40. Mid-round (any phase except reveal), have Bob force-quit his browser tab
    or kill his network connection.
    - **Verify:** Alice and Carol's lobby view shows Bob as disconnected
      (red/grey dot) but the game does NOT halt — if it becomes Bob's turn,
      the turn timer should eventually auto-skip him via `forceSkipTurn`
      (give it the configured timeout; default 45s, consider lowering the
      timeout toggle before this test to avoid a long wait).
41. Bob reopens the app and rejoins the SAME room with the SAME name — the
    client should reuse his stored reconnection token automatically (same
    browser/local storage) rather than creating a new player.
    - **Verify:** Bob reappears in the exact same seat, with the exact same
      list size he had before disconnecting (his hidden knowledge — anything
      he peeked before — is only what he personally remembers; the server
      does not replay old peeks to him, by design). His `connected` flag
      flips back to green for Alice/Carol.
42. If it was Bob's turn and he reconnects before the timeout fires, confirm
    he can act normally, picking up exactly where the round left off (whatever
    phase — `turn`/`drawn`/`action`/mid-gift — the round should NOT have
    silently advanced without him except via an actual timeout).

---

## 14. Wrap-up sanity

43. Run at least one full round to natural completion (someone calls "NOT
    ME!", final turns complete without any "I'm Busy" games, reveal happens)
    to confirm the "boring path" still works after all this edge-case abuse.
44. Confirm cumulative standings are stable and consistent with manual
    addition across however many rounds you played.

---

### Quick reference: which section maps to which step

| §9 case | Step(s) |
|---|---|
| 9.1 deck exhaustion/reshuffle | 26–28 |
| 9.2 empty list | 29–33 |
| 9.3 "I'm Busy" eats final turn | 22–24 |
| 9.4 targeting constraints | 11–13 |
| 9.5 Knock It Out self-discard | 14–15 |
| 9.6 simultaneous slap | 16–18 |
| 9.7 face-down gift after slap | 19–21 |
| Caller lock | 25 |
| Scoring: caller wins / ties | 34 |
| Scoring: caller loses | 35 |
| Great Escape at exactly 100 | 37 |
| Match-to-100 end / winners | 38–39 |
| Reconnection | 40–42 |
