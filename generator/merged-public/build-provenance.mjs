#!/usr/bin/env node
/**
 * Rebuild generator/merged-public/provenance.json deterministically from
 * weights.json + rules.json and print its keccak256.
 *
 * Canonical form: single-line JSON, recursively sorted keys, no extra
 * whitespace, NO trailing newline. The deploy script (deploy-merged-public.js)
 * hashes the RAW BYTES of provenance.json into the contract's immutable
 * provenanceHash, so this file must reproduce byte-for-byte — never reformat
 * it after deploy.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toUtf8Bytes } from "ethers";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const WEIGHTS_PATH = resolve(here, "weights.json");
const RULES_PATH = resolve(here, "rules.json");
const PROVENANCE_PATH = resolve(here, "provenance.json");

// The ten hand-made 1/1s, by name only. Their token IDs are assigned after the
// generated set is shuffled and stay sealed until reveal — deliberately absent.
const LEGENDARIES = [
  "The Founder",
  "The Archivist",
  "The First Graduate",
  "The Night Engineer",
  "The Cartographer",
  "The Alchemist",
  "The Broadcast",
  "The Machinist",
  "The Librarian",
  "The Signal",
];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

const weights = JSON.parse(readFileSync(WEIGHTS_PATH, "utf8"));
const rules = JSON.parse(readFileSync(RULES_PATH, "utf8"));

// --- Sanity: the published tables must be arithmetically honest -------------
const layerNames = Object.keys(weights.layers);
if (layerNames.length !== 9) {
  throw new Error(`HOLD: expected 9 layers in weights.json, found ${layerNames.length}.`);
}
for (const [layer, traits] of Object.entries(weights.layers)) {
  const sum = traits.reduce((acc, t) => acc + t.weight, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`HOLD: layer "${layer}" weights sum to ${sum}, not 100.00.`);
  }
}
if (rules.length !== 6 || rules.some((r, i) => r.id !== `R-0${i + 1}`)) {
  throw new Error("HOLD: rules.json must contain exactly R-01 through R-06, in order.");
}
if (LEGENDARIES.length !== weights.legendaries) {
  throw new Error("HOLD: legendary count disagrees between script and weights.json.");
}

// --- Canonical provenance ---------------------------------------------------
const provenance = sortKeys({
  collection: "Merged Public",
  seed: weights.seed,
  supply: { total: 10000, generated: weights.generated, legendaries: weights.legendaries },
  weights: weights.layers,
  rules,
  legendaries: LEGENDARIES,
  // The generation engine's two uniqueness guarantees, committed with the
  // weights so they are auditable claims rather than marketing copy.
  constraints: { exactDuplicateBan: true, minTraitDistance: 2 },
});

const canonical = JSON.stringify(provenance); // single line, sorted keys, no whitespace
const hash = keccak256(toUtf8Bytes(canonical));

if (existsSync(PROVENANCE_PATH)) {
  const prior = readFileSync(PROVENANCE_PATH, "utf8");
  if (prior !== canonical) {
    console.log("WARNING: provenance.json changed. If the hash is already onchain, this file is WRONG — revert it.");
  }
}
writeFileSync(PROVENANCE_PATH, canonical); // no trailing newline: file bytes ARE the hashed message

console.log("Seed      :", weights.seed);
console.log("Layers    :", layerNames.length, `(${layerNames.sort().join(", ")})`);
console.log("Rules     :", rules.length);
console.log("Legendary :", LEGENDARIES.length, "(names only; token IDs sealed until reveal)");
console.log("Bytes     :", Buffer.byteLength(canonical, "utf8"));
console.log("keccak256 :", hash);
console.log("This hash goes into the MergedPublic constructor at deploy (provenanceHash).");
