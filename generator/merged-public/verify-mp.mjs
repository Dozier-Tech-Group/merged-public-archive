#!/usr/bin/env node
/**
 * verify-mp.mjs — the PUBLIC Merged Public verifier (MP-REVEAL.md Phase A).
 *
 * This tool is public from day one because it holds no secrets: it checks
 * PROPERTIES of a claimed assignment against what the chain already commits
 * to. It contains NO generation logic — no PRNG, no draw order, no reroll
 * mechanics, no shuffle. If a change to this file would let someone
 * precompute the draw, the change is wrong.
 *
 * Usage:
 *   node generator/merged-public/verify-mp.mjs
 *       Recompute keccak256 of the raw bytes of provenance.json and compare
 *       against the recorded hash in deployments/merged-public.robinhood.json.
 *
 *   node generator/merged-public/verify-mp.mjs --rpc [url]
 *       Same, plus read provenanceHash() from the live contract
 *       0x5D000b230653E416FF41451525b144a6C2Ad7178 on Robinhood Chain 4663
 *       (default url https://rpc.mainnet.chain.robinhood.com) and compare
 *       all three.
 *
 *   node generator/merged-public/verify-mp.mjs --assignment <file>
 *       Validate a claimed assignments.json: canonical bytes, 10,000 tokens
 *       in order, the ten committed legendaries, trait membership against the
 *       committed weights, rules R-02..R-06, the exact-duplicate ban and the
 *       minimum 2-trait distance. Prints keccak256 + sha256 of the raw bytes
 *       and an informational trait-distribution table.
 *
 *   node generator/merged-public/verify-mp.mjs --commitment --assignment <file> \
 *       --salt <0xhex64> [--manifest <file>]
 *       Recompute keccak256(rawBytes(assignment) || salt) and compare against
 *       the legendary-hunt commitment in the Season Zero manifest (default
 *       game/season-zero/manifest.json). Also prints keccak256 of the
 *       manifest's raw bytes — the value the treasury echo transaction on
 *       4663 must carry (MP-GAME.md §2).
 *
 * Exit codes: 0 pass, 1 fail, 2 usage error.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, concat, getBytes, JsonRpcProvider, Contract } from "ethers";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "..", "..");
const PROVENANCE_PATH = resolve(here, "provenance.json");
const RECORD_PATH = resolve(root, "deployments", "merged-public.robinhood.json");
const DEFAULT_MANIFEST = resolve(root, "game", "season-zero", "manifest.json");
const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";

// Fixed layer order for keys and reporting only — this is the sorted key
// order of the canonical JSON, not a draw order.
const LAYER_KEYS = [
  "accessory", "background", "base", "clothing", "expression",
  "eyewear", "hair", "headwear", "special",
];

// Rule predicates as written in the committed rules.json prose (R-01 is an
// asset swap with no metadata footprint, so it has nothing to verify here).
// Each returns true on a VIOLATION.
const RULE_PREDICATES = [
  ["R-02", (l) =>
    (l.eyewear === "Safety Goggles" || l.eyewear === "Welding Goggles") &&
    (l.headwear === "Wide-Brim Field Hat" || l.headwear === "Green Eyeshade")],
  ["R-03", (l) =>
    l.base === "Cybernetic Chassis" &&
    (l.special === "Cybernetic Eye" || l.special === "Circuit Tattoo")],
  ["R-04", (l) =>
    (l.base === "Bronze Cast" || l.base === "Marble Cast") &&
    (l.special === "Cybernetic Eye" || l.special === "Circuit Tattoo" || l.special === "Static Glitch")],
  ["R-05", (l) => l.headwear === "Laurel Wreath" && l.accessory === "Pencil Behind Ear"],
  ["R-06", (l) =>
    l.background === "Redacted" &&
    (l.expression === "Grinning" || l.expression === "Eureka")],
];
// Trait names the predicates lean on, so a typo here HOLDs instead of
// silently checking nothing.
const RULE_TRAITS = {
  eyewear: ["Safety Goggles", "Welding Goggles"],
  headwear: ["Wide-Brim Field Hat", "Green Eyeshade", "Laurel Wreath"],
  base: ["Cybernetic Chassis", "Bronze Cast", "Marble Cast"],
  special: ["Cybernetic Eye", "Circuit Tattoo", "Static Glitch"],
  accessory: ["Pencil Behind Ear"],
  background: ["Redacted"],
  expression: ["Grinning", "Eureka"],
};

// Copied verbatim from build-provenance.mjs — the shared canonical form.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function usage(msg) {
  if (msg) console.error(`HOLD: ${msg}`);
  console.error("Usage: verify-mp.mjs [--rpc [url]]");
  console.error("       verify-mp.mjs --assignment <file>");
  console.error("       verify-mp.mjs --commitment --assignment <file> --salt <0xhex64> [--manifest <file>]");
  process.exit(2);
}

// --- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2);
let assignmentFile = null, manifestFile = DEFAULT_MANIFEST, salt = null;
let commitmentMode = false, rpcUrl = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") usage();
  else if (a === "--assignment") { assignmentFile = args[++i] ?? usage("--assignment needs a file"); }
  else if (a === "--manifest") { manifestFile = args[++i] ?? usage("--manifest needs a file"); }
  else if (a === "--salt") { salt = args[++i] ?? usage("--salt needs a value"); }
  else if (a === "--commitment") { commitmentMode = true; }
  else if (a === "--rpc") {
    rpcUrl = (args[i + 1] && !args[i + 1].startsWith("--")) ? args[++i] : DEFAULT_RPC;
  }
  else usage(`unknown argument "${a}"`);
}
if (commitmentMode && (!assignmentFile || !salt)) usage("--commitment needs --assignment <file> and --salt <0xhex64>");
if (salt && !commitmentMode) usage("--salt only makes sense with --commitment");
if (salt && !/^0x[0-9a-fA-F]{64}$/.test(salt)) usage("--salt must be 0x + 64 hex chars (32 bytes)");

// --- Committed ground truth (hash-committed source, never a hardcoded copy) --
const provRaw = readFileSync(PROVENANCE_PATH);
const provHash = keccak256(provRaw);
const prov = JSON.parse(provRaw.toString("utf8"));
if (!Array.isArray(prov.legendaries) || prov.legendaries.length !== prov.supply.legendaries) {
  console.error("HOLD: provenance.json legendary list disagrees with its own supply block. Do not proceed.");
  process.exit(1);
}
if (!Array.isArray(prov.rules) || prov.rules.length !== 6 || prov.rules.some((r, i) => r.id !== `R-0${i + 1}`)) {
  console.error("HOLD: provenance.json does not carry rules R-01..R-06 in order. Do not proceed.");
  process.exit(1);
}
const traitSets = {};
for (const [layer, traits] of Object.entries(prov.weights)) traitSets[layer] = new Set(traits.map((t) => t.trait));
for (const [layer, names] of Object.entries(RULE_TRAITS)) {
  for (const name of names) {
    if (!traitSets[layer].has(name)) {
      console.error(`HOLD: rule predicate expects "${name}" in layer "${layer}" but the committed weights do not list it. This verifier is out of sync with provenance.json — fix the verifier.`);
      process.exit(1);
    }
  }
}

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};

// =============================================================================
// Mode 3: --commitment — check the Legendary Hunt commitment (MP-GAME.md §4)
// =============================================================================
if (commitmentMode) {
  if (!existsSync(assignmentFile)) usage(`assignment file not found: ${assignmentFile}`);
  if (!existsSync(manifestFile)) usage(`manifest file not found: ${manifestFile}`);
  const assignmentRaw = readFileSync(assignmentFile);
  const manifestRaw = readFileSync(manifestFile);
  const computed = keccak256(concat([assignmentRaw, getBytes(salt)]));

  console.log("assignment bytes  :", assignmentRaw.length);
  console.log("computed          :", computed, " = keccak256(assignment bytes || salt)");
  console.log("manifest keccak256:", keccak256(manifestRaw), " <- the treasury echo transaction on 4663 must carry exactly this");

  // Pinned manifest schema (MP-GAME.md promises puzzles carrying an id and a
  // commitment): manifest.puzzles must be an array containing exactly one
  // entry with id === "legendary-hunt", and its commitment field must be
  // 0x + 64 hex. No fuzzy scanning — an off-schema manifest is a HOLD, not a
  // guess.
  let manifestDoc;
  try { manifestDoc = JSON.parse(manifestRaw.toString("utf8")); }
  catch (e) {
    console.error(`HOLD: ${manifestFile} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(manifestDoc.puzzles)) {
    console.error(`HOLD: ${manifestFile} has no top-level "puzzles" array — not a Season Zero manifest this verifier accepts.`);
    process.exit(1);
  }
  const hunts = manifestDoc.puzzles.filter((p) => p && typeof p === "object" && !Array.isArray(p) && p.id === "legendary-hunt");
  if (hunts.length !== 1) {
    console.error(`HOLD: expected exactly one puzzles[] entry with id "legendary-hunt" in ${manifestFile}, found ${hunts.length}. Cannot verify against an ambiguous manifest.`);
    process.exit(1);
  }
  const committed = hunts[0].commitment;
  if (typeof committed !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(committed)) {
    console.error(`HOLD: the legendary-hunt puzzle's "commitment" field in ${manifestFile} is not a 0x + 64-hex string.`);
    process.exit(1);
  }
  console.log("manifest carries  :", committed, ' (puzzles[id="legendary-hunt"].commitment)');
  const ok = check(computed.toLowerCase() === committed.toLowerCase(),
    "keccak256(assignment || salt) matches the Season Zero manifest commitment");
  if (!ok) {
    console.error("HOLD: the opened assignment + salt do NOT reproduce the committed hash. Per MP-GAME.md §4 a reveal that fails its commitment voids the Hunt on the record.");
    process.exit(1);
  }
  console.log("The commitment opens clean. The assignment was fixed before the first clue dropped.");
  process.exit(0);
}

// =============================================================================
// Mode 2: --assignment — property-check a claimed assignment set
// =============================================================================
if (assignmentFile) {
  if (!existsSync(assignmentFile)) usage(`assignment file not found: ${assignmentFile}`);
  const raw = readFileSync(assignmentFile);
  console.log("file      :", assignmentFile);
  console.log("bytes     :", raw.length);
  console.log("keccak256 :", keccak256(raw));
  console.log("sha256    : 0x" + createHash("sha256").update(raw).digest("hex"));
  console.log("");

  let doc;
  try { doc = JSON.parse(raw.toString("utf8")); }
  catch (e) {
    console.error(`FAIL: (a) file is not valid JSON — ${e.message}`);
    console.error("HOLD: nothing else can be checked. This is not a canonical assignment file.");
    process.exit(1);
  }

  // (a) canonical bytes: re-serialize and demand byte identity. Anything else
  // (pretty-printing, key order, trailing newline, escaping) changes the hash
  // the commitment was computed over.
  check(JSON.stringify(sortKeys(doc)) === raw.toString("utf8"),
    "(a) canonical bytes — JSON.stringify(sortKeys(doc)) reproduces the file byte-for-byte");

  // Top level must carry EXACTLY the five known keys — an extra key would be
  // an unaudited side channel riding inside the committed bytes.
  const WANT_TOP = ["collection", "entities", "provenanceHash", "seed", "supply"];
  const topKeys = Object.keys(doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {}).sort();
  const extraTop = topKeys.filter((k) => !WANT_TOP.includes(k));
  const missingTop = WANT_TOP.filter((k) => !topKeys.includes(k));
  check(extraTop.length === 0 && missingTop.length === 0,
    "top level has exactly the five known keys (collection, seed, provenanceHash, supply, entities)",
    extraTop.length || missingTop.length
      ? `${extraTop.length ? `extra: [${extraTop.join(", ")}]` : ""}${extraTop.length && missingTop.length ? "; " : ""}${missingTop.length ? `missing: [${missingTop.join(", ")}]` : ""}`
      : "");

  // Header: the assignment must bind itself to the committed system.
  check(doc.collection === prov.collection, "header collection", `"${doc.collection}"`);
  check(doc.seed === prov.seed, "header seed", `${doc.seed} vs committed ${prov.seed}`);
  check(typeof doc.provenanceHash === "string" && doc.provenanceHash.toLowerCase() === provHash.toLowerCase(),
    "header provenanceHash matches keccak256(provenance.json)", provHash);
  check(doc.supply && doc.supply.total === prov.supply.total &&
    doc.supply.generated === prov.supply.generated && doc.supply.legendaries === prov.supply.legendaries,
    "header supply matches committed supply", JSON.stringify(doc.supply));

  const entities = Array.isArray(doc.entities) ? doc.entities : [];

  // (b) exactly 10,000 entities, token IDs 1..10000 in array order.
  check(entities.length === prov.supply.total, "(b) exactly 10,000 entities", `found ${entities.length}`);
  let tokenOrderBad = null;
  for (let i = 0; i < entities.length; i++) {
    const t = entities[i] && entities[i].token;
    if (!Number.isInteger(t) || t !== i + 1) { tokenOrderBad = `entities[${i}].token = ${JSON.stringify(t)}, expected ${i + 1}`; break; }
  }
  check(tokenOrderBad === null, "(b) token IDs are exactly 1..10000 in array order", tokenOrderBad ?? "");

  // Split entities by shape, validating the shape strictly.
  const shapeErrors = [];
  const legendaries = [];
  const generated = [];
  for (const e of entities) {
    const keys = Object.keys(e ?? {}).sort().join(",");
    if (keys === "legendary,token") {
      if (typeof e.legendary !== "string") shapeErrors.push(`token ${e.token}: legendary name is not a string`);
      else legendaries.push(e);
    } else if (keys === "layers,token") {
      const lk = Object.keys(e.layers ?? {}).sort();
      if (lk.join(",") !== LAYER_KEYS.join(",")) {
        shapeErrors.push(`token ${e.token}: layers keys are [${lk.join(", ")}], expected the 9 committed layers`);
      } else if (LAYER_KEYS.some((k) => typeof e.layers[k] !== "string")) {
        shapeErrors.push(`token ${e.token}: non-string trait value`);
      } else generated.push(e);
    } else {
      shapeErrors.push(`token ${e?.token}: unexpected keys {${keys}} — an entity is {token, layers} or {token, legendary}`);
    }
  }
  check(shapeErrors.length === 0, "entity shapes — {token, layers} with all 9 keys, or {token, legendary}",
    shapeErrors.length ? `${shapeErrors.length} bad (first: ${shapeErrors[0]})` : "");

  // (c) exactly ten legendaries bearing the ten committed names, once each.
  const wantNames = [...prov.legendaries].sort();
  const gotNames = legendaries.map((e) => e.legendary).sort();
  check(legendaries.length === prov.supply.legendaries, "(c) exactly 10 legendary entities", `found ${legendaries.length}`);
  check(JSON.stringify(gotNames) === JSON.stringify(wantNames),
    "(c) legendary names are exactly the ten committed names, each once",
    JSON.stringify(gotNames) === JSON.stringify(wantNames) ? "" : `got [${gotNames.join(", ")}]`);

  // (d) every trait value exists in that layer of the committed weights.
  const unknownTraits = [];
  for (const e of generated) {
    for (const k of LAYER_KEYS) {
      if (!traitSets[k].has(e.layers[k])) unknownTraits.push(`token ${e.token}: ${k} = "${e.layers[k]}" is not in the committed weights`);
    }
  }
  check(unknownTraits.length === 0, "(d) every trait value exists in the committed weights",
    unknownTraits.length ? `${unknownTraits.length} unknown (first: ${unknownTraits[0]})` : "");

  // (e) rules R-02..R-06 as committed in rules.json.
  const ruleViolations = [];
  for (const e of generated) {
    for (const [id, violates] of RULE_PREDICATES) {
      if (violates(e.layers)) ruleViolations.push(`token ${e.token}: violates ${id} (${JSON.stringify(e.layers)})`);
    }
  }
  check(ruleViolations.length === 0, "(e) zero violations of rules R-02..R-06",
    ruleViolations.length ? `${ruleViolations.length} violation(s) (first: ${ruleViolations[0]})` : "");

  // (f) exact-duplicate ban + minimum 2-trait distance, in O(n) via the
  // 9-wildcard-map technique: two entities at distance exactly 1 collide in
  // the map where their single differing layer is wildcarded; duplicates
  // collide on the full key. Never O(n^2) pairwise. Keys join with U+0000 and
  // wildcard with U+0001 - neither can appear in a trait name, so joined
  // keys stay unambiguous even for traits containing spaces.
  const dupViolations = [];
  const distViolations = [];
  const fullMap = new Map();
  const wildMaps = LAYER_KEYS.map(() => new Map());
  for (const e of generated) {
    const vals = LAYER_KEYS.map((k) => e.layers[k]);
    const fullKey = vals.join("\u0000");
    const dupOf = fullMap.get(fullKey);
    if (dupOf !== undefined) {
      dupViolations.push(`tokens ${dupOf} and ${e.token} are identical in all 9 layers`);
      continue; // already indexed once; re-indexing would only re-report it
    }
    fullMap.set(fullKey, e.token);
    for (let i = 0; i < LAYER_KEYS.length; i++) {
      const wildKey = vals.map((v, j) => (j === i ? "\u0001" : v)).join("\u0000");
      const hit = wildMaps[i].get(wildKey);
      if (hit === undefined) wildMaps[i].set(wildKey, { fullKey, token: e.token });
      else if (hit.fullKey !== fullKey) {
        distViolations.push(`tokens ${hit.token} and ${e.token} differ only in "${LAYER_KEYS[i]}" (distance 1, minimum is 2)`);
      }
    }
  }
  check(dupViolations.length === 0, "(f) exact-duplicate ban",
    dupViolations.length ? `${dupViolations.length} pair(s) (first: ${dupViolations[0]})` : "");
  check(distViolations.length === 0, "(f) minimum 2-trait distance",
    distViolations.length ? `${distViolations.length} pair(s) (first: ${distViolations[0]})` : "");

  // (g) informational only — never failing: distribution vs committed weights.
  console.log("\n--- (g) trait distribution vs committed weights (informational) ---");
  const denom = generated.length || 1;
  for (const [layer, traits] of Object.entries(prov.weights)) {
    const counts = new Map(traits.map((t) => [t.trait, 0]));
    for (const e of generated) {
      if (counts.has(e.layers[layer])) counts.set(e.layers[layer], counts.get(e.layers[layer]) + 1);
    }
    console.log(`${layer}:`);
    for (const t of traits) {
      const n = counts.get(t.trait);
      const pct = ((n / denom) * 100).toFixed(2).padStart(6);
      console.log(`  ${t.trait.padEnd(26)} ${String(n).padStart(5)}  ${pct}%  (committed weight ${t.weight}%)`);
    }
  }
  const redacted = generated.filter((e) => e.layers.background === "Redacted").length;
  console.log(`\nRedacted count: ${redacted} generated entities carry the Redacted background (committed weight 0.75% of ${prov.supply.generated} ~= ${Math.round(prov.supply.generated * 0.0075)} expected; the exact count is a committed-draw outcome, not a check).`);

  if (failures > 0) {
    console.error(`\nHOLD: ${failures} check(s) failed. This assignment does NOT satisfy the committed system — do not accept it, do not reveal against it.`);
    process.exit(1);
  }
  console.log("\nAll checks (a)-(f) pass. This file is a valid assignment under the committed system. (Whether it is THE committed assignment is what the Season Zero commitment proves — see --commitment.)");
  process.exit(0);
}

// =============================================================================
// Mode 1 (default): provenance hash — repo record, local bytes, live chain
// =============================================================================
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
console.log("provenance file :", PROVENANCE_PATH);
console.log("local keccak256 :", provHash);
console.log("recorded hash   :", record.provenanceHash, ` (${RECORD_PATH})`);
check(provHash.toLowerCase() === record.provenanceHash.toLowerCase(),
  "local keccak256(provenance.json) matches deployments record");

if (rpcUrl) {
  console.log("rpc             :", rpcUrl);
  console.log("contract        :", record.address, ` (chain ${record.chainId})`);
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const contract = new Contract(record.address, ["function provenanceHash() view returns (bytes32)"], provider);
  let onchain;
  try { onchain = await contract.provenanceHash(); }
  catch (e) {
    console.error(`FAIL: could not read provenanceHash() from ${record.address} via ${rpcUrl} — ${e.message}`);
    process.exit(1);
  }
  console.log("onchain hash    :", onchain);
  check(provHash.toLowerCase() === onchain.toLowerCase(), "local keccak256 matches onchain provenanceHash()");
  check(record.provenanceHash.toLowerCase() === onchain.toLowerCase(), "deployments record matches onchain provenanceHash()");
}

if (failures > 0) {
  console.error("\nHOLD: the provenance commitment does NOT verify. Per MP-REVEAL.md law 1 this is a stop-the-line event — provenance.json must never drift from the immutable onchain hash.");
  process.exit(1);
}
console.log("\nProvenance commitment verifies clean.");
process.exit(0);
