# Merged Public — launch runbook

> **Amended 2026-08-20 — the decoupling.** Merged Public now stands entirely on its
> own rails: settlement and withdrawal of Merged Credit are gated on holding a
> Merged Public identity by `contracts/MergedPublicBoard.sol` — the same tested
> board logic, and the contract change MP-GAME.md §6 foreshadowed as "unscheduled
> future work" — with its deployment to be recorded in
> `deployments/mp-board.robinhood.json`. The old BAYOU-gated BountyBoard is retired
> from MP's stack and will be wound down and paused on its own side; any earlier MP
> promise that pointed at it is superseded by the new board. In this runbook the
> changes are small: the compliance citation now points at MP-VALUE.md §4, a funding
> aside in §1 was removed from the historical record with a changelog line, §5
> now states the collection's independence plainly, and the §1 SECURITY.md
> reference — dropped in that pass because the file did not yet resolve in this
> repository — is **restored**, now that [SECURITY.md](SECURITY.md) exists here
> and states the trust model, the contracts' hard limits, and the byte-sensitive
> commitment files directly. Full record: [DECOUPLING.md](DECOUPLING.md).

> **Status: LAUNCHED 2026-08-19.** `MergedPublic` is live at
> [`0x5D000b230653E416FF41451525b144a6C2Ad7178`](https://robinhoodchain.blockscout.com/address/0x5D000b230653E416FF41451525b144a6C2Ad7178#code)
> — 10,000/10,000 minted to the treasury, source verified, owner = operator wallet.
> **Do not deploy again** (the per-network record refuses reruns). Sections 1–5 are
> historical record; what remains live is §6 (provenance is published), the Season
> Zero legendary-ID commitment (MP-GAME.md §4), and §7 reveal + freeze when the art ships.

10,000-entity archive collection. Pre-reveal launch: contract deploys with the sealed
`unrevealed.json` and an immutable provenance hash; all 10,000 tokens are owner-minted to
the treasury; reveal comes later. Robinhood Chain **4663**, gas in ETH.

Contract: `contracts/MergedPublic.sol` (`MAX_SUPPLY` 10,000, `MAX_BATCH` 250, ERC-2981 5%,
Ownable2Step, Pausable, renounce blocked until URI frozen).

**Do not paste `PRIVATE_KEY` into chat. Never commit `.env`.** These tokens are archive
entries, not securities or legal instruments. No yield, no APY, no price promises — ever
(see [MP-VALUE.md](MP-VALUE.md) §4).

| | Mainnet | Testnet |
|---|---|---|
| Network | `robinhood` | `robinhoodTestnet` |
| Chain ID | **4663** | 46630 |
| Explorer | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) |

## 1. Prerequisites

