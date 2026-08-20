# CLAUDE.md — working in this repository

Read this before changing anything. It exists because several things here
are load-bearing in ways that are invisible from the diff: bytes that are
hashed on-chain, compiler settings that a live verified contract depends on,
a vendored copy in another repository, and language commitments that are
promises, not style.

## What this repository is

`Dozier-Tech-Group/merged-public-archive` — the canonical **public** record of
Merged Public (MP): a 10,000-entity ERC-721 archive on Robinhood Chain
(chain ID 4663), minted sealed to the treasury, with its generative
provenance committed on-chain before any art existed. It holds the contract
sources, the deployment records, the commitment files, the game rulebook, the
reveal runbook, the transparency board, and the MP fleet rail.

The rule the whole repository is built around: **every claim resolves to a
contract read, a transaction, or a file whose hash is already on-chain.** If
you cannot make a change check out that way, the change is wrong.

Start with `README.md` (the map), `DECOUPLING.md` (why MP stands alone),
`SECURITY.md` (trust model, contract limits, operational rules), and
`MP-VALUE.md` §4 (what MP is not).

| Where | What |
| --- | --- |
| `contracts/` | `MergedPublic.sol` (live), `MergedPublicBoard.sol` (not deployed), `mocks/` for tests. |
| `deployments/` | The only source of truth for addresses. `merged-public.robinhood.json` exists; `mp-board.robinhood.json` does not yet. |
| `generator/merged-public/` | Weights, rules, the byte-locked `provenance.json`, and the public verifier `verify-mp.mjs`. |
| `metadata/mp/` | The sealed metadata exactly as pinned. |
| `game/season-zero/` | The committed Season Zero manifest. |
| `fleet-board/` | The read-only board served at mergedpublic.com/fleet. Canonical copy — see the vendoring rule. |
| `scripts/` | Deploy, mint, ownership, pinning, manifest echo — run locally by a human with a key — plus `link-mp.mjs`, whose `verify` mode needs no key at all. |
| `test/` | `test/contracts/` (Hardhat/Chai) plus `test/fleet-board.test.js` and `test/agents.test.js` (Vitest). |
| `agents/` | The MP fleet rail: `registry.json` (verified holder bindings), `run-agent.mjs` (the runner), and the task mirror it reads. |
| `.github/workflows/` | `ci.yml` (the test gate, no secrets) and `mp-fleet.yml` (the fleet run, dormant without its secret). |

## Byte-sensitive files — never normalize, never reformat

Three sets of bytes are on-chain commitments. Re-serializing, pretty-printing,
sorting keys, adding or dropping a trailing newline, or letting Git rewrite
line endings **breaks the commitment**: the file stops hashing to the value
the chain carries, and the public record stops verifying. There is no way to
fix that on-chain — `provenanceHash` is `immutable`.

- `generator/merged-public/provenance.json` — keccak256 of its raw bytes is
  the live contract's immutable `provenanceHash`.
- `game/season-zero/manifest.json` — keccak256 of its raw bytes is echoed
  on-chain from the treasury (MP-GAME.md §2). It is single-line, key-sorted,
  no trailing newline **on purpose**.
- `metadata/mp/*.json` (and `sealed.png`) — pinned by raw CID; those CIDs are
  what `unrevealedURI()` and `contractURI()` return on-chain.

`.gitattributes` marks these paths `-text` so Git never applies CRLF
normalization on a Windows checkout. Do not remove those lines. Do not run a
formatter across the repository. If a tool "helpfully" rewrote one of them,
restore it from Git and re-verify:

```bash
npm run verify:provenance                          # raw bytes -> provenanceHash
node generator/merged-public/verify-mp.mjs --rpc   # ...and against the chain
```

## The pinned toolchain, and why it is pinned

`hardhat.config.js` pins **solc 0.8.24**, **`evmVersion: shanghai`**,
**optimizer enabled with 200 runs**, and `package.json` pins
**`@openzeppelin/contracts` at exactly `5.2.0`** — no caret, deliberately.

`MergedPublic` is deployed and **source-verified** on Blockscout. Verification
compares compiler input from this tree against the deployed bytecode. Change
the compiler version, the EVM target, the optimizer runs, or the OpenZeppelin
version and this tree no longer reproduces that bytecode — the live contract
becomes unverifiable from its own repository, which is exactly the claim this
project makes about itself. `MergedPublicBoard` compiles under the same
settings so it will re-verify the same way after it deploys.

So: do not bump those versions. Do not add `^` to the OpenZeppelin pin. Do
not "upgrade to a newer solc" as a drive-by. If a dependency change is truly
needed, it is a deliberate, documented decision with re-verification checked
first — not a lockfile refresh.

## Running the suites

```bash
npm install
npm test                  # hardhat test && vitest run — the full gate
npm run test:contracts    # Hardhat/Chai contract suites (test/contracts/)
npm run test:app          # Vitest: board + fleet-registry tests (see vitest.config.js)
npm run verify:provenance # recompute the provenance hash from raw bytes
npm run compile           # solc under the pinned settings
```

`npm test` is the gate before any commit that touches contracts, the board,
or the fleet rail. Additional verifier modes (`--assignment`, `--commitment`,
`--rpc`) are documented in the header of
`generator/merged-public/verify-mp.mjs`; the deploy, mint, and pinning
scripts document their confirmation env vars in their own headers.

## The vendoring rule (fleet-board)

`fleet-board/` in this repository is **canonical**. The website repository
carries a **byte-identical** vendored copy at `public/fleet/`, which is what
serves mergedpublic.com/fleet.

