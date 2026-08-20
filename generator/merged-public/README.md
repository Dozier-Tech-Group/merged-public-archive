# Merged Public — generative provenance

Data spine for the 10,000-entity Merged Public archive: 9,990 generated
portraits plus 10 hand-made legendary 1/1s, on Robinhood Chain (4663).

## Files

| File | What it is |
| --- | --- |
| `weights.json` | The nine layer weight tables from the Trait Architecture spec (Rev A), as data. Seed `20260818`. Every layer sums to exactly 100.00. |
| `rules.json` | Exclusion rules R-01 through R-06 — the full rulebook, kept short on purpose. |
| `provenance.json` | Canonical provenance: single-line JSON, recursively sorted keys, no extra whitespace, no trailing newline. **Byte-for-byte final.** |
| `build-provenance.mjs` | Rebuilds `provenance.json` deterministically from `weights.json` + `rules.json` and prints its keccak256. |
| `verify-mp.mjs` | The public verifier — the audit-race tool. Default: provenance bytes vs the recorded hash (`--rpc` adds the live on-chain check). `--assignment <file>`: full validation of a claimed 10,000-entity set (structure, trait membership, rules R-02–R-06, duplicate ban, min 2-trait distance). `--commitment`: verifies a revealed assignment + salt against the Season Zero manifest. Holds no secrets. |

## The audit path

The seed plus `weights.json` plus `rules.json` fully determine all 9,990
generated tokens. `provenance.json` embeds all three (plus the ten legendary
names — token IDs are assigned after shuffle and stay sealed until reveal, so
they are deliberately absent). At deploy, `scripts/deploy-merged-public.js`
hashes the **raw bytes** of `provenance.json` and commits that keccak256 as the
contract's immutable `provenanceHash` — before any art exists onchain.

Anyone can verify, at any time:

```
node generator/merged-public/build-provenance.mjs   # rebuilds the file, prints keccak256
# keccak256(provenance.json bytes) === MergedPublic.provenanceHash()
```

After reveal, re-running the generator from the recorded seed must reproduce
the 9,990 trait assignments exactly. Sealed launch, auditable draw.

## Do not touch

`provenance.json` must never be reformatted, re-encoded, or given a trailing
newline once the hash is onchain — its exact bytes are the commitment. If an
editor or hook rewrites it, `build-provenance.mjs` restores the canonical bytes.
