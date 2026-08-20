#!/usr/bin/env node
/**
 * link-mp.mjs — bind a Merged Public identity to a GitHub account for the
 * Merged Public fleet.
 *
 * Two modes, and only one of them may ever touch a key.
 *
 *   node scripts/link-mp.mjs sign --github <username> [--tokens 1,2,3]
 *     Holder mode, offline. Loads PRIVATE_KEY from your LOCAL .env (which is
 *     gitignored) and signs the canonical message below. The signature is the
 *     whole proof: anyone can recover the signing address from it, and nobody
 *     can produce it without the key. The key itself never leaves this machine
 *     — it is never printed, never written to a file, never sent anywhere, and
 *     never belongs in CI. This mode makes no network calls at all.
 *     The registry block is the ONLY thing written to stdout, so
 *     `node scripts/link-mp.mjs sign --github you > entry.json` produces a
 *     submittable file; everything else goes to stderr.
 *
 *   node scripts/link-mp.mjs verify --file <entry.json> [--write]
 *     Public mode. Needs NO key and never reads .env. Recovers the signer from
 *     the signature (EIP-191 personal_sign), then checks against Merged Public
 *     on chain 4663 that the wallet holds an identity (balanceOf > 0) and that
 *     every claimed tokenId is owned by that wallet. With --write it appends
 *     the entry to agents/registry.json. Run it yourself — the point of this
 *     mode is that you do not have to take a reviewer's word for anything.
 *
 * Registering proves who you are. It is not payment and not a queue position:
 * Merged Credits settle only when work merges — payment for verified work,
 * never for holding. Robinhood has not endorsed, reviewed, or partnered with
 * this project.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, JsonRpcProvider, Contract, verifyMessage, getAddress } from "ethers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = join(ROOT, "agents", "registry.json");
const MP_RECORD_PATH = join(ROOT, "deployments", "merged-public.robinhood.json");
const BOARD_RECORD_PATH = join(ROOT, "deployments", "mp-board.robinhood.json");

// Merged Public on Robinhood Chain. Pinned here as a TRIPWIRE, not as a source
// of truth: the address is read from the deployments record and must match
// this constant, so a rewritten record fails loudly instead of pointing this
// tool at some other contract.
const MP_ADDRESS = "0x5D000b230653E416FF41451525b144a6C2Ad7178";
const CHAIN_ID = 4663n;
const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const MP_SUPPLY = 10000;

const MP_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
];

// GitHub's own rule: alphanumerics and single interior hyphens, 39 max. The
// username is signed into the message and lands in a public JSON file that CI
// reads, so anything outside this shape is refused rather than escaped.
const GITHUB_RE = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;

const ENTRY_KEYS = ["wallet", "github", "tokenIds", "signature"];
const ENTRY_OPTIONAL_KEYS = ["linkedAt"];

/**
 * The canonical link message, v1. Both placeholders are substituted verbatim;
 * the string is single-line on purpose so a signed message can never carry a
 * second line a reviewer does not see. agents/registry.json publishes this
 * exact template, and verify refuses to run if the two ever drift apart.
 */
export const MESSAGE_TEMPLATE = "Merged Public fleet link v1: github=<github> wallet=<wallet>";

export function canonicalMessage(github, wallet) {
  return MESSAGE_TEMPLATE.replace("<github>", github).replace("<wallet>", wallet);
}

const USAGE = [
  "usage: node scripts/link-mp.mjs sign --github <username> [--tokens 1,2,3]",
  "       node scripts/link-mp.mjs verify --file <entry.json> [--write]",
];

function usage(message) {
  if (message) console.error(`HOLD: ${message}`);
  for (const line of USAGE) console.error(line);
  process.exit(2);
}

function hold(message, code = 1) {
  console.error(`HOLD: ${message}`);
  process.exit(code);
}

// Strict argv: an argument that is not an exactly recognized flag stops the
// run before any key handling or network call. A misspelled --file next to
// --write would otherwise write an unverified entry into a public registry.
function parseArgs(args, spec) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const key = flag.startsWith("--") ? flag.slice(2) : null;
    if (!key || !Object.hasOwn(spec, key)) usage(`unknown argument "${a}".`);
    if (spec[key] === "boolean") {
      if (eq > 0) usage(`--${key} takes no value.`);
      out[key] = true;
      continue;
    }
    const value = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (value === undefined || value.startsWith("--") || value === "") usage(`--${key} needs a value.`);
    if (Object.hasOwn(out, key)) usage(`--${key} given twice.`);
    out[key] = value;
  }
  return out;
}

