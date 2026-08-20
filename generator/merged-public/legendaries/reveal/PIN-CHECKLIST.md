# Reveal package — first 5 legendaries

Everything here is finished art + metadata, ready to pin and slot into the Merged Public reveal.
Nothing here is on-chain. Pinning is your step (needs your Pinata / web3.storage account).

## What's in this folder
- `png/`        2048×2048 final art for the 5 (integrity-hashed in manifest.json)
- `metadata/`   per-token reveal JSON (image points to `ipfs://__REVEAL_CID__/<file>.png`)
- `manifest.json`  sha256 of each PNG — verify the bytes after pinning

## The 5
1. The Founder  — the-founder.png / the-founder.json
2. The Night Engineer  — the-night-engineer.png / the-night-engineer.json
3. The Cartographer  — the-cartographer.png / the-cartographer.json
4. The Machinist  — the-machinist.png / the-machinist.json
5. The Signal  [VAULTED]  — the-signal.png / the-signal.json

## Pin checklist (your step — I can't handle keys or upload)
1. These 5 are part of the FULL reveal set. Do NOT pin/reveal early — reveal is all-or-nothing
   for the 10k and would collapse Season Zero. This package just makes the 5 reveal-ready.
2. At reveal time, after the 10k draw assigns token IDs:
   - rename each `<slug>.png` / `<slug>.json` to `<tokenId>.png` / `<tokenId>.json`
   - inside each JSON, set `image` to `ipfs://<REVEAL_CID>/<tokenId>.png`
   - the frame's MP-#### stamp is a placeholder (XXXX) here; the final render stamps the real id
3. Pin the complete reveal image folder → get REVEAL_CID.
4. Replace `__REVEAL_CID__` in every metadata file, re-pin the metadata folder → get METADATA_CID.
5. Verify: for each PNG, sha256 must match manifest.json.
6. Only then, at the real reveal moment: `reveal("ipfs://<METADATA_CID>/")`.

## Hard rule
Reveal happens once, for all 10,000, only after the art is complete and Season Zero has run.
This folder is staging — not a launch.
