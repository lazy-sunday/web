# Issue #29 responsive table evidence

These captures use real local rooms and the public WebSocket protocol. Bot
players joined through the same protocol as the browser client; the browser
completed setup peek normally before each gameplay capture.

| Players | Viewport | Evidence | Result |
| --- | --- | --- | --- |
| 2 | 375 × 812 | [mobile](./2-player-mobile.jpg) | One opponent expands to the available width; shared piles, the current player's list, turn/caller state, and the opponent's direct card targets remain visible in one short table. |
| 4 | 768 × 900 | [tablet](./4-player-tablet.jpg) | Two opponent seats share the first row and the remaining seat centers below without a full-width vertical stack. |
| 7 | 320 × 700 | [mobile](./7-player-mobile.jpg) | The sticky turn banner and current-player tray remain reachable while six opponents occupy three compact, seat-ordered rows. |
| 7 | 1440 × 900 | [desktop](./7-player-desktop.jpg) | Six opponents occupy a 3 × 2 grid beneath the central piles and current-player tray. |

Browser measurements reported no page-level horizontal overflow at any of the
four viewports. The 320px and 768px layouts use local horizontal scrolling only
inside a player's card strip when their list exceeds the available seat width;
every card remains a native, labelled button for keyboard and screen-reader use.

The browser pass also exercised setup peek and a `NOT ME!` call. The accessible
tree retained player presence, stable seat number, card count, current-turn,
caller, selection, and disabled-state semantics.