function parseTokens(raw) {
  if (raw === undefined) return [];
  const ids = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    if (!/^\d+$/.test(part)) usage(`--tokens takes plain integers separated by commas, got "${part}".`);
    const id = Number(part);
    if (id < 1 || id > MP_SUPPLY) usage(`token id ${id} is outside 1..${MP_SUPPLY}.`);
    if (ids.includes(id)) usage(`token id ${id} listed twice.`);
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

// ---- sign -------------------------------------------------------------------

async function sign(opts) {
  if (!opts.github) usage("sign needs --github <username>.");
  if (!GITHUB_RE.test(opts.github)) {
    usage(`"${opts.github}" is not a valid GitHub username (alphanumerics and single interior hyphens, 39 max).`);
  }
  const tokenIds = parseTokens(opts.tokens);

  // dotenv is imported HERE and only here. verify must be runnable by anyone,
  // so it must never so much as open .env. quiet:true because stdout carries
  // the registry block and nothing else.
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(ROOT, ".env"), quiet: true });

  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) {
    hold(
      "PRIVATE_KEY is not set in your local .env — nothing signed.\n" +
        "  Copy .env.example to .env and put the key of the wallet that holds your\n" +
        "  Merged Public identity there. .env is gitignored; the key stays on this\n" +
        "  machine and never enters a log, a file you submit, or CI.",
      2,
    );
  }
  // Shape-check the key BEFORE ethers sees it: ethers embeds the offending
  // value in its invalid-BytesLike error message, so an uncaught
  // new Wallet(key) would print a nearly-real key to stderr.
  const key = rawKey.trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    hold(
      "PRIVATE_KEY is set but is not 64 hex characters (optionally 0x-prefixed).\n" +
        "  The value is deliberately NOT printed. Common causes: a trailing newline,\n" +
        "  a stray quote from copy-paste, or a truncated key. Nothing signed.",
      2,
    );
  }
  let wallet;
  try {
    wallet = new Wallet(key);
  } catch {
    // Never print the caught error: ethers embeds the offending value in it.
    hold(
      "PRIVATE_KEY passed the shape check but ethers refused to build a wallet\n" +
        "  from it (the value and the underlying error are deliberately NOT printed).",
      2,
    );
  }

  const address = await wallet.getAddress();
  const message = canonicalMessage(opts.github, address);
  const signature = await wallet.signMessage(message);
  const entry = { wallet: address, github: opts.github, tokenIds, signature };

  console.error("Signed locally. No network call was made and no key was written anywhere.");
  console.error(`  message : ${message}`);
  console.error(`  wallet  : ${address}`);
  // An entry with no tokenIds verifies fine — balanceOf is the gate — but the
  // fleet runner works AS a specific identity and skips an entry that names
  // none, so say that here rather than letting a holder find out later.
  console.error(
    tokenIds.length
      ? `  tokens  : ${tokenIds.join(", ")} (each is checked with ownerOf at verify time)`
      : "  tokens  : none claimed — this verifies on balanceOf alone, but list at\n" +
        "            least one with --tokens if you want an agent to run for you",
  );
  console.error("");
  console.error("Submit the block below as a pull request against agents/registry.json.");
  console.error("Anyone, including you, can check it with no key at all:");
  console.error("  node scripts/link-mp.mjs verify --file <entry.json>");
  console.error("This block is not a payment and not a queue position.");
  console.error("");
  process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
}

// ---- verify -----------------------------------------------------------------

