# MP-REVEAL — the operational runbook for revealing Merged Public

> **Amended 2026-08-20 — the decoupling.** Merged Public's settlement rail is now
> `contracts/MergedPublicBoard.sol` — same tested board logic, settlement and
> withdrawal gated on holding a Merged Public identity — the contract change
> MP-GAME.md §6 foreshadowed as "unscheduled future work," with its deployment to
> be recorded in `deployments/mp-board.robinhood.json`. The old BAYOU-gated
> BountyBoard is retired from MP's stack and will be wound down and paused on its
> own side; the MP promises that pointed at it are superseded by declared
> amendments in the promise documents. In this runbook only two lines changed: the
> promise-baseline sentence below now points at the amended promise set, and the
> Phase F comms rule now reads "MP holders first." Full record:
> [DECOUPLING.md](DECOUPLING.md).

> Expands [MP-LAUNCH.md](MP-LAUNCH.md) §7 into the full pipeline with hard gates.
> Status: **pre-reveal.** Chain 4663, contract
> `0x5D000b230653E416FF41451525b144a6C2Ad7178`, all 10,000 sealed, provenance
> committed, sealed metadata on IPFS (raw CIDs, verified byte-for-byte).
> Nothing in this document changes what was promised in MP-LAUNCH.md,
> MP-GAME.md, or MP-VALUE.md — it only sequences how we keep those promises.
> Those documents were amended **2026-08-20** by declared, dated amendments as
> part of the decoupling ([DECOUPLING.md](DECOUPLING.md)); this runbook
> sequences those promises **as amended**.

## The four laws (violating any one is a stop-the-line event)

1. **`generator/merged-public/provenance.json` is never edited.** Its raw bytes
   must keep hashing to the immutable onchain `provenanceHash`
   (`0x9c12…f952`). `.gitattributes` already protects it from CRLF rewrites.
2. **`reveal(baseURI)` and `freezeURI()` are one-way.** The only repair window
   for token metadata is `setBaseURI`, which exists *between* reveal and
   freeze. After freeze there is no recovery path, for anyone, forever.
3. **`baseURI` must end with `/` and metadata files must be named
   `1.json` … `10000.json`, unpadded.** The contract concatenates
   `{base}{id}.json` with no separator (`MergedPublic.sol` `tokenURI`).
   The poster's `MP-0001.png` zero-padding is a poster convention only —
   it must not leak into reveal metadata filenames.
4. **No CID goes onchain unless it was computed locally first.** Pin services
   have wrapped uploads in directories before (see
   `deployments/merged-public.robinhood.json` → `supersededWrapperCIDs`).
   Every pin is asserted: locally computed CID == returned CID, then
   byte-verified through public gateways. `scripts/pin-mp.mjs` shows the
   pattern; reveal tooling replicates it at directory scale.

## Secrecy boundary (why part of this work stays out of the public repo)

The seed (20260818), weights, and rules are all public — that is the point of
the provenance commitment. Because the draw is deterministic, **the assignment
engine and its outputs are the only secrets**: publishing the engine early
would let anyone precompute all 10,000 entities, including where the ten
legendaries landed, and void the Legendary Hunt.

- **Private until reveal day:** the assignment engine, `assignments.json`
  (token ID → 9 traits), the legendary ID assignment, the salt, all composited
  art, all generated metadata.
- **Public before any clue drops:** the Season Zero manifest carrying
  `keccak256(canonical assignment JSON ‖ salt)`, its own keccak256 echoed in a
  zero-value treasury transaction on 4663 (MP-GAME.md §2, §4).
- **Public at reveal:** everything — engine, assignment, salt, art, metadata.
  MP-GAME.md promises an audit race; a reveal that fails the commitment
  voids the Hunt on the record.

Practically: reveal work happens in a **private** working area (separate
private repo or an untracked, backed-up local directory), and lands in this
public repo only on reveal day.

## Phase A — Build the assignment engine (now; needs no art)

The trait assignment for all 10,000 is already fixed by the committed system.
Build and test the machine before a single trait is painted:

