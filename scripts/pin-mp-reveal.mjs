#!/usr/bin/env node
/**
 * Pin a Merged Public reveal tree (images or metadata) to IPFS via Pinata —
 * MP-REVEAL.md Phase E, at directory scale. Same discipline as pin-mp.mjs:
 * the CID is computed LOCALLY FIRST, the CID Pinata returns is hard-asserted
 * equal, and a mismatch is a loud HOLD — never a CID that goes onchain.
 *
 * Usage:
 *   node scripts/pin-mp-reveal.mjs --dir <path> --name <pin name> [--dry-run] [--verify-count N] [--expect <regex>]
 *
 *   --dir           flat directory to pin (1.json … 10000.json, or the images)
 *   --name          Pinata pin name; also the folder name in the upload paths
 *   --dry-run       compute and print the local directory CID, no network
 *   --verify-count  after pinning, byte-verify N random files (default 20)
 *                   through public gateways, always force-including the
 *                   lexicographic first/last AND numeric first/last files
 *                   (Gate E mandates tokens 1 and 10000 in every sample)
 *   --expect        regex every walked filename must FULLY match, else HOLD
 *                   (e.g. --expect '\d+\.json' for metadata trees)
 *
 * Exit codes: 0 pinned and fully byte-verified; 1 failed check (CID mismatch,
 * Pinata error); 2 usage/refusal; 3 pinned and CIDs matched but gateway
 * byte-verification incomplete — Gate E NOT green yet, re-run to verify.
 *
 * How the local CID is computed: ipfs-unixfs-importer (the engine inside the
 * ipfs-only-hash devDependency) with the kubo `ipfs add -r` defaults —
 * CIDv0, sha2-256, fixed 262144-byte chunks, balanced layout, dag-pb leaves
 * (rawLeaves false). That is what Pinata's pinFileToIPFS folder uploads
 * produce with pinataOptions cidVersion 0. SHARDING CAVEAT: the two sides do
 * NOT shard on the same trigger. ipfs-unixfs-importer HAMT-shards a directory
 * node once it has over 1000 ENTRIES; kubo (and Pinata behind it) shard when
 * the ESTIMATED DIRECTORY-BLOCK SIZE passes ~256 KiB. So a 1001–4000
 * small-file tree shards locally but not remotely — a GUARANTEED loud CID
 * mismatch (safe but blocking). At 10,000 files both sides should shard and
 * agree, but that parity is network-unproven: do the one-time throwaway
 * 10,000-file parity pin before reveal week.
 *
 * HARD RULE (MP-REVEAL.md law 4): no CID goes onchain unless it was computed
 * locally first. Pinata has wrapped uploads in directories before (see
 * supersededWrapperCIDs in deployments/merged-public.robinhood.json). The
 * assertion makes any layout drift — wrapping, chunker, rawLeaves, CID
 * version, sharding — loud instead of silent.
 *
 * This script records nothing in deployments/merged-public.robinhood.json.
 * Recording reveal CIDs there happens at reveal, with human eyes on it.
 * Needs PINATA_JWT in .env (not for --dry-run). Never prints the token.
 */
import { readFileSync, readdirSync, createReadStream, statSync, existsSync } from "node:fs";
import { openAsBlob } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { importer } = createRequire(import.meta.url)("ipfs-unixfs-importer");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
let dir, name, expect, dryRun = false, verifyCount = 20;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const eq = a.indexOf("=");
  const key = eq > 0 ? a.slice(0, eq) : a;
  const val = () => (eq > 0 ? a.slice(eq + 1) : args[++i]);
  if (key === "--dir") dir = val();
  else if (key === "--name") name = val();
  else if (key === "--dry-run") dryRun = true;
  else if (key === "--verify-count") verifyCount = Number(val());
  else if (key === "--expect") expect = val();
  else {
    console.error(`HOLD: unknown argument '${a}'.`);
    usage();
  }
}
function usage() {
  console.error("usage: node scripts/pin-mp-reveal.mjs --dir <path> --name <pin name> [--dry-run] [--verify-count N] [--expect <regex>]");
  process.exit(2);
}
if (!dir || !name) usage();
if (/[/\\]/.test(name) || name.trim() === "") {
  console.error(`HOLD: --name '${name}' must be a plain folder name (no slashes) — it becomes the upload path prefix.`);
  process.exit(2);
}
if (!Number.isInteger(verifyCount) || verifyCount < 1) {
  console.error(`HOLD: --verify-count must be a positive integer, got '${verifyCount}'.`);
  process.exit(2);
}
let expectRe = null;
if (expect !== undefined) {
  if (!expect) {
    console.error("HOLD: --expect needs a regex (e.g. --expect '\\d+\\.json' for metadata trees).");
    process.exit(2);
  }
  try {
    expectRe = new RegExp(`^(?:${expect})$`); // full-filename match
  } catch (e) {
    console.error(`HOLD: --expect '${expect}' is not a valid regex: ${e.message}`);
    process.exit(2);
  }
}
dir = resolve(dir);

