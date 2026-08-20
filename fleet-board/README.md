# Fleet Operations Board

The live transparency board for Merged Public, served at
**https://www.mergedpublic.com/fleet/**. This directory is the **canonical
source**; the website repo carries a byte-for-byte vendored copy at
`public/fleet/` (keep them in sync — edit here first).

## What it is

A 1980s-style operations board that shows, in real time, the inner workings
of the MP work rail:

| Panel        | Shows                                        | Source |
| ------------ | -------------------------------------------- | ------ |
| **SUPPLY**   | MP and MC figures, escrow, bounty counts     | eth_call + Blockscout |
| **DEMAND**   | the work queue — every bounty funded on the MergedPublicBoard | the board's event log |
| **PIPELINE** | MP fleet runs in this repo's CI              | GitHub Actions API |
| **LEDGER**   | the latest Merged Credit movements, labeled (mint / fund escrow / withdraw) | Blockscout token transfers |

## How it works — the whole point

**There is no backend.** The page is three files — `index.html`,
`board.css`, `board.js` — and the visitor's own browser does all the
reading, directly against public sources:

1. **Robinhood Chain JSON-RPC** (`eth_call`) for live contract state.
   `board.js` builds the calldata by hand (4-byte selector + padded args) so
   you can see exactly what a "web3 library" does underneath.
2. **Blockscout REST API** for indexed history: holder counts, the MC
   transfer feed, and the MergedPublicBoard's raw event log, which the
   board decodes itself from `topics`/`data` using the events' keccak256
   signatures.
3. **GitHub public API** (keyless, ETag-cached) for the fleet's CI runs and
   the `tasks.json` mirror that gives bounties their titles.

Every number on the board links to the contract, transaction, or CI run it
came from. The board **reports; it never pays** — it holds no keys, signs
nothing, and cannot move anything. When the queue is empty it says so, and
until the MergedPublicBoard's deployment record lands in
`deployments/mp-board.robinhood.json` the queue panel says exactly that
instead of inventing a state.

## Standing language rules (do not soften these when editing)

- MC is **payment for verified work, never for holding**. MC settles only
  when work merges. Never connect credit movement to simply owning a token.
- No yield, APY, returns, price, or lottery language. Ever.
- Settlement is gated on holding a **Merged Public identity** — the
  contract enforces it.
- Not endorsed by Robinhood.
- Every address displayed must exist in this repo's `deployments/` records.

## Testing

`test/fleet-board.test.js` loads the page into happy-dom, injects `board.js`
with a stubbed `fetch` (canned RPC/Blockscout/GitHub fixtures), runs a full
tick, and asserts the rendered rows — including the honest pre-deploy
pending state. Run with `npm run test:app`.

## Embedding

`index.html?embed` hides the long-form footer (the compliance line always
stays visible) and retargets links to `_top` — this is how the
mergedpublic.com homepage embeds the board in an iframe.