- **Engine** (`generate-set.mjs`, private until reveal): mulberry32 seeded with
  20260818 (the PRNG the poster proof established), weighted draws in the
  9-layer order of `weights.json`, rules applied as committed — R-01 is an
  asset swap (4 hat-fit hair variants), R-02…R-06 re-roll the *later* layer —
  enforcing the committed constraints: exact-duplicate ban and minimum 2-trait
  distance. Output: 9,990 generated entities + 10 legendaries, shuffled, token
  IDs 1–10000 assigned.
- **Verifier** (public from day one — it holds no secrets): recomputes
  `keccak256(provenance.json)` against the onchain hash, checks any claimed
  assignment set for rule violations, duplicate/distance violations, trait
  distribution against weights, and exactly ten legendaries bearing the ten
  committed names. This is the tool auditors will race with at reveal.
- **Gate A:** engine runs are bit-for-bit repeatable across machines, and the
  verifier passes the generated set clean.
- **Gate A: PASSED 2026-08-19.** Three fresh-process engine runs produced
  byte-identical output, independently reproduced by an adversarial verifier
  fleet. The public verifier lives at `generator/merged-public/verify-mp.mjs`
  (provenance-hash check incl. `--rpc` against the live contract, full
  assignment-set validation, commitment verification); it passes the set
  clean and caught 8/8 deliberately corrupted sets in mutation testing.
  Engine and outputs stay in the private working area per the secrecy
  boundary.

## Phase B — Season Zero commitment (before ANY clue, always before reveal)

Per MP-GAME.md §4 and MP-LAUNCH.md §7 step 0:

1. Freeze the legendary ID assignment (an output of Phase A's run).
2. Write the canonical assignment JSON; draw a random 32-byte salt.
3. Publish `keccak256(assignment ‖ salt)` in the Season Zero manifest; publish
   the manifest's keccak256 in this repo **and** echo it in a zero-value
   transaction from the treasury wallet on 4663.
4. Store assignment + salt offline, in at least two places. Losing the salt
   voids the Hunt just as surely as leaking it.
- **Gate B:** no Archive Game clue may be published before this lands. The
  Hunt does not open without it.
- **Staged 2026-08-19, awaiting the operator.** The private
  `commit-season-zero.mjs` draws the salt, writes
  `game/season-zero/manifest.json`, and prints its keccak256;
  `scripts/echo-manifest.mjs` (public) prints the echo transaction and
  `--send` signs it with `TREASURY_PRIVATE_KEY`. Run order is law: back up
  assignment + salt offline in two places FIRST, then commit the manifest,
  then echo.

## Phase C — Art production (the human lane)

- 110 traits painted at 2048×2048 PNG layers, plus the 4 hat-fit hair
  variants (R-01), filenames keyed to the trait names in `weights.json`.
- The poster's renderer (`marketing/merged-public-poster.html`) is a **proof
  subset** (79 drawn traits), not the reveal pipeline — it validates look and
  layer order, not coverage. Acceptance test: composite MP-0001's canonical
  config (Archive Manila · Tone III · Tweed Blazer · Focused · Short Crop ·
  Round Wire · Pencil Behind Ear) from painted layers and compare against the
  poster plate.
- **Gate C:** every trait key in `weights.json` resolves to exactly one asset
  file (plus hat-fit variants); a random 100-entity contact sheet passes
  visual review.

## Phase D — Composite and generate metadata (private)

- Composite all 10,000 from assignments × layers, in the established layer
  order (background → base → clothing → expression → hair → eyewear →
  headwear → accessory → special, with R-01 swaps inside the hair/headwear
  interaction).
- Emit `1.json` … `10000.json`: `name` (`Merged Public #N`; legendaries bear
  their committed names), `image` → `ipfs://<imagesCID>/<file>`, `attributes`
  = the 9 layers (omit or mark `None` consistently — pick one and verify
  OpenSea renders it before freeze).
- **Gate D:** 10,000 files exactly; every JSON parses; the public verifier
  passes the set; spot-render 50 random tokens + all 10 legendaries.

## Phase E — Pin at directory scale

New tooling (`pin-mp-reveal.mjs`), same discipline as `pin-mp.mjs`, plus
scale:

1. Compute the **directory CID locally first** (kubo `ipfs add --only-hash -r`
   or a CAR builder) for the images tree, then for the metadata tree.
2. Upload (Pinata folder/CAR upload — this time a directory CID is what we
   *want*); **assert returned CID == locally computed CID**; abort loudly on
   mismatch.
3. Keep the CAR archives — they are the collection in a file; back them up
   like keys.
4. Redundant pin on a second provider. 10,000 HD images ≈ 5–20 GB: this needs
   a paid pinning plan; budget it before Phase D finishes.
5. Byte-verify ≥ 20 random tokens (always including 1 and 10000) end-to-end
   through at least two public gateways: `<metaCID>/<id>.json` parses, its
   `image` resolves, bytes match local.
- **Gate E:** all of the above green, recorded in
  `deployments/merged-public.robinhood.json`.
- **Tooling ready 2026-08-19.** `scripts/pin-mp-reveal.mjs` — local directory
  CID computed first, hard assert against the returned CID, exit 3 until
  gateway byte-verification completes (the reveal instructions print only on
  a full pass). Known gap to close before reveal week: one throwaway
  10,000-file parity pin to prove the HAMT-sharded path against Pinata
  end-to-end (the local importer shards above 1,000 entries while the remote
  shards by ~256KiB block size, so trees of ~1,001–4,000 small files will
  loudly mismatch by design — the real 10,000-file trees are expected to
  agree, but prove it cheaply first).
- **Parity pin attempted 2026-08-19 — BLOCKED by the Pinata plan, and that
  is itself a finding.** The 10,000-file test upload was refused with "would
  exceed your account's pin limit" (free tier caps ~500 files per account;
  the account holds only 6 pins / 1.6 MB, so it is the count cap, not
  usage). No smaller test substitutes: sharding needs > 1,000 entries.
  Consequence: **a paid Pinata plan is a hard reveal prerequisite** — the
  real metadata and image trees are 10,000 files each and hit the same cap.
  After upgrading, re-run: local CID for the standing fixture must be
  `QmPKnauZSjciDTH7KeEeYz7FnbuYE4jFXDn95mHBZMcNmp`; the tool's assert stays
  the gate. This hardens point 4 above from "budget it" to "blocked on it."