// ------------------------------------------------------------------- walk
// Flat trees only, sorted, stable. A stray junk file would change the
// directory CID and get published forever — refuse loudly, never silently.
const JUNK = new Set(["Thumbs.db", "desktop.ini"]);
const entries = readdirSync(dir, { withFileTypes: true });
const files = [];
for (const e of entries) {
  if (e.isDirectory()) {
    console.error(`HOLD: ${dir} contains a subdirectory '${e.name}' — reveal trees are flat (1.json … 10000.json). Not pinning.`);
    process.exit(2);
  }
  if (!e.isFile()) {
    console.error(`HOLD: '${e.name}' in ${dir} is not a regular file. Not pinning.`);
    process.exit(2);
  }
  if (e.name.startsWith(".") || JUNK.has(e.name)) {
    console.error(`HOLD: junk file '${e.name}' in ${dir} would be pinned into the tree forever. Clean the directory, then re-run.`);
    process.exit(2);
  }
  files.push(e.name);
}
if (files.length === 0) {
  console.error(`HOLD: ${dir} is empty — nothing to pin.`);
  process.exit(2);
}
files.sort();

if (expectRe) {
  const offender = files.find((f) => !expectRe.test(f));
  if (offender !== undefined) {
    console.error(`HOLD: '${offender}' does not fully match --expect /${expect}/ — a stray file would be pinned into the tree forever. Clean the directory or fix the pattern, then re-run.`);
    process.exit(2);
  }
}

let totalBytes = 0;
const fileSize = new Map();
for (const f of files) {
  const bytes = statSync(join(dir, f)).size; // stat, never read — size only
  fileSize.set(f, bytes);
  totalBytes += bytes;
}
console.log(`tree: ${files.length} files, ${totalBytes} bytes, first '${files[0]}', last '${files[files.length - 1]}'`);
if (files.length > 1000) {
  console.log(
    `note: ${files.length} entries > 1000 — the LOCAL importer (ipfs-unixfs-importer) HAMT-shards\n` +
      "the directory node above 1000 ENTRIES, but kubo/Pinata shard on ~256 KiB estimated\n" +
      "directory-block size instead. A 1001-4000 small-file tree is therefore a GUARANTEED\n" +
      "loud CID mismatch (safe but blocking). At 10,000 files both sides should shard and\n" +
      "agree, but that parity is network-unproven — run the one-time throwaway 10,000-file\n" +
      "parity pin before reveal week. The CID assert below is the gate either way."
  );
}

// ---------------------------------------------------- local CID, FIRST, always
// A block API that refuses to store anything: with onlyHash the importer
// never calls it, and if an option change ever made it try, that is a bug
// we want thrown, not silently absorbed.
const noStore = {
  get: async (cid) => { throw new Error(`unexpected block get for ${cid}`); },
  put: async () => { throw new Error("unexpected block put — onlyHash must never store"); },
};

async function * fileContent(path) {
  for await (const chunk of createReadStream(path)) yield chunk;
}

async function localDirCID() {
  function * source() {
    for (const f of files) yield { path: `${name}/${f}`, content: fileContent(join(dir, f)) };
  }
  let last, hashed = 0;
  for await (const entry of importer(source(), noStore, {
    onlyHash: true,
    cidVersion: 0,
    rawLeaves: false,
    chunker: "fixed",
    maxChunkSize: 262144,
    strategy: "balanced",
  })) {
    if (entry.unixfs && !entry.unixfs.isDirectory() && ++hashed % 1000 === 0) {
      console.log(`  hashed ${hashed}/${files.length} files`);
    }
    last = entry;
  }
  if (!last || last.path !== name || !(last.unixfs && last.unixfs.isDirectory())) {
    throw new Error(`HOLD: importer did not end on the '${name}' directory node (got '${last && last.path}') — refusing to trust this CID.`);
  }
  return last.cid.toString();
}

const localCID = await localDirCID();
console.log(`local directory CID (computed first, CIDv0): ${localCID}`);

if (dryRun) {
  console.log(`--dry-run: no network. Pin later must return exactly ${localCID}.`);
  process.exit(0);
}

// -------------------------------------------------------------------- .env
if (!existsSync(join(root, ".env"))) {
  console.error("HOLD: no .env at the repo root — non-dry-run needs PINATA_JWT from .env. Create it (or run with --dry-run, which needs no network).");
  process.exit(2);
}
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

// --------------------------------------------------------------------- pin
// One multipart request, every file at filepath <name>/<filename>. Blobs are
// file-backed (openAsBlob) so a multi-GB images tree streams instead of
// loading into memory.
console.log(`uploading ${files.length} files to Pinata as folder '${name}' ...`);
const form = new FormData();
for (const f of files) {
  form.append("file", await openAsBlob(join(dir, f)), `${name}/${f}`);
}
form.append("pinataMetadata", JSON.stringify({ name }));
form.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));

