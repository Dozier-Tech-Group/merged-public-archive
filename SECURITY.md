# Security policy — Merged Public

This file describes what is actually true of this repository today: how to
report a problem, who holds the keys, what the contracts can and cannot do,
and which files are byte-locked to an on-chain commitment. It promises no
dates and no payment. If something here stops matching reality, it gets an
amendment block, not a quiet rewrite.

## What is in scope

- [`contracts/MergedPublic.sol`](contracts/MergedPublic.sol) — live at
  `0x5D000b230653E416FF41451525b144a6C2Ad7178` on Robinhood Chain 4663,
  source-verified, record in
  [`deployments/merged-public.robinhood.json`](deployments/merged-public.robinhood.json).
- [`contracts/MergedPublicBoard.sol`](contracts/MergedPublicBoard.sol) —
  **not deployed.** When it deploys, its address lands in
  `deployments/mp-board.robinhood.json` and nowhere else.
- `scripts/` — deploy, mint, ownership, pinning, and manifest tooling that a
  human runs locally with a key.
- `fleet-board/` — the read-only transparency board served at
  mergedpublic.com/fleet. It holds no keys and signs nothing.
- The MP fleet rail: the workflows in `.github/workflows/`, the runner
  `agents/run-agent.mjs`, the holder registry `agents/registry.json` and the
  task mirror beside it, and the linking tool `scripts/link-mp.mjs`.
- The byte-sensitive commitment files listed further down.

Out of scope because they are somebody else's systems: Robinhood Chain and
its RPC endpoints, Blockscout, IPFS gateways and the pinning service, GitHub,
and any marketplace. Report those to their owners. Merged Credit (MC,
`0x040f12C71ddA0bA9D91E94016ea5C348106ab429`) predates this repository and is
not defined here; the board treats it as an ordinary ERC-20 through
`SafeERC20`.

## Reporting a vulnerability

**Non-sensitive matters** — a broken link, a documentation claim that does
not check out, a failing verification, a CI bug, a board panel showing the
wrong thing: **open a GitHub issue** in this repository
(`Dozier-Tech-Group/merged-public-archive`). Public is better for these. The
whole point of this repo is that a skeptical reader can check us, and an
issue is how the record gets fixed in the open.

**Sensitive matters** — anything that could move credits, forge a
settlement, bypass the identity gate, brick a contract, or expose a key —
should not be filed as a public issue with working detail in it. Two paths:

1. If this repository's **Security** tab offers "Report a vulnerability",
   that is GitHub's private vulnerability reporting and it is the preferred
   channel. Use it.
2. Otherwise, open a public issue that contains **no exploit detail** — a
   title such as "security contact requested" and one line saying you have a
   sensitive report — and ask the maintainer to make contact. They will
   arrange a private channel from there.

**This repository publishes no security email address.** If someone gives
you one and claims it is ours, it is not — treat an address that does not
appear in this file the same way you would treat a contract address that does
not appear in `deployments/`.

No response time is promised. This is a small team and a date promised here
would be a date broken later.

**There is no bug bounty program, and no payment is promised for a report.**
Merged Credit is payment for verified work, never for holding, and it settles
only when work merges — so a fix that lands as a merged pull request against
a funded bounty settles under the ordinary rule, and the report by itself
does not. Nothing in this section is an offer.

When you test, test against the local Hardhat network or testnet 46630. Do
not probe mainnet state in ways that spend other people's gas, spam the
chain, or touch the treasury.

## The trust model, stated plainly

- **One owner key today.** `MergedPublic` is owned by the operator wallet;
  `MergedPublicBoard` will be owned by it when it deploys. Both use
  `Ownable2Step`, so a transfer requires the new owner to accept — a
  fat-fingered address cannot orphan the contract. The owner, deployer, and
  treasury addresses are recorded in
  `deployments/merged-public.robinhood.json`. Read them from that file. Do
  not accept an address from a chat message, a screenshot, or this sentence.
- **The operator is also the settlement oracle, and that is a trusted role.**
  `MergedPublicBoard.settle(issueId, winner)` is callable by the owner or by
  an oracle address the owner sets. Whoever holds that key decides which
  wallet is recorded as having won a bounty. The contract checks three
  things and only three: the bounty was funded, it is not already settled,
  and the winner holds a Merged Public identity. **It cannot judge whether
  the work was real.** That judgment is a human reading a pull request and
  merging it. Say it without decoration: if the operator key is compromised
  or the operator acts in bad faith, funded credits can be settled to a
  wallet that did no work, provided that wallet holds an MP identity.
- **A multisig is the intended direction, with no date attached.** Moving
  ownership of both contracts to a multisig on 4663 is the plan of record
  (`MP-LAUNCH.md` §1). It has not happened. When it does, the transaction
  and the new owner will be written into `deployments/` like everything else.
