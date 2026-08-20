# Merged Public — the archive

**10,000 entities on Robinhood Chain (4663), minted sealed, provenance
committed before the art existed.** This repository is the canonical public
record: contracts, commitments, sealed metadata, the game, the reveal
runbook, and the live fleet board. Everything here is checkable — every
claim resolves to a contract read, a transaction, or a file whose hash is
already on-chain.

> Established 2026-08-20 as Merged Public's standalone home — see
> [DECOUPLING.md](DECOUPLING.md) for the dated record of that change.

## The live facts

| Fact | Value |
| --- | --- |
| Collection | Merged Public (MP), ERC-721 + ERC-2981 |
| Contract | [`0x5D000b230653E416FF41451525b144a6C2Ad7178`](https://robinhoodchain.blockscout.com/address/0x5D000b230653E416FF41451525b144a6C2Ad7178) — source-verified |
| Supply | 10,000 — all minted sealed to the treasury, 2026-08-19 |
| Provenance | `0x9c123f7aa01c529a0bdba61bdd241b62e79a3452d294afae7d833e03d97bf952` (immutable in the contract; recomputable from [`generator/merged-public/provenance.json`](generator/merged-public/provenance.json)) |
| State | Pre-reveal: every token serves the sealed metadata (pinned to IPFS by raw CID) |
| Record of truth | [`deployments/merged-public.robinhood.json`](deployments/merged-public.robinhood.json) |
| Work board | `MergedPublicBoard` — settlement gated on holding MP; record lands in `deployments/mp-board.robinhood.json` at deploy |
| Credits | Merged Credits (MC), [`0x040f12C71ddA0bA9D91E94016ea5C348106ab429`](https://robinhoodchain.blockscout.com/address/0x040f12C71ddA0bA9D91E94016ea5C348106ab429), 0-decimals ERC-20 (predates this repo; source-verified on Blockscout) |
| Site | [www.mergedpublic.com](https://www.mergedpublic.com) · live board at [/fleet/](https://www.mergedpublic.com/fleet/) |

Trust no contract address that is not recorded in `deployments/`.

## The map

- **[MP-VALUE.md](MP-VALUE.md)** — what this is and is not (the thesis).
- **[MP-GAME.md](MP-GAME.md)** — the Archive Game: Season Zero, the salted
  commitment, the Legendary Hunt rules.
- **[MP-LAUNCH.md](MP-LAUNCH.md)** — the launch record.
- **[MP-REVEAL.md](MP-REVEAL.md)** — the reveal runbook: four laws, phases
  A–G, hard gates.
- **[game/season-zero/](game/season-zero/)** — the published Season Zero
  manifest; its keccak256 is echoed on-chain from the treasury.
- **[generator/merged-public/](generator/merged-public/)** — the committed
  generative system: weights, rules, the provenance file (byte-locked to the
  on-chain hash), and the public verifier.
- **[metadata/mp/](metadata/mp/)** — the sealed metadata as pinned (exact
  bytes; the CIDs live on-chain).
- **[fleet-board/](fleet-board/)** — the live transparency board served at
  mergedpublic.com/fleet: no backend, your browser reads the chain and
  GitHub directly. Three files, tested, meant to be read.
- **[contracts/](contracts/)** — `MergedPublic.sol` and
  `MergedPublicBoard.sol`, compiled under pinned settings
  (solc 0.8.24, shanghai, optimizer 200, OpenZeppelin 5.2.0) so the deployed
  bytecode re-verifies from this tree.

## Verify it yourself

```bash
npm install
npm test                     # contract suites + board tests
npm run verify:provenance    # recompute the provenance hash from raw bytes
```

## The standing rules

No yield, no APY, no price talk, ever. Merged Credits settle only when work
merges — payment for verified work, never for holding. Not a security, not
a legal record, not a lottery. No gate is promised on a date. Anything
touching real money waits on legal, tax, and payment review. Built on
Robinhood Chain; **Robinhood has not endorsed, reviewed, or partnered with
this project.**