const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST",
  headers: { Authorization: `Bearer ${JWT}` },
  body: form,
});
if (!res.ok) {
  console.error(`HOLD: Pinata ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { IpfsHash } = await res.json();

if (IpfsHash !== localCID) {
  console.error(`
HOLD HOLD HOLD — CID MISMATCH. Do NOT put the returned CID onchain.
  local  (computed first) : ${localCID}
  Pinata (returned)       : ${IpfsHash}
The pinned tree is NOT the tree we hashed. Possible causes: an extra wrapper
directory (the supersededWrapperCIDs failure), a different chunker or chunk
size, rawLeaves, CID version, or a sharding-threshold difference on a
directory this large. The mismatched pin is left on Pinata for forensics —
unpin it (DELETE /pinning/unpin/${IpfsHash}) once diagnosed.
Nothing goes onchain until local and returned CIDs are byte-identical.`);
  process.exit(1);
}
console.log(`pinned '${name}': ${IpfsHash} (matches local CID)`);

// ------------------------------------------------------------------ verify
// Trust nothing but the bytes: a gateway 200 can be a folder listing or an
// interstitial page. Verified means the gateway returned the exact file.
const GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];

// Gate E (MP-REVEAL.md Phase E) mandates tokens 1 and 10000 in every sample,
// and lexicographic first/last are NOT numeric first/last on a 10,000-file
// tree (sorted, that is '1.json' and '9999.json' — '10000.json' sorts second).
// Force-include BOTH pairs: lexicographic extremes and numeric extremes
// (leading integer parsed from the filename; when none parse, the
// lexicographic extremes suffice).
const forced = new Set([files[0], files[files.length - 1]]);
let numMin = null, numMax = null;
for (const f of files) {
  const m = /^(\d+)/.exec(f);
  if (!m) continue;
  const n = BigInt(m[1]);
  if (numMin === null || n < numMin.n) numMin = { n, f };
  if (numMax === null || n > numMax.n) numMax = { n, f };
}
if (numMin) forced.add(numMin.f);
if (numMax) forced.add(numMax.f);

const sample = new Set(forced);
const pool = files.filter((f) => !forced.has(f));
while (sample.size < Math.min(verifyCount, files.length) && pool.length > 0) {
  sample.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
}

async function verifyFile(f) {
  const want = readFileSync(join(dir, f));
  let hits = 0;
  for (const gw of GATEWAYS) {
    const url = `${gw}${localCID}/${f}`;
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const got = Buffer.from(await res.arrayBuffer());
      if (got.equals(want)) hits++;
      else console.log(`NOTE: ${url} answered but with different bytes (listing/interstitial) — trying next gateway.`);
    } catch {}
  }
  console.log(`${hits >= 2 ? "verified" : "NOT YET"}: ${f} byte-exact on ${hits}/${GATEWAYS.length} gateways`);
  return hits >= 2;
}

console.log(`byte-verifying ${sample.size} files (force-included: ${[...forced].sort().map((f) => `'${f}'`).join(", ")}) on ${GATEWAYS.length} gateways ...`);
let verified = 0;
const sorted = [...sample].sort();
for (const f of sorted) {
  if (await verifyFile(f)) verified++;
}
const fullyVerified = verified === sorted.length;

// ----------------------------------------------------------------- summary
console.log(`
SUMMARY — '${name}'
  directory CID  : ${IpfsHash}
  local == pinned: yes (asserted)
  files          : ${files.length} (${totalBytes} bytes), '${files[0]}' … '${files[files.length - 1]}'
  gateway check  : ${verified}/${sorted.length} sampled files byte-exact on >=2 of ${GATEWAYS.length} gateways`);

if (!fullyVerified) {
  console.error(`
HOLD: Gate E is NOT green yet. The pin succeeded and the local and returned
CIDs matched, but ${sorted.length - verified}/${sorted.length} sampled files are not yet byte-verified on >=2
public gateways. Gateways usually catch up; re-running this tool later on the
IDENTICAL bytes is the safe verify pass (same CID, idempotent pin). Do NOT
call reveal() and do NOT record this CID until a run verifies clean.
Exiting 3: pinned + CID-matched, gateway byte-verification incomplete.`);
  process.exit(3);
}

console.log(`
Gate E gateway sample fully byte-verified.

REVEAL-DAY USE (metadata tree only — operator wallet, Blockscout Write tab):
  reveal("ipfs://${IpfsHash}/")      <- trailing slash is load-bearing (law 3)
  tokenURI(N) then resolves ipfs://${IpfsHash}/N.json
For the images tree, each metadata 'image' field points at ipfs://${IpfsHash}/<file>.
CIDs are recorded in deployments/merged-public.robinhood.json at reveal, with
human eyes on it — this script never writes there. Before reveal(): redundant
pin on a second provider and keep the CAR (MP-REVEAL.md Phase E).`);
process.exit(0);
