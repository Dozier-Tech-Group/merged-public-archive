#!/usr/bin/env node
/**
 * Pin the Merged Public pre-reveal metadata to IPFS via Pinata, so what the
 * 10,000 sealed tokens display no longer depends on GitHub raw.
 *
 * Order matters:
 *   1. pin metadata/mp/sealed.png                      -> imgCID
 *   2. rewrite unrevealed.json + collection.json image -> ipfs://imgCID
 *   3. pin both JSONs                                  -> two CIDs
 *   4. verify all three resolve on a public gateway
 *   5. record CIDs in deployments/merged-public.robinhood.json and print the
 *      two onchain calls the OPERATOR then makes (Blockscout Write tab):
 *        setUnrevealedURI("ipfs://<unrevealedCID>")
 *        setContractURI("ipfs://<collectionCID>")
 *
 * Needs PINATA_JWT in .env. Never prints the token. Idempotent: re-pinning
 * identical bytes returns the same CID.
 *
 * HARD RULE: the CID Pinata returns must equal the CID computed locally from
 * the exact bytes (ipfs-only-hash, CIDv0). Pinata has been observed wrapping
 * single-file uploads in a directory — the wrapper CID then serves a folder
 * listing instead of the document, which breaks tokenURI/contractURI parsing.
 * The assertion makes that failure loud instead of silent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Hash = createRequire(import.meta.url)("ipfs-only-hash");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
  }
}

const JWT = process.env.PINATA_JWT;
if (!JWT) {
  console.error("HOLD: set PINATA_JWT in .env (create a free key at app.pinata.cloud -> API Keys).");
  process.exit(2);
}

const MP_DIR = join(root, "metadata", "mp");
const RECORD = join(root, "deployments", "merged-public.robinhood.json");

async function pin(path, name) {
  const bytes = readFileSync(path);
  const localCID = await Hash.of(bytes, { cidVersion: 0 });
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  form.append("pinataMetadata", JSON.stringify({ name: `merged-public-${name}` }));
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: false, cidVersion: 0 }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata ${res.status} for ${name}: ${(await res.text()).slice(0, 200)}`);
  const { IpfsHash } = await res.json();
  if (IpfsHash !== localCID) {
    throw new Error(
      `HOLD: Pinata returned ${IpfsHash} for ${name} but the file's own CID is ${localCID} — ` +
      `the upload got wrapped in a directory. Do NOT put the returned CID onchain.`
    );
  }
  console.log(`pinned ${name}: ${IpfsHash} (matches local CID)`);
  return IpfsHash;
}

// Trust nothing but the bytes: a gateway 200 can be a folder listing or an
// interstitial page. Verified means the gateway returned the exact file.
async function verify(cid, path, name) {
  const want = readFileSync(path);
  for (const gw of ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"]) {
    try {
      const res = await fetch(gw + cid, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const got = Buffer.from(await res.arrayBuffer());
      if (got.equals(want)) { console.log(`verified ${name} byte-for-byte via ${gw}${cid}`); return true; }
      console.log(`NOTE: ${gw}${cid} answered but with different bytes (listing/interstitial) — trying next gateway.`);
    } catch {}
  }
  console.log(`WARNING: ${name} (${cid}) not byte-verified on public gateways yet — the local-CID match above is the real guarantee; gateways usually catch up.`);
  return false;
}

const imgCID = await pin(join(MP_DIR, "sealed.png"), "sealed.png");

for (const f of ["unrevealed.json", "collection.json"]) {
  const p = join(MP_DIR, f);
  const doc = JSON.parse(readFileSync(p, "utf8"));
  doc.image = `ipfs://${imgCID}`;
  writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
}
console.log("image fields rewritten to ipfs://" + imgCID);

const unrevealedCID = await pin(join(MP_DIR, "unrevealed.json"), "unrevealed.json");
const collectionCID = await pin(join(MP_DIR, "collection.json"), "collection.json");

await verify(imgCID, join(MP_DIR, "sealed.png"), "sealed.png");
await verify(unrevealedCID, join(MP_DIR, "unrevealed.json"), "unrevealed.json");
await verify(collectionCID, join(MP_DIR, "collection.json"), "collection.json");

const record = JSON.parse(readFileSync(RECORD, "utf8"));
record.ipfs = {
  sealedImage: `ipfs://${imgCID}`,
  unrevealed: `ipfs://${unrevealedCID}`,
  collection: `ipfs://${collectionCID}`,
  pinnedAt: new Date().toISOString(),
};
writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
console.log("CIDs recorded in deployments/merged-public.robinhood.json");

console.log(`
NEXT — two writes from the OPERATOR wallet (owner) on Blockscout:
  https://robinhoodchain.blockscout.com/address/${record.address}?tab=write_contract
  1. setUnrevealedURI  ->  ipfs://${unrevealedCID}
  2. setContractURI    ->  ipfs://${collectionCID}
GitHub raw keeps serving as a mirror; the chain will point at IPFS.`);
