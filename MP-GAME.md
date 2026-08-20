# The Archive Game — the Merged Public puzzle layer

> **Amended 2026-08-20 — the decoupling.** Merged Public has fully decoupled from the Silicon Bayou (BAYOU) gator collection, and every promise in this rulebook that ran through the BAYOU-gated `BountyBoard` is superseded here, in place, by this dated amendment. The contract change §6 foreshadowed as unscheduled future work has shipped: **`MergedPublicBoard`** ([contracts/MergedPublicBoard.sol](contracts/MergedPublicBoard.sol)) carries the same tested board logic with settlement and withdrawal gated on holding a Merged Public identity, and its address will be recorded in `deployments/mp-board.robinhood.json` when it deploys — trust no other record. The old board is retired from Merged Public's stack and will be wound down and paused on its own side. What changed and why is set out in [DECOUPLING.md](DECOUPLING.md); the compliance commitments in §8 are unchanged in substance.

**Purpose, in one sentence:** a skill-based declassification game built from material the collection already commits to on-chain — the hashed provenance, the ten hidden legendaries, the ~75 Redacted files — where every puzzle is provably fair before it opens and every reward is recognition or access, never money.

> **Status: DESIGN.** This document is the rulebook for a game that runs against the Merged Public contract (`contracts/MergedPublic.sol`, 10,000 entities, Robinhood Chain 4663). Nothing in this file is live until a season is announced in this repo with its commitment hashes published. The contract itself contains **no game code** — the game runs on top of what the contract already proves: the immutable `provenanceHash`, the one-way reveal, and public event logs. Anything described below as "on-chain" beyond that is either a plain transaction to a recorded address or explicitly labeled future work.

---

## 1. The premise: an archive being declassified

Merged Public is a 10,000-entity archive minted sealed. Every token serves the same sealed metadata until `reveal()` — a one-way switch — and the generative draw (seed **20260818** + `weights.json` + `rules.json`) was committed as an immutable keccak256 hash at deploy, before any art existed on-chain. That is not flavor text; it is the contract's actual mechanism, and it is exactly the shape of a declassification: the files exist, the index is sealed, and the seal can be audited after it opens.

The game leans on three facts the collection already fixes:

| Material | Where it lives | Why it makes a puzzle |
|---|---|---|
| **The ten legendary 1/1s** (The Founder, The Archivist, The First Graduate, The Night Engineer, The Cartographer, The Alchemist, The Broadcast, The Machinist, The Librarian, The Signal) | Their **names** are in the hashed provenance JSON; their ten token IDs are assigned after the generated set is shuffled and are deliberately **not** in that file. Before Season Zero opens, the full ID assignment is committed as `keccak256(assignment ‖ salt)` in the season manifest (§4) — chain-timestamped, opened at reveal. | Once the assignment commitment is published, the IDs cannot be moved in response to guesses. Clues can honestly narrow them, and the opened commitment proves nobody cheated. |
| **The ~75 Redacted files** | The Redacted background carries weight 0.75% of 9,990 in the committed `weights.json` — **~75 expected**; the exact count is a seeded-draw outcome, published (and checkable against the hash-committed draw) at reveal | Redaction bars invite reconstruction. Fragments hidden across those entities assemble into a document. |
| **The provenance commitment itself** | `provenanceHash` (immutable), the `ProvenanceCommitted` event, seed 20260818, 9 layers · 110 traits · 6 rules, and the committed `constraints` (exact-duplicate ban, min 2-trait distance) | Recomputing the draw and checking the hash is a real skill. The game turns auditing into a race. |

The poster (`marketing/merged-public-poster.html`) is a game surface too: its QR plate ships as a deliberately non-scannable placeholder mark. When a season is live, printed and posted editions carry a real plate — the plate is a drop location, and knowing that is the first clue.

## 2. Seasons

The game runs in **seasons** keyed to the contract's own lifecycle, because the contract's one-way switches are the only clock that cannot be argued with.

| Season | Contract state | What runs |
|---|---|---|
| **Season Zero — Sealed** | Pre-reveal (`revealed == false`) | Cipher drops; the Legendary Hunt (narrowing the ten sealed IDs); provenance-literacy challenges that teach players to verify the commitment they will later check. |
| **Season One — Declassified** | At and after `reveal(baseURI)` | The verification race (first independent audits of the draw against `provenanceHash`); Redacted-file reconstruction across the 75; legendary confirmation — Season Zero's narrowing claims are scored against the now-public IDs. |
| **Later seasons** | Post-`freezeURI()` | Announced one at a time, each with its own committed manifest. No season is promised until its manifest hash is published. |

Every season opens with a **season manifest**: a JSON file listing each puzzle's ID, opening date, and the commitment hash of its answer (§4). The manifest's own keccak256 is published in this repo **and** echoed in a zero-value transaction from the treasury wallet on chain 4663, so the commitment carries a chain timestamp independent of git history. Trust only manifests whose hash matches that transaction.

## 3. Puzzle types