- [x] **Treasury address decided:** `0xBCCAecdBb4F0c7af32C8018486D0b52A474d9B4a`
  (supplied by the owner 2026-08-18; default in `scripts/mint-mp.js` and the deploy
  script's royalty step). All 10,000 tokens mint to it and ERC-2981 royalties point at it.
  A Gnosis Safe on 4663 remains the long-term target;
  an EOA treasury is acceptable at launch with a planned migration — the single
  owner key, the trusted operator/oracle role, and that migration are set out in
  [SECURITY.md](SECURITY.md), with no date attached to it.
- [ ] **Provenance final.** `generator/merged-public/provenance.json` exists and is
  byte-for-byte final. The deploy script hashes the exact raw file bytes with keccak256 and
  commits that hash immutably in the constructor. After deploy, the file must never be
  reformatted — not even whitespace — or the published file will no longer match the
  on-chain hash.
- [ ] **Sealed metadata live.** `metadata/mp/unrevealed.json` and
  `metadata/mp/collection.json` are pushed to `master` and load over
  `raw.githubusercontent.com` (the deploy defaults point there).
- [ ] **Funded deployer — the one step only the owner can do.** The deploy EOA needs ETH
  **on Robinhood Chain (4663)**, not Ethereum L1. Measured 2026-08-18: treasury holds
  0.0295 ETH on Ethereum mainnet and **0 on 4663**; gas price on 4663 was ~0.02 gwei, so
  deploy + `setContractURI` + royalty + all 40 mint batches ≈ **0.012 ETH**. Move
  **~0.02 ETH** (buffer included) onto 4663 to the deployer wallet. Nothing fires until
  this lands. *(Changelog 2026-08-20: an aside comparing this funding path to the BAYOU
  launch was removed in the decoupling pass — see the amendment note above. The
  instruction itself is unchanged; §§1–5 remain historical record.)*
- [ ] **`.env` `PRIVATE_KEY` filled by the owner only** — typed locally by the human owner,
  never by an agent, never in chat, never committed.

## 2. Testnet rehearsal (chain 46630)

```
npm run compile && npm run test:contracts
npm run deploy:mp:testnet
```

Confirm on the testnet explorer: `provenanceHash()` matches the printed hash,
`tokenURI` behavior via a test `mint`, `contractURI()` returns collection.json. Rehearse a
`mintBatch(treasury, 250)` and, if you want the full dress rehearsal, a `reveal` +
`freezeURI` on the throwaway testnet contract. Testnet contracts are disposable; mainnet is
not.

## 3. Mainnet deploy (chain 4663)

The script refuses mainnet unless you type the confirmation on purpose:

```
MP_DEPLOY_CONFIRM=yes-launch-merged-public npm run deploy:mp:mainnet
```

It prints chain, deployer, balance, URIs, and the provenance hash **before** deploying —
read that block, then let it run. It deploys, calls `setContractURI`, sets the ERC-2981
royalty receiver to the treasury (5%), and writes `deployments/merged-public.<network>.json`
(per-network records; a testnet rehearsal can never merge into the mainnet record). It
refuses to run again once that network's record exists.

Optional env overrides: `MP_UNREVEALED_URI`, `MP_CONTRACT_URI` (defaults point at
`metadata/mp/` on GitHub raw), `MP_TREASURY` (defaults to the address above).

## 4. Mint 10,000 to treasury

`MAX_BATCH` is 250, so the full supply is **40 × `mintBatch(treasury, 250)`** — about 40
transactions, each cheap on 4663. The script does the whole run and is resumable by
construction (each pass re-reads `nextTokenId()` from the chain):

```
MP_MINT_CONFIRM=yes-mint-merged-public npm run mint:mp:mainnet
```

(`npm run mint:mp:testnet` for the rehearsal; `MP_TREASURY` / `MP_BATCH_SIZE` override the
defaults.) When done: `nextTokenId()` returns 10001, `balanceOf(treasury)` returns 10000,
and the record's status flips to `minted`.

All tokens serve `unrevealedURI` until reveal — that is the launch state, not a bug.

## 5. OpenSea

- A new contract gets its **own collection page**. Merged Public is a fully independent
  collection — its own contract, its own page, its own rails. As of the 2026-08-20
  decoupling ([DECOUPLING.md](DECOUPLING.md)), no other collection's infrastructure has
  any role in MP's gates, rails, or rewards: the work board is
  [`contracts/MergedPublicBoard.sol`](contracts/MergedPublicBoard.sol), which gates
  settlement and withdrawal on holding a Merged Public identity, and its deployment
  will be recorded in `deployments/mp-board.robinhood.json` — once that record exists,
  trust no other address.
- **Claim/verify the collection with the deployer (owner) wallet** on OpenSea so you can
  manage the page.
- Branding comes from `contractURI()` → `metadata/mp/collection.json` (EIP-7572): name,
  description, image, external_link. Edit that file (and `setContractURI` if the location
  changes) rather than fighting the OpenSea form.
- Royalties: the deploy script points ERC-2981 (5%) at the treasury, and
  `collection.json` carries matching `seller_fee_basis_points` / `fee_recipient` fields.

## 6. Publish provenance

After deploy, publish so anyone can verify the draw was fixed before reveal:

1. The on-chain hash: `provenanceHash()` (also in the `ProvenanceCommitted` event and
   `deployments/merged-public.<network>.json`). Current canonical file hash:
   `0x9c123f7aa01c529a0bdba61bdd241b62e79a3452d294afae7d833e03d97bf952`.
2. The canonical file: `generator/merged-public/provenance.json`, committed to `master`
   byte-for-byte.
3. The check: keccak256 of the raw file bytes equals the on-chain hash.

## 7. Later: reveal, then freeze

Only when the full 10,000-item metadata + art are final and hosted:

0. **Before any Archive Game clue drops (and always before reveal):** assign the ten
   legendary token IDs, write the canonical assignment JSON, and publish
   `keccak256(assignment ‖ salt)` in the Season Zero manifest (see
   [MP-GAME.md](MP-GAME.md) §4). At reveal, open the assignment + salt so anyone can
   check the commitment. The IDs stay out of `provenance.json` by design.
1. `reveal(baseURI)` — **one-way**. `baseURI` must end with `/`;
   `tokenURI(1)` becomes `{baseURI}1.json`.
2. Fix mistakes with `setBaseURI` while unfrozen.
3. `freezeURI()` — **irreversible**. Only after everything checks out on marketplaces.
4. Only after freeze is `renounceOwnership` even possible (the contract blocks it earlier
   by design). Prefer keeping ownership with a Safe over renouncing.

## Do NOT

- **Do not run `deploy:mp:mainnet` again after a successful deploy.** A rerun makes a
  second contract and a duplicate collection. The script's record guard exists for this;
  do not set `REDEPLOY=1` to get around it.
- **Do not renounce ownership before reveal + freeze** — the contract refuses, and
  attempting it is a sign the plan is wrong.
- **Do not edit `generator/merged-public/provenance.json` after deploy.** The on-chain hash
  is immutable; the file must keep matching it byte-for-byte.
- **Do not call `reveal` or `freezeURI` early.** Both are one-way.
- **Do not mint before the treasury address is decided.**
- **Do not paste or print the private key. Do not commit `.env`.**
- **Do not promise yield, returns, or price appreciation anywhere** — launch copy included.