- **Automation never holds a key.** Agents in the MP fleet rail open pull
  requests; humans review and merge; a human signs the settlement locally
  afterwards. No CI job holds a signing key, and no CI job can settle a
  bounty.
- **No contract in this repository is upgradeable.** There is no proxy, no
  admin slot, no `delegatecall`. The bytecode deployed is the bytecode
  forever, which is a limit on the operator as much as on anyone else.

## What the contracts cannot do

Read the sources — `contracts/MergedPublic.sol` and
`contracts/MergedPublicBoard.sol` are short on purpose. This is the honest
enumeration.

### MergedPublic (live)

| It cannot | Because |
| --- | --- |
| Mint a 10,001st token | `MAX_SUPPLY = 10_000` is a compile-time constant; `mint` and `mintBatch` revert past it. `MAX_BATCH = 250` bounds every owner mint. |
| Change the provenance commitment | `provenanceHash` is `immutable`, set in the constructor before any art existed. There is no setter, and no upgrade path to add one. |
| Un-reveal | `reveal(baseURI)` reverts once `revealed` is true. One way. |
| Unfreeze metadata | `freezeURI()` sets `uriFrozen` and there is no unfreeze; after it, `setBaseURI` reverts. Token metadata is fixed. |
| Repoint the sealed document after reveal | `setUnrevealedURI` reverts once revealed. |
| Be upgraded or proxied | Immutable implementation, no proxy. |
| Set a royalty above 10% | `MAX_ROYALTY_BPS = 1000`; `setDefaultRoyalty` reverts above it. Default is 5%. |
| Burn, seize, freeze, or blacklist a holder's token | No burn function, no admin transfer, no allowlist of any kind exists in the source. |
| Be abandoned mid-flight | `renounceOwnership` reverts unless the URI is revealed **and** frozen, and always reverts while paused — so no one can leave transfers bricked with no owner to unpause. |

What the owner **can** still do, stated because it is the real risk surface:
pause all transfers; reveal (one way); repoint metadata until freeze; change
the royalty receiver within the cap; and edit `contractURI()`, which is
collection-page branding and is deliberately not covered by the freeze.

### MergedPublicBoard (not deployed)

| It cannot | Because |
| --- | --- |
| Mint anything | It has no mint function and no minting authority over MC or MP. It can only move credits that were funded into it. |
| Take credits from anyone but the funder | `fund` calls `safeTransferFrom(msg.sender, ...)` and is `onlyOwner`, so it pulls only from the owner's own allowance. |
| Settle to a wallet without a Merged Public identity | `settle` calls `identity.balanceOf(winner)` and reverts on zero. The identity contract is `immutable`, fixed at construction to the address in `deployments/merged-public.robinhood.json`. |
| Pay out to a wallet without an identity | `withdraw` re-checks the caller's identity balance at withdrawal time, not at settlement time. |
| Settle an unfunded issue, or settle one twice | `reward == 0` reverts; the `settled` flag reverts a second settle. First settle wins. |
| Re-fund an issue id | A non-zero reward reverts as already funded. Amounts are set once. |
| Push credits at anyone | Withdrawals are pull-only: the holder zeroes their own `claimable` before the transfer, and `withdraw` is `nonReentrant`. |
| Be upgraded | Not upgradeable, no proxy. |

Limits that cut against the operator too, and that you should know before you
fund anything:

- **There is no sweep, rescue, or refund function.** Credits funded to an
  issue leave the board only through `settle` and then `withdraw` by an
  identity-holding winner. Fund the amount you mean, against the id you mean.
- **Pausing halts withdrawals as well as funding and settlement.** A paused
  board holds credits that no one can pull until it is unpaused.
- **A winner who no longer holds an MP identity cannot withdraw.** The
  balance is not lost — it stays in `claimable` — but it is not withdrawable
  until that wallet holds an identity again.
- **`settle` makes one external call before it writes** — `balanceOf` on the
  immutable identity contract set at construction. That contract is
  `MergedPublic` in this repository and it does not call out; the surface is
  named here rather than left for you to find.
- **Nothing here treats holding as work.** There is no accrual, no emission,
  no schedule. A bounty exists because a human funded it, and it settles
  because a human merged something.

## There is no third-party audit

**These contracts have not been audited by a third party.** Stating it
plainly is the policy; there is no qualifier coming. What stands in for an
audit, and what it is worth:

- Small, non-upgradeable surfaces built on OpenZeppelin **exactly 5.2.0**,
  pinned in `package.json`.
- Compiler pinned in `hardhat.config.js` (solc 0.8.24, `evmVersion`
  shanghai, optimizer 200) so the deployed bytecode re-verifies from this
  tree.
- Source verified on Blockscout for the live contract — you can diff what
  runs against what is here.
- Hard caps, `immutable` commitments, one-way switches, pull-over-push
  payouts, `ReentrancyGuard`, and `Ownable2Step`.
- The test suites in `test/contracts/` gate changes (`npm test`).