**Cipher drops.** Short encrypted or encoded messages hidden in surfaces the project already publishes: the poster and its QR plate, mergedpublic.com, the sealed metadata document behind `unrevealedURI()`, the collection document behind `contractURI()`, and — after reveal — individual token metadata. Each drop decodes to a solve phrase. Difficulty is stated when the drop opens; no drop ever requires owning a token to read or solve.

**Provenance-verification challenges.** Structured tasks that reproduce what the contract commits to: recompute keccak256 over the canonical provenance JSON and match `provenanceHash`; re-run the seeded draw (seed 20260818, the published weights, the six exclusion rules, the minimum 2-trait distance) and match the revealed metadata; verify `tokenURI` arithmetic and the event log. The first correct, independently reproducible verification write-up per challenge earns roster entry. These challenges exist to multiply the number of people who have personally audited the collection — the audit *is* the puzzle.

**Redacted-file reconstruction.** The ~75 Redacted-background entities (exact count known at reveal) each carry a fragment — in art detail, in a metadata attribute, or in both — of a single larger document. Fragments only make sense assembled. Solving requires reading the revealed metadata of every Redacted entity (public, free, no ownership required) and reconstructing the file. This is a Season One puzzle by construction: it needs the reveal.

**The Legendary Hunt.** Across Season Zero, clues are dropped that narrow the ten sealed legendary token IDs — each clue is honest (consistent with the committed assignment) and each strictly shrinks the candidate space. Players file **narrowing claims** before reveal: a committed statement of which IDs they believe hold which legendaries. The provenance JSON itself (seed, weights, rules, legendary names) is public from deploy per MP-LAUNCH.md — what stays sealed is the **ID assignment**, committed as `keccak256(assignment ‖ salt)` in the Season Zero manifest before the first clue drops. At reveal, the assignment and salt are opened; anyone recomputes the commitment, and claims are scored against ground truth that was fixed before the first clue existed. The operator cannot move the answers, and the published commitment proves it.

Some entities are their own map: the **Floating Formulae** and **Halo of Diagrams** specials (both tier R) are flagged now as clue-bearing trait classes. What they bear is part of the game.

## 4. Provable fairness: commit first, reveal later

Every puzzle follows the same discipline the collection itself uses — commit the answer before anyone can act on it.

1. **Before a puzzle opens:** the operator publishes `keccak256(abi.encodePacked(answer, salt))` in the season manifest. The salt is held privately; the hash is on the record (repo + chain-timestamped manifest hash, §2).
2. **The puzzle opens** on its announced date.
3. **When the puzzle closes** (first correct solve, or the stated deadline): the operator reveals `answer` and `salt`. Anyone can recompute the hash and confirm the answer never moved.
4. **For the Legendary Hunt specifically,** the committed answer is the full ID assignment: `keccak256(canonical assignment JSON ‖ salt)`, published in the Season Zero manifest **before any clue drops**, opened (assignment + salt) at reveal. `provenanceHash` separately fixes the legendary names and the whole generative system at deploy; the assignment commitment fixes *where they landed*.

A puzzle whose revealed answer does not match its committed hash is void, stated publicly, and the failure is recorded in this repo. That is the deal.

## 5. How solutions are verified

Solvers follow a **commit–reveal** of their own, so nobody can snipe an answer from a public submission:

