# The decoupling — 2026-08-20

Merged Public now stands alone. This note is the public record of what
changed, because this project amends its promises in the open or not at all.

## What changed

1. **Merged Public's record moved here.** This repository is now the
   canonical home of the MP contract sources, the provenance commitment, the
   sealed metadata, the Season Zero manifest, the reveal runbook, and the
   fleet board. History before 2026-08-20 lives in the repository MP
   originally shipped from; every byte-sensitive artifact was copied
   byte-for-byte and re-verified against its on-chain commitment
   (`generator/merged-public/provenance.json` still hashes to the immutable
   `provenanceHash` — check it yourself with `npm run verify:provenance`).

2. **MP has its own work board.** `contracts/MergedPublicBoard.sol` — the
   same tested board logic MP's documents previously pointed at, with the
   settlement gate now the Merged Public collection itself: only a wallet
   holding an MP identity can be settled or withdraw. This is the contract
   change MP-GAME.md §6 had named as "unscheduled future work." It is now
   scheduled, tested, and deploying; its address will live in
   `deployments/mp-board.robinhood.json`, and no other address should ever
   be trusted for it.

3. **The previously referenced board is retired from MP's stack.** The old
   bounty board (gated on a different collection) no longer appears in any
   MP promise. It will be wound down and paused by its owner, declared and
   recorded on its own side — nothing about it was deleted or hidden.

4. **Merged Credits (MC) carry over.** MC
   (`0x040f12C71ddA0bA9D91E94016ea5C348106ab429`, 0-decimals ERC-20,
   source-verified on Blockscout) is the neutral credit token and predates
   this repository. The rules do not change: **MC settles only when work
   merges — payment for verified work, never for holding.**

5. **mergedpublic.com carries Merged Public only.** The website's fleet
   board and beta pages re-point to the MP board and this repository.

## What did not change

- The archive itself: 10,000 entities, minted sealed, provenance committed
  before the art existed. Nothing on-chain moved.
- The standing rules, verbatim and permanent: no yield, no APY, no price
  talk, ever. Rewards are payment for verified contribution — never for
  holding. Not a security, not a legal record, not a lottery. Robinhood has
  not endorsed, reviewed, or partnered with this project. No gate is
  promised on a date. Anything touching real money waits on legal, tax, and
  payment review.
- Ownership transparency: the projects of the Dozier-Tech-Group organization
  share principals, and MP's documents keep saying so. Separation of rails
  is not a separation of ownership, and pretending otherwise would be its
  own kind of dishonesty.

## Why

Merged Public is the archive of the merged public — its identity, its game,
and its work rail should gate on Merged Public, and its record should stand
in its own repository, verifiable end to end without reference to any other
collection.

Every amended document carries a dated amendment block naming what changed.
If you find a promise this note missed, open an issue — the record gets
fixed in the open.