## Phase F — Reveal day (operator signs; order matters)

1. **Open the commitment:** publish engine, assignment JSON, and salt to this
   repo. Anyone can now verify `keccak256(assignment ‖ salt)` against the
   Season Zero manifest and re-run the draw. The audit race is on.
2. **`reveal("ipfs://<metaCID>/")`** — trailing slash — from the operator
   wallet (Blockscout Write tab). One transaction, one-way.
3. **Readback before anything else:** `tokenURI(1)`, `tokenURI(777)`,
   `tokenURI(10000)` — exact-match against expected strings (JSON-escaped
   print; the `pipfs://` incident is why).
4. **Marketplace sweep:** OpenSea metadata refresh across the collection (a
   free OpenSea API key allows scripting it; otherwise per-item refresh on the
   visible tokens and lazy re-fetch for the rest). Blockscout instances
   re-fetch on their own.
5. **Comms** follow the standing rules: no yield/APY/returns/price language,
   no lottery framing, rewards are recognition and access only,
   "Not endorsed by Robinhood." MP holders first, then public.

## Phase G — Soak, then freeze

- Soak **at least 7–14 days**: marketplaces render correctly, holders confirm,
  no metadata bug reports outstanding. `setBaseURI` remains the repair tool —
  use it only with a re-run of Gate E on the corrected tree.
- **`freezeURI()`** — irreversible; only after everything checks out.
  `contractURI` (collection branding) stays owner-editable after freeze by
  design; royalties and pause also survive.
- **Do not renounce ownership.** The contract allows it post-freeze (and never
  while paused), but MP-VALUE.md recommends keeping an owner (ideally a Safe)
  for branding, royalties, and emergency pause.

## Dress rehearsal (required before Phase F on mainnet)

Per MP-LAUNCH.md §2: full end-to-end on testnet 46630 with a throwaway
contract and a miniature set (e.g. 100 tokens) — deploy, mint, pin, commit,
reveal, verify, freeze. Every command in this runbook gets exercised once
where mistakes are free. Testnet contracts are disposable; mainnet is not.

## Sequence summary

```
A engine+verifier ──► B Season Zero commitment ──► (clues may start)
                │
C art ──► D composite+metadata ──► E pin+verify ──► rehearsal on 46630
                                                        │
                                            F reveal + audit race
                                                        │
                                            G soak ──► freezeURI (end state)
```