Edit here first. Run `npm run test:app`. Then re-copy the files to the
website repo unchanged. Never edit the website copy first, and never let the
two drift — a board that disagrees with this repository is a transparency
board that cannot be trusted. `fleet-board/README.md` restates this and
carries the board's own language rules.

## The MP fleet rail

The rail is how MP holders and their agents work funded bounties: a task is
funded in Merged Credits on `MergedPublicBoard`, an agent runs in public CI
and **opens a pull request**, a human reviews and merges, and only then does
a human settle on-chain. A holder joins by signing a link message locally
with `scripts/link-mp.mjs sign`, which never lets the key leave their
machine; anyone can re-check the entry with `link-mp.mjs verify`, which needs
no key and reads no `.env`. `agents/registry.json` holds the accepted
bindings, `agents/run-agent.mjs` works exactly one funded task per run, and
`.github/workflows/mp-fleet.yml` is the dispatch. Read those three headers
before changing any of them — each states its own trust boundary.

Its invariants are not negotiable, and every one of them fails **loudly**:

- **No `ANTHROPIC_API_KEY` secret configured → the rail is dormant** and says
  so. It never runs a degraded or simulated version of itself.
- **No verified holders in the registry → "no verified holders yet, nothing
  to run."** Never invent a participant.
- **No `deployments/mp-board.robinhood.json` → bounties are not funded.** No
  tool may assume, guess, or hardcode the board address. Read it from that
  record at runtime and error clearly when it is absent.
- **Never fail silently and never fabricate work.** A precondition that is
  missing is a stated no-op, not a quiet skip and not a plausible-looking
  output.
- **CI security:** `workflow_dispatch` inputs reach scripts only as env vars,
  never interpolated into a `run:` line; validate input shapes; pin
  third-party actions to a tag; keep `permissions:` minimal.
- **No signing key ever enters CI.** Agents open pull requests; they cannot
  settle, cannot pay, and cannot hold credits.

## Keys and addresses

- **Never read, print, or ask for a private key.** `.env` is gitignored and
  is not yours to open; `.env.example` shows the shape and holds nothing.
  Signing happens on the human's machine. A key never enters a file, a log,
  a pull request, an issue, or CI.
- **Never invent an address.** The MP contract and the MC token address are
  recorded in `deployments/` and `README.md`; everything else comes from a
  `deployments/` record at runtime. If the record does not exist, the correct
  output is an error that says so.
- Deploy guards (a per-network record that refuses reruns) exist to be
  obeyed. Do not set `REDEPLOY=1` to defeat one.

## Standing language rules

These are commitments, not tone. Do not soften, hedge, or re-word them into
something that implies more.

- **Merged Credits are payment for verified work, never for holding**, and
  they settle **only when work merges**. Never connect credit movement to
  simply owning a token.
- **No yield, APY, returns, price, lottery, or investment language. Ever.**
  Not in docs, not in UI copy, not in a commit message.
- **Agents open pull requests; humans review and merge.** Say it that way.
- **The operator is also the settlement oracle, and that is a trusted role.**
  State it plainly wherever settlement is described; do not dress it up as
  trustless.
- **No gate, feature, or migration is promised on a date.**
- **"Robinhood has not endorsed, reviewed, or partnered with this project."**
  Verbatim, wherever the chain is named.
- **MP-native naming only.** MP is decoupled (`DECOUPLING.md`); the rail is
  "the MP fleet" / "the Merged Public fleet". Do not carry naming, branding,
  or gates from any other collection into new work. Where existing dated
  amendment blocks name the retired collection, that text is the historical
  record — leave it as written.
- Anything touching real money waits on legal, tax, and payment review.

## Amending the MP documents

`MP-VALUE.md`, `MP-GAME.md`, `MP-LAUNCH.md`, `MP-REVEAL.md`, and
`DECOUPLING.md` are public promises. They are amended in the open or not at
all.

- **Never silently rewrite a promise.** Add or update a dated amendment block
  at the top of the file: `> **Amended YYYY-MM-DD — <what changed>.**` naming
  what changed, what it supersedes, and linking the record (usually
  `DECOUPLING.md`). Follow the existing blocks' shape.
- **Supersede in place.** Leave the superseded promise legible and mark it
  superseded rather than deleting it, so a reader can see what was promised
  before.
- **Historical sections stay historical.** Where a launch record has already
  happened, an edit gets an inline changelog line (see `MP-LAUNCH.md` §1)
  rather than a rewritten past.
- **Status lines must match reality.** If a document says a record exists,
  it must exist. Restore a removed cross-reference only once its target is
  actually in this repository — and say in the amendment block that it was
  restored.
- If a path named in a document does not exist yet, that is the honest state:
  fix the document, do not create a stub to make the sentence true.

## Style

- Hardhat scripts under `scripts/` and tests under `test/contracts/` are
  **CommonJS** (`require`, `module.exports`). Node tooling is **ESM `.mjs`**
  (`generator/merged-public/verify-mp.mjs`, `scripts/pin-mp*.mjs`,
  `scripts/echo-manifest.mjs`, `scripts/link-mp.mjs`,
  `agents/run-agent.mjs`). Keep a new file on the side of the fence its
  neighbours are on.
- Every script starts with a header comment saying what it does, what it
  refuses to do, and which env vars gate it.
- Comments explain **constraints**, not mechanics — why a guard exists and
  what breaks without it, not what the next line does.
- **No emoji**, anywhere.
- Prefer no new dependencies. The dependency list is part of the
  verification story.