1. **Commit:** the solver computes `keccak256(abi.encodePacked(puzzleId, answer, solverAddress, solverSalt))` and submits it, either as an EIP-191 signed message over a canonical solve string (verified by recovering the signer address from the signature and matching it against the claimed solver — signed locally, no key ever leaves the solver's machine) or as calldata in a zero-value transaction from the solver's own address on 4663.
2. **Reveal:** after committing, the solver reveals `answer` and `solverSalt`. First valid commit whose reveal checks out is the first solve. Commit order is what ranks — a chain-timestamped commit beats a signed-message commit with a later receipt, and disputes resolve to whatever ordering evidence is public.
3. **Recording:** verified solves are appended to a solves file in this repo with the solver's address, the puzzle ID, and the verification evidence — an append-only signed registry: every entry carries what is needed to re-verify it, and anyone can.

Nothing here requires trusting the operator's word: the puzzle answer is provably pre-committed, the solve is provably pre-committed, and both reveals are publicly checkable.

## 6. What solvers earn

**The Declassified roster.** Every verified first-solver (and, for the Legendary Hunt, every correct narrowing claim) is entered on the **Declassified roster** with address, puzzle, and date. Today that roster is a signed file in this repo, verifiable by anyone. An on-chain roster contract on 4663 is planned future work — deployed only when tested, recorded in `deployments/`, and never trusted at any address not in that file. Until that contract exists, the roster is honest but off-chain, and we say so.

**First-pick claims, where applicable.** All 10,000 entities mint to the treasury; nothing is offered for sale. If and when the treasury distributes entities — grants for verified contribution, at the operator's discretion, exactly as the community-pool language in [MP-VALUE.md](MP-VALUE.md) is written — roster order is pick order: solvers ranked by season standing choose before anyone else. This is a queue position, not a promise. No distribution is guaranteed, scheduled, or implied by this document.

**Merged Credits — only through the verified-work rail.** *(Amended 2026-08-20 — see the notice at the top.)* Some puzzles double as funded bounties on `MergedPublicBoard` ([contracts/MergedPublicBoard.sol](contracts/MergedPublicBoard.sol)). An earlier version of this paragraph said extending the settlement gate to Merged Public holders would require a contract change and was unscheduled future work; that contract change has now shipped as `MergedPublicBoard`. When it deploys, its address will be recorded in `deployments/mp-board.robinhood.json` — trust no other address, and trust none at all until that record exists. The old BAYOU-gated `BountyBoard` is retired from Merged Public's stack and will be wound down and paused; no MP promise runs through it. The board's rules hold with no exceptions: the bounty is funded on-chain before work starts, and MC moves only on settlement of verified work — payment for work, never for holding. The contract enforces that settlement and withdrawal go only to a wallet holding a **Merged Public identity** — a constraint we state plainly rather than paper over. A solver who holds no Merged Public identity still earns roster entry and season standing. **No puzzle ever mints, emits, or rains MC outside MergedPublicBoard settlement** — the same absolute this document has always made, re-anchored by this amendment to the new board.

What solvers do **not** earn: money, tokens with promised value, yield of any kind, or anything selected by chance. See §8.

## 7. The puzzles are a small piece

Say it before anyone over-reads the game: **the puzzles are flavor, not the value.**

The value lanes of Merged Public are the ones the rest of this repo documents: **identity** (a verifiable entity in an archive whose provenance is committed on-chain), **access** (the holder-gated rails — `MergedPublicBoard`'s identity-gated settlement is the exemplar (§6; live once its deployment record exists), with registries, desks, and roster mechanics following the same pattern as they ship; no gate is promised on a date), and **services** (the merged software stack for public institutions — **education first, Louisiana first**, per [MP-VALUE.md](MP-VALUE.md), with other merged services folded in over time as they go live). The archive exists because the network exists; the game exists because the archive's own trust machinery happens to make good puzzles.

If every puzzle in every season went unsolved, the collection's purpose would be untouched. Weigh the project on the lanes, not on the game.

## 8. Compliance: no yield, no lottery, stated plainly

- **No yield, ever.** No staking, no APY, no emissions, no returns, no promise or implication of price appreciation. This document makes no claim about the value of any token and never will.
- **Not a lottery, sweepstakes, or raffle.** There is no chance-based selection anywhere in the game: no random draws, no tickets, no entry fees, no pay-to-enter mechanics of any kind. Every outcome is determined by **skill** — solving, verifying, reconstructing — and by verifiable commit order. Where randomness exists in the collection (the generative draw), it was fixed and hash-committed before the game existed and selects art, not winners.
- **Free to play.** Solving requires no purchase and no token ownership. Every puzzle surface is public. Token-gated *settlement* (`MergedPublicBoard`'s Merged Public identity check) is a property of the credits contract, not an entry fee to the game — roster recognition is open to any address that solves.
- **Rewards are recognition and access.** Roster entry, season standing, and queue position for discretionary distributions. Nothing awarded by this game is cash, a cash equivalent, or an instrument with promised value. MC, where it applies, is payment for verified work under the documented `MergedPublicBoard` rules (§6) — not a game payout.
- **Not securities, not legal instruments.** Tokens in this project are cryptographic identity, not legal contracts, per the standing language across this repo. Nothing in this game changes that.
- **If any future season ever touched real-money movement,** it would wait on legal, tax, and payment review first. That commitment is this document's own and it is permanent.

## 9. Straight answers

**Can the operator rig the Legendary Hunt?** No — before the first clue drops, the full ID assignment is fixed by a salted keccak256 commitment published in the chain-timestamped Season Zero manifest. At reveal the assignment and salt are opened; a reveal that fails the commitment voids the Hunt on the record (§4). The Hunt does not open without that commitment published first.

**Can the operator rig a cipher drop?** Only by publishing a reveal that fails its pre-committed hash, which is publicly checkable and voids the puzzle on the record (§4).

**Do I need to own anything to play?** No. You need it only for `MergedPublicBoard` settlement (a Merged Public identity, enforced by that contract) — and roster entry never requires it. *(This answer was amended 2026-08-20: the gate swap from the old board is declared in the notice at the top, not made quietly.)*

**Is the on-chain roster live?** No. It is future work; the roster starts as a signed repo file. This document will be updated, not quietly reinterpreted, when that changes.

**When does Season Zero start?** When its manifest hash is published in this repo and echoed on 4663 — not before, and this document is not that announcement.

---

*The Archive Game — a puzzle layer for Merged Public. Built on Robinhood Chain (4663), gas in ETH. Not endorsed by Robinhood. Not a security, not a yield product, not a lottery, not a legal record. Skill-based; rewards are recognition and access. Repo: [github.com/Dozier-Tech-Group/merged-public-archive](https://github.com/Dozier-Tech-Group/merged-public-archive).*