function validateEntry(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    hold(`${label} is not a JSON object. An entry is {wallet, github, tokenIds, signature}.`);
  }
  const keys = Object.keys(entry);
  const missing = ENTRY_KEYS.filter((k) => !keys.includes(k));
  if (missing.length) hold(`${label} is missing required field(s): ${missing.join(", ")}.`);
  // Unknown fields are refused, not ignored: --write copies this object into a
  // public file that other tooling reads, and nothing unreviewed rides along.
  const extra = keys.filter((k) => !ENTRY_KEYS.includes(k) && !ENTRY_OPTIONAL_KEYS.includes(k));
  if (extra.length) {
    hold(`${label} carries unknown field(s): ${extra.join(", ")}. The registry takes exactly {wallet, github, tokenIds, signature}.`);
  }

  if (typeof entry.github !== "string" || !GITHUB_RE.test(entry.github)) {
    hold(`${label}: "github" must be a GitHub username (alphanumerics and single interior hyphens, 39 max).`);
  }
  if (typeof entry.wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(entry.wallet)) {
    hold(`${label}: "wallet" must be 0x + 40 hex characters.`);
  }
  let wallet;
  try {
    wallet = getAddress(entry.wallet);
  } catch {
    hold(`${label}: "wallet" ${entry.wallet} is not a valid address — mixed-case addresses must carry a correct EIP-55 checksum.`);
  }
  if (!Array.isArray(entry.tokenIds)) {
    hold(`${label}: "tokenIds" must be an array (it may be empty — balanceOf is the gate).`);
  }
  const tokenIds = [];
  for (const id of entry.tokenIds) {
    if (!Number.isInteger(id) || id < 1 || id > MP_SUPPLY) {
      hold(`${label}: "tokenIds" must hold integers in 1..${MP_SUPPLY}, got ${JSON.stringify(id)}.`);
    }
    if (tokenIds.includes(id)) hold(`${label}: token id ${id} is listed twice.`);
    tokenIds.push(id);
  }
  if (typeof entry.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(entry.signature)) {
    hold(`${label}: "signature" must be 0x + 130 hex characters (65 bytes).`);
  }
  return { wallet, github: entry.github, tokenIds: tokenIds.sort((a, b) => a - b), signature: entry.signature };
}

function readJson(path, label) {
  if (!existsSync(path)) hold(`no ${label} at ${path}.`, 2);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    hold(`${path} is not valid JSON — ${e.message}`);
  }
}

function readMpRecord() {
  const record = readJson(MP_RECORD_PATH, "Merged Public deployment record");
  if (typeof record.address !== "string") {
    hold(`${MP_RECORD_PATH} has no "address" field. Refusing to guess the identity contract.`);
  }
  if (getAddress(record.address) !== getAddress(MP_ADDRESS)) {
    hold(
      `${MP_RECORD_PATH} names ${record.address}, but Merged Public is ${MP_ADDRESS}.\n` +
        "  Refusing to read identity from a contract this tool does not know.\n" +
        "  Stop and find out why the deployment record changed.",
    );
  }
  if (record.chainId !== Number(CHAIN_ID)) {
    hold(`${MP_RECORD_PATH} records chain ${record.chainId}, not ${CHAIN_ID}.`);
  }
  return record;
}

function readRegistry() {
  const registry = readJson(REGISTRY_PATH, "registry");
  if (!Array.isArray(registry.agents)) {
    hold(`${REGISTRY_PATH} has no "agents" array. Refusing to write into a file whose shape is not the documented one.`);
  }
  // Tripwire: the registry publishes the message every signature was made
  // over. If it drifts from this tool, holders would be verified against a
  // message the record does not describe.
  if (registry.message_template !== MESSAGE_TEMPLATE) {
    hold(
      `${REGISTRY_PATH} publishes a different canonical message than this tool signs.\n` +
        `  registry: ${JSON.stringify(registry.message_template)}\n` +
        `  link-mp : ${JSON.stringify(MESSAGE_TEMPLATE)}\n` +
        "  One of the two changed without the other. Do not verify anything until this is resolved.",
    );
  }
  return registry;
}

