# LAZY SUNDAY — Master Rules v1.1

*Dodge your chore list. Protect your day off. Shout "Not me!"*

**Players:** 2–7 · **Age:** 10+ · **Time:** ~20 min per match
**Website:** playlazysunday.com

---

## 1. Overview

It's Sunday morning. The chore list is on the fridge, and nobody wants to do any of it.
Each player has a face-down **chore list** of 6 cards. Every card carries an **effort
value** — the goal is to end the round with the **lowest total effort**. You barely
remember what's on your own list; peeking, trading, sabotage, and a sharp memory are
how you win.

When you think your list is the lightest in the flat, shout **"NOT ME!"** — if you're
right, you lounge on the couch. If you're wrong, you're stuck doing everything.

---

## 2. The Deck (54 cards)

Every card is either a **Chore** (dead weight) or an **Action** (a move you can play).
Each card shows its name and its effort value.

### Chore cards

| Card | Effort | Copies |
|------|--------|--------|
| **Nap** | 0 | 2 |
| **Feed the Cat** | 2 | 4 |
| **Water the Plants** | 3 | 4 |
| **Take Out the Trash** | 4 | 4 |
| **Fold the Laundry** | 5 | 4 |
| **Vacuum the Living Room** | 6 | 4 |

### Action cards

| Card | Effort | Copies |
|------|--------|--------|
| **"I'm Busy"** | 1 | 4 |
| **Check the List** | 7 | 4 |
| **Knock It Out** | 8 | 4 |
| **"Let's Trade"** | 9 | 4 |
| **Switcheroo** | 10 | 4 |
| **Snoop** | 11 | 4 |
| **"Not My Job"** | 12 | 4 |
| **Landlord's Notice** | 13 | 4 |

Action cards are heavy to *hold* — their effort only stops counting against you if you
burn them for their action. The one exception is **"I'm Busy"**: nearly weightless to
hold, so keeping it in your list is often better than playing it. Choose wisely.

---

## 3. Setup

1. Shuffle. Deal **6 cards face-down** to each player, arranged in a row in front of
   them. This is their **chore list**. Cards stay face-down and in place all round.
2. Place the rest as the **deck**. Flip the top card face-up beside it to start the
   **DONE pile**.
3. Before the first turn, each player secretly **peeks at any 2** of their own cards —
   once, and never again. Memory is the game.

---

## 4. Taking a Turn

On your turn, do exactly ONE of the following:

**A. Draw from the deck.** Look at the card privately, then either:
   - **Keep it:** place it face-down into your list, and discard the card it replaced
     face-up onto the DONE pile; or
   - **Discard it** straight onto the DONE pile. If it is an **Action card**, you may
     perform its action as you discard it. Actions trigger ONLY on cards drawn from
     the deck.

**B. Take the top DONE-pile card.** You must swap it into your list (discarding the
   replaced card face-up). You may not take it just to throw it back. Taking from the
   DONE pile never triggers an action.

**C. Call "NOT ME!"** — see Section 7.

---

## 5. The Eight Actions

An action triggers only when its card is **drawn from the deck and discarded** on your
turn. Performing the action is always optional.

| Action card | Effort | What it does |
|-------------|--------|--------------|
| **Check the List** | 7 | Peek at ONE of your own cards. |
| **Knock It Out** | 8 | Peek at ONE of your own cards; you may immediately discard it to the DONE pile (any value). |
| **"Let's Trade"** | 9 | Blind-swap: exchange any ONE of your cards with any ONE opponent card. No peeking. (You know what you gave — remember it.) |
| **Switcheroo** | 10 | Blind-swap any TWO cards between TWO OTHER players. You are never involved, and nobody peeks. |
| **Snoop** | 11 | Peek at any ONE opponent card. (Knowledge you can weaponize — see Section 6.) |
| **"Not My Job"** | 12 | Move ONE card, unseen, from one opponent's list to another opponent's list. Their list sizes change. Never involves you. |
| **Landlord's Notice** | 13 | Take the top deck card and place it face-down onto ANY player's list (including your own, if you dare). No one sees it. |
| **"I'm Busy"** | 1 | Choose a player: their next turn is skipped. |

---

## 6. "Done it!" — The Quick Discard (any time, fastest fingers first)

At ANY moment — on anyone's turn — if you believe a card is the **same card** as the
top of the DONE pile (same name, same effort), you may slam it onto the pile:

- **Your own card, correct:** it stays discarded. Your list shrinks by one. 🎉
- **An OPPONENT's card, correct:** their card stays discarded, and you must immediately
  give them ONE of your own cards (your choice, passed face-down) to fill the gap.
  Your list shrinks by one; theirs stays the same size. You know what you gave them —
  hunt it later.
- **Wrong (either case):** the slapped card returns face-down to its owner's list, and
  YOU draw one penalty card from the deck onto your own list.

Rules of engagement:
- Fastest fingers first: the first card to touch the pile wins. Later slaps for the
  same match are returned without penalty.
- Action cards discarded this way do NOT trigger their actions.
- You may not quick-discard during the resolution of an action (finish it first).

---

## 7. Calling "NOT ME!"

- Call at the START of your turn, instead of taking one.
- Every other player then gets exactly ONE final turn. During these final turns, the
  caller's list is **locked**: no "Let's Trade", Switcheroo, "Not My Job", or
  Landlord's Notice may touch it, and no one may quick-discard the caller's cards.
  (The caller may still quick-discard their own.)
- After the final turns, all lists flip face-up and totals are counted.

**Scoring the round:**
- Caller has the lowest total (ties go to the caller): caller scores **0**. Everyone
  else scores their own total.
- Anyone strictly beats the caller: caller scores **50**. Everyone else (including the
  actual lowest) scores their own total.

Lowest cumulative score across rounds wins the session.

---

## 8. Optional Rules

- **Match to 100:** play rounds until any player's cumulative score crosses 100; at
  that moment, the player with the LOWEST total wins the match.
- **The Great Escape:** land on EXACTLY 100 and your score resets to 50.

---

## 9. Edge Cases (also the app's rule engine spec)

1. **Deck runs out:** shuffle the DONE pile (except its top card) into a new deck.
2. **Empty list:** a player with 0 cards has a count of 0. They may still take turns
   (draw-and-keep only adds a card back; draw-and-discard is allowed) or call
   "NOT ME!".
3. **"I'm Busy" vs. final turn:** if a skipped player's turn was their one final turn
   after a call, that turn is simply lost. Brutal. Intended.
4. **Targeting:** "Not My Job" and Switcheroo must target two players other than the
   user. Landlord's Notice may target anyone, including the user.
5. **Knock It Out self-discard:** discarding via Knock It Out counts as a normal
   discard (it may set up quick-discard matches) but triggers no further action.
6. **Simultaneous slap:** physically first card down wins; in the app, first tap
   registered by the server wins.
7. **Giving a card after slapping an opponent:** the giver chooses which card; it is
   passed face-down; the receiver may not look at it.

---

## 10. Glossary

- **Chore list** — your row of face-down cards.
- **Chore card** — a card that is pure effort; it does nothing but weigh you down.
- **Action card** — a card that can be burned for a move when drawn from the deck.
- **DONE pile** — the face-up discard pile.
- **Done it!** — the any-time quick discard.
- **"NOT ME!"** — the round-ending call.
- **Effort** — points; lowest wins.
- **Nap** — the 0-effort card. The best thing on any Sunday list.

---

*Version 1.1 — locked ruleset for the printable deck and the app. The Extended Edition
(new chores, new actions, custom card counts) builds on top of this document.*
