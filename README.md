# Signal Radar — Token Launch Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mrfriedo1603/makefun-token-radar-22nov-2026/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mrfriedo1603/makefun-token-radar-22nov-2026/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the make.fun bounty **Build the best token launch radar**
(`token-radar-01`). It reads the sealed DefiLlama snapshot, ranks the protocols
that record no token by an implied value, and shows a reader how to farm each one.

- `main.ts` — the entry point (Node 22, standard library only, no install, no network).
- `lib/model.ts` — the valuation engine and the farm-plan derivation.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied in unchanged from the kit.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`; `main.ts` writes `data.js` beside it.
- `screenshots/` — three renders of the page: the board, a protocol's detail view, a filtered view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

With no arguments it reads `$MAKEFUN_INPUT_DIR/snapshot.json` (default `/input`)
and writes `$MAKEFUN_OUTPUT_DIR` (default `/output`). It writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json`; the dossier is written
last and is byte for byte what `buildDossier` writes from the same directory.
Two runs over the same snapshot write the same bytes: no clock, no randomness,
no network in the program.

## The model, in one paragraph

A peer is a protocol in the same snapshot whose token already trades: its multiple
is market cap over TVL. Exchanges, bridges and liquid-staking products are left
out of the peer set, multiples are winsorised at the 90th percentile, and the
global multiple is the peers' median. A protocol's multiple is its category's
median shrunk toward the global median with a prior of 8 peers; a category with
fewer than 3 peers falls back to the global median and the row is marked low
confidence. Growth (the 7-day TVL change, clamped to -40%..+80%, weighted 0.5),
maturity (0.70 rising to 1.00 across 730 days listed) and chain breadth (up to
1.20 for multi-chain protocols) adjust that multiple, and the implied value is
TVL × multiple × growth × maturity × breadth. No protocol name is special-cased
anywhere in `lib/model.ts`.

The board is the watchlist (40 slugs, always) plus the strongest plausible
pre-token protocols below the floor — no version marker, no wrapped or staked
name, no exchange prefix, not a bridge, liquid-staking or exchange category —
by TVL, up to 200 rows.

## Notes

- The snapshot is sealed input: the board never calls a live API and never invents a protocol.
- `market cap` is a market cap; the board never calls it a fully diluted value, and it never claims a token will be issued.
- A protocol is shown as "records no token" when the snapshot records no market cap, CoinGecko id or symbol for it — the snapshot's record, never a promise.

Built for [make.fun Token Radar](https://make.fun/bounty/token-radar-01).