async function verify(opts) {
  if (!opts.file) usage("verify needs --file <entry.json>.");
  const path = resolve(opts.file);
  const entry = validateEntry(readJson(path, "entry file"), path);

  // 1. Off-chain: does the signature prove control of the claimed wallet?
  const message = canonicalMessage(entry.github, entry.wallet);
  let recovered;
  try {
    recovered = getAddress(verifyMessage(message, entry.signature));
  } catch (e) {
    hold(`the signature is not a valid EIP-191 personal_sign signature — ${e.shortMessage || e.message}`);
  }
  if (recovered !== entry.wallet) {
    hold(
      `the signature recovers ${recovered}, not the claimed ${entry.wallet}.\n` +
        "  Either the wallet field was edited after signing, or the message text differs.\n" +
        `  message signed here: ${message}`,
    );
  }
  console.log("message     :", message);
  console.log("signature   : OK — recovers", entry.wallet);

  // 2. Registry: one wallet, one GitHub account, once. Checked before the
  // chain reads so a duplicate costs nobody an RPC round trip.
  const registry = readRegistry();
  for (const existing of registry.agents) {
    let existingWallet;
    try {
      existingWallet = getAddress(String(existing.wallet));
    } catch {
      hold(`${REGISTRY_PATH} already contains an entry whose wallet is not a valid address. Fix the registry before appending to it.`);
    }
    if (existingWallet === entry.wallet) {
      hold(`${entry.wallet} is already registered (as github=${existing.github}). One wallet, one entry. Nothing was written.`);
    }
    if (String(existing.github).toLowerCase() === entry.github.toLowerCase()) {
      hold(`github=${existing.github} is already registered (wallet ${existing.wallet}). GitHub usernames are case-insensitive. Nothing was written.`);
    }
  }

  // 3. On-chain: does that wallet actually hold a Merged Public identity?
  const record = readMpRecord();
  const rpc = process.env.RH_RPC_URL || process.env.RPC_URL || DEFAULT_RPC;
  console.log("rpc         :", rpc);
  console.log("identity    :", record.address, "(Merged Public)");

  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  let network;
  try {
    network = await provider.getNetwork();
  } catch (e) {
    hold(`could not reach ${rpc} — ${e.shortMessage || e.message}. Nothing was verified on-chain.`);
  }
  if (network.chainId !== CHAIN_ID) {
    hold(`${rpc} reports chain ${network.chainId}, not ${CHAIN_ID}. Refusing to read identity from the wrong chain.`);
  }

  const mp = new Contract(record.address, MP_ABI, provider);
  let balance;
  try {
    balance = await mp.balanceOf(entry.wallet);
  } catch (e) {
    hold(`balanceOf(${entry.wallet}) failed against ${record.address} — ${e.shortMessage || e.message}.`);
  }
  if (balance === 0n) {
    hold(
      `${entry.wallet} holds no Merged Public identity on chain ${CHAIN_ID} (balanceOf = 0).\n` +
        "  The gate is holding MP, not registering. Nothing was written.",
    );
  }
  console.log("balanceOf   :", balance.toString());

  for (const id of entry.tokenIds) {
    let owner;
    try {
      owner = getAddress(await mp.ownerOf(id));
    } catch (e) {
      hold(`ownerOf(${id}) failed — ${e.shortMessage || e.message}. Token ids run 1..${MP_SUPPLY}.`);
    }
    if (owner !== entry.wallet) hold(`token ${id} is owned by ${owner}, not ${entry.wallet}.`);
    console.log(`ownerOf(${id})`.padEnd(12), ": OK");
  }
  if (entry.tokenIds.length === 0) {
    console.log("tokenIds    : none claimed — balanceOf is the gate, so there is no ownerOf check to run");
  }

  // 4. Append only after the signature, the registry and the chain all agree.
  if (opts.write) {
    registry.agents.push({ ...entry, linkedAt: new Date().toISOString().slice(0, 10) });
    writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    console.log("registry    : appended to agents/registry.json — commit it in a pull request for a human to merge");
  } else {
    console.log("registry    : verification only — pass --write to append to agents/registry.json");
  }

  console.log("");
  console.log("Verified: this GitHub account is bound to a wallet holding Merged Public.");
  if (!existsSync(BOARD_RECORD_PATH)) {
    console.log(`No board record at ${BOARD_RECORD_PATH} yet, so no bounty can be`);
    console.log("funded and no task is workable. Registering does not change that.");
  }
  console.log("Merged Credits settle only when work merges — payment for verified work,");
  console.log("never for holding.");
}

// ---- entry point ------------------------------------------------------------

const MODES = {
  sign: { run: sign, spec: { github: "value", tokens: "value" } },
  verify: { run: verify, spec: { file: "value", write: "boolean" } },
};

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "--help" || mode === "-h" || mode === undefined) usage();
  const chosen = MODES[mode];
  if (!chosen) usage(`unknown mode "${mode}". Modes are sign and verify.`);
  await chosen.run(parseArgs(rest, chosen.spec));
}

// Importable (the test suite reads MESSAGE_TEMPLATE from here) without ever
// running the CLI as a side effect.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
  return norm(entry) === norm(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) {
  await main().catch((e) => {
    console.error(`HOLD: ${e.message || e}`);
    process.exit(1);
  });
}