None of that is an audit. Size your exposure accordingly.

## Byte-sensitive files — do not reformat these

Three sets of bytes in this repository are commitments that already exist
on-chain. Re-serializing them, pretty-printing them, adding or removing a
trailing newline, or letting Git rewrite their line endings **breaks the
commitment** — the file stops hashing to the value the chain carries, and the
public record stops verifying.

| File | The commitment |
| --- | --- |
| `generator/merged-public/provenance.json` | keccak256 of its raw bytes is `provenanceHash` in the live contract — `immutable`, set at deploy, before any art existed. |
| `game/season-zero/manifest.json` | keccak256 of its raw bytes is echoed on-chain in a zero-value transaction from the treasury (MP-GAME.md §2). |
| `metadata/mp/*.json` (and `metadata/mp/sealed.png`) | Pinned to IPFS by raw CID; those CIDs are what `unrevealedURI()` and `contractURI()` return on-chain. |

`.gitattributes` marks these paths `-text` so Git never applies CRLF
normalization to them on a Windows checkout. Do not remove those lines, and
do not let an editor, a formatter, or a "tidy the JSON" pass touch these
files. Verify after any operation that came near them:

```bash
npm run verify:provenance                       # raw bytes -> provenanceHash
node generator/merged-public/verify-mp.mjs --rpc  # ...and against the chain
```

## Operational rules

These are the rules that keep the rest of this document true.

- **Keys stay on the human's machine.** A private key never goes into this
  repository, an issue, a pull request, a log, a chat message, or a CI
  secret. `.env` is gitignored (`.env.example` shows the shape and holds
  nothing). Scripts read `PRIVATE_KEY` locally and never print it. An agent
  never types a key, and never asks for one.
- **CI holds no signing key.** The fleet rail's secrets are API credentials
  for the agent, nothing more. Every automated path is dormant and says so
  when a precondition is missing; nothing in CI can move a credit.
- **Never trust an address that is not in `deployments/`.** That is the whole
  rule. `MergedPublicBoard` has no address yet, so today the correct
  behavior for any tool asked for the board address is a clear error, not a
  guess. When `deployments/mp-board.robinhood.json` exists, it is the only
  place that address comes from.
- **Verify every CID locally before it goes on-chain.** The pinning scripts
  assert that the service's returned CID equals the CIDv0 computed locally
  from the exact bytes, because a service was observed wrapping a
  single-file upload in a directory — the wrapper CID serves a folder
  listing, and `tokenURI` breaks. The assertion exists to make that loud.
  Read back `unrevealedURI()`, `contractURI()`, and `tokenURI` after any
  on-chain repoint.
- **Deployment guards exist to be obeyed.** The deploy scripts refuse to run
  once a network's record exists. Do not set `REDEPLOY=1` to get around a
  guard; a second contract is a second collection and a permanently confused
  public record.
- **Holders prove control with a signature, never with a key.**
  `scripts/link-mp.mjs sign` runs on the holder's own machine and emits only
  the registry block; `link-mp.mjs verify` needs no key, reads no `.env`, and
  re-checks that the recovered signer actually holds a Merged Public identity
  on-chain. A pull request adding a registry entry gets re-verified by the
  reviewer rather than taken on trust — the whole point of that mode is that
  nobody has to believe a reviewer.
- **Review before merge, always.** Agents open pull requests. A human reads
  the diff and merges it. Settlement follows the merge; it never precedes it.

## If a key is compromised

Do these in order, and write the dated record afterwards:

1. `pause()` on the affected contract(s) — this stops transfers on
   `MergedPublic` and stops funding, settlement, and withdrawal on the board.
2. Move ownership with `transferOwnership` to a safe address and have that
   address call `acceptOwnership()` (`Ownable2Step` — the transfer is not
   real until it accepts); point the board's oracle at an address the
   attacker does not control.
3. Publish what happened in this repository, dated, with the transactions.

What survives a total key loss, because it was made immutable on purpose:
the 10,000 supply cap, the provenance hash, and any metadata already frozen.
What does not: a compromised key before freeze could reveal early, repoint
pre-freeze metadata, pause transfers, or settle funded credits to a wallet
holding an identity. That asymmetry is the reason the freeze and the multisig
migration matter.

For the rest of the record: [README.md](README.md) is the map,
[DECOUPLING.md](DECOUPLING.md) is the dated account of why MP stands alone,
and [MP-VALUE.md](MP-VALUE.md) §4 states what Merged Public is not.
[CLAUDE.md](CLAUDE.md) carries the same rules in the form future automated
sessions have to follow.

---

Standing rules, unchanged and permanent: no yield, no APY, no price talk.
Merged Credits are payment for verified work, never for holding, and settle
only when work merges. Not a security, not a legal record, not a lottery. No
gate is promised on a date. Built on Robinhood Chain; **Robinhood has not
endorsed, reviewed, or partnered with this project.**
