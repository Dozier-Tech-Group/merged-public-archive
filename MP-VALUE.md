# Merged Public — the value thesis

> **Amended 2026-08-20 — the decoupling.** Merged Public now stands fully apart from the Silicon Bayou (BAYOU) gator collection: the "people layer / capability layer" pairing and the "one network, two registers" framing published in earlier versions of this document are retired, and Lanes 2 and 3 no longer point at BAYOU-side infrastructure. Settlement and access move to `MergedPublicBoard` ([contracts/MergedPublicBoard.sol](contracts/MergedPublicBoard.sol)) — the contract change [MP-GAME.md](MP-GAME.md) §6 foreshadowed as "unscheduled future work" — which gates on holding a Merged Public identity (live once its deployment record `deployments/mp-board.robinhood.json` exists); the old BAYOU-gated `BountyBoard` is retired from MP's stack and will be wound down and paused. The shared-principals ownership disclosure below stays, amended to state the relationship plainly. Full record of the change: [DECOUPLING.md](DECOUPLING.md).

**Purpose, in one sentence:** a 10,000-entity archive of the merged public — the people the open institutional network is for — each entity a durable, provable identity held in a wallet.

> **Status: LIVE.** `MergedPublic` launched 2026-08-19 at [`0x5D000b230653E416FF41451525b144a6C2Ad7178`](https://robinhoodchain.blockscout.com/address/0x5D000b230653E416FF41451525b144a6C2Ad7178) — all 10,000 entities minted sealed to the treasury. The canonical record is [`deployments/merged-public.robinhood.json`](deployments/merged-public.robinhood.json). Do not trust any address that does not appear there.

**Who is behind this, stated up front:** Merged Public and **merged** (mergedpublic.com, the open source institutional network) are projects of the same organization; the Dozier-Tech-Group GitHub org and Merged, Inc. share principals. That organization also runs Silicon Bayou (BAYOU), a separate gator collection: common ownership is disclosed here precisely because it exists, and BAYOU has no role in Merged Public's gates, rails, or rewards. Where the network's Louisiana research is cited, it is the builder's own compiled material, not third-party validation. Everything else is sourced to this repository so a skeptical reader can check us.

---

## 1. What Merged Public is

Merged Public answers one question: **who the network is for.** It is a 10,000-entity generative archive of the merged public — students, teachers, clerks, coaches, builders, the people an open institutional stack actually serves — minted as `MergedPublic` (MP) on Robinhood Chain mainnet.

MP's shape is deliberate: large, generative, and committed before the art exists. Ten thousand entities drawn from rules and weights that were hashed on-chain before a single image was rendered.

The chain facts, stated directly: Robinhood Chain mainnet is chain ID 4663, gas is paid in ETH, and the public explorer is Blockscout ([robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)). And the sentence that matters most: **Robinhood has not endorsed, reviewed, or partnered with this project.**

## 2. The launch design: discipline before art

`contracts/MergedPublic.sol` is the source of truth, and it is honest about what it **cannot** do:

| The threat | What kills it |
|---|---|
| Supply inflated later | `MAX_SUPPLY = 10_000` is a compile-time constant; `mint`/`mintBatch` revert past it. `MAX_BATCH = 250` bounds each owner mint. |
| The draw rigged after seeing demand | `provenanceHash` — keccak256 of the canonical provenance JSON (seed 20260818 + weights + rules) — is **immutable, set in the constructor, before any art exists.** After reveal, anyone can re-run the draw and check it against the hash. |
| A fake "reveal" walked back | `reveal(baseURI)` is one-way. Until it fires, every token serves the same sealed metadata document. |
| Art swapped after reveal | `setBaseURI` works only until `freezeURI()` — a one-way flag with no unfreeze. |
| Archive stranded sealed or mutable with no owner | `renounceOwnership` reverts until the URI is revealed **and** frozen. |
| Ownership fat-fingered | `Ownable2Step`; the new owner must accept. |
| Royalty ratcheted | ERC-2981, default 5%, hard-capped at 10%; `setDefaultRoyalty` reverts above it. |
| Admin upgrade god-mode | No proxy. Immutable implementation. |

There is **no public sale and no mint price.** All 10,000 minted owner-only to the treasury, in batches. Nobody is asked for money to get in at launch, which means nobody can be sold a promise. Collection-page metadata (EIP-7572 `contractURI`) stays owner-editable for branding; token metadata does not, once frozen.

Why this order matters: most 10k collections generate art, watch the market, then "commit." MP commits the seed, weights, and rules to the chain first and generates second. The provenance hash is the promise; the reveal is just the delivery. That is the discipline this document holds itself to — claims that survive checking.

There is no third-party audit; the compensating controls are the hard cap, immutability, the freeze, pinned OpenZeppelin components, and the repo's test gate. Until ownership rotates to a multisig, a single owner key carries the usual risks: a compromised or lost key could fire the reveal early, repoint pre-freeze metadata, or strand the remaining owner actions — it can never inflate supply past 10,000, alter frozen token metadata, or upgrade the contract.

## 3. The value lanes, in order

**Lane 1 — identity in the archive.** The base fact of an MP token: one fixed entity of the merged public, provably drawn from a pre-committed distribution, with metadata that freezes forever. It is a durable identity artifact in a 10,000-entity archive — a name-tag on the network. That is the floor, and it is the only lane that exists at launch.

**Lane 2 — access.** As merged services ship, holding MP is the intended gate to their public-facing side — **education first, Louisiana first**, mirroring the network's own sequence (merged.edu is the reference implementation). The gate contract is now MP's own: `MergedPublicBoard` ([contracts/MergedPublicBoard.sol](contracts/MergedPublicBoard.sol)) settles and pays out only to a wallet holding a Merged Public identity; its deployment will be recorded in `deployments/mp-board.robinhood.json`, and no address outside that record should ever be trusted — trust none at all until that record exists. *(Amended 2026-08-20 — see the notice at the top.)* The token-gated board this document previously cited as the shipped example is retired from MP's stack and will be wound down and paused on its own side. MP gates arrive as services actually ship, not before. No gate is promised on a date.

**Lane 3 — verified contribution.** Merged Credits (`MergedCredit`, MC) is the network's non-cash rail for paying **verified merged work** — delivery evidence, attestations, accepted milestones. For MP that rail is `MergedPublicBoard`: bounties funded on-chain before work starts, MC moving only on settlement of verified work, withdrawable only by a wallet holding a Merged Public identity. This supersedes the earlier promise that MP holders would plug into a shared rail as it extended; the addresses to trust are the ones recorded in `deployments/mp-board.robinhood.json` once the board deploys, and no others. Rewards are payment for contribution — never for holding.

**Lane 4 — the Archive Game.** A small lane, and flavor by design: light play built on the archive's entities. It is described in [MP-GAME.md](MP-GAME.md) and sized honestly there — a reason to look at the archive, not a reason to buy anything.

**Lane 5 — future services, included over time.** The inclusion principle, stated once so it never has to be argued: **a service joins the MP lane when it can gate on MP identity and settle on verified work. Nothing joins on promises.** No roadmap slide adds a lane; a shipped gate does.

## 4. What Merged Public is NOT

The discipline is Merged Public's own, and permanent:

- **Not yield.** No emissions, no revenue share, no passive income of any kind.
- **Not staking APY.** There is no staking. There is no APY. There never will be.
- **Not guaranteed returns.** This document makes no claim about price or future value — ever. Nothing here is an investment or offered with any expectation of profit.
- **Not a legal instrument.** An MP token is cryptographic identity in an archive — not a security, not a contract, not a claim on Merged, Inc., its treasury, or any community pool.

If a rewards mechanism ever touches real money, it waits on legal, tax, and payment review first.

## 5. Discoverability

Merged Public gets **its own OpenSea collection page and its own lane.** It has its own contract and stands independent of any other collection. OpenSea indexes Robinhood Chain collections once contracts are live — on OpenSea's timeline, not ours — and `contractURI` (EIP-7572) carries the collection's name, description, image, and royalty facts so the page reads correctly when it appears.

## 6. Why this could matter

The 10k collections that died sold access to a promise before anything existed. Merged Public inverts every step: provenance committed before art, mint to treasury instead of a public sale, reveal as a one-way switch, freeze as the finish line, and value lanes that open only when a real service can gate on the token and settle on real work. If the thesis of the merged network ([mergedpublic.com](https://mergedpublic.com)) plays out — Louisiana institutions running open-source infrastructure built in-state — this archive is the people layer of that record, ten thousand entities deep, and every claim in this document will still check out.

*Merged Public — the people layer. Built on Robinhood Chain. Not endorsed by Robinhood. Not a security, not a yield product, not a legal record. Repo: [github.com/Dozier-Tech-Group/merged-public-archive](https://github.com/Dozier-Tech-Group/merged-public-archive).*
