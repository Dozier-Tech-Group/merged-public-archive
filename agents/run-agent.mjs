#!/usr/bin/env node
/**
 * The Merged Public fleet runner — works ONE funded, open task as a registered
 * holder's agent, then opens a pull request. Nothing else.
 *
 * The trust boundary, stated plainly rather than implied:
 *   - The operator holds the board's owner key and is its oracle. That is a
 *     TRUSTED role. After a human merges the pull request, the operator calls
 *     settle(issueId, winner) on MergedPublicBoard. This script cannot settle,
 *     cannot merge, and cannot move a single credit.
 *   - The agent's compute is paid by the operator (ANTHROPIC_API_KEY). No key,
 *     no fleet: this script is a loud no-op, and that is a healthy state.
 *   - No private key is read, required, or printed anywhere in this file. The
 *     holder signs on the holder's machine; the runner only ever handles a
 *     wallet ADDRESS, and only to write it into a pull request body so the
 *     operator knows who to settle to.
 *   - Work that does not pass `npm test` never becomes a pull request, and the
 *     gate runs HERE, in the job that did the work. GitHub does not fire
 *     `pull_request` workflows for pull requests opened with GITHUB_TOKEN, so
 *     ci.yml never runs on a fleet PR; a gate that cannot fire is not a gate.
 *   - The files that carry on-chain commitments are protected MECHANICALLY —
 *     a git diff check before any commit — not by asking the agent nicely.
 *
 * Usage:
 *   DRY_RUN=1 node agents/run-agent.mjs            # plan only, zero side effects
 *   node agents/run-agent.mjs --agent <github>     # a specific registered holder
 *   node agents/run-agent.mjs --task <issueId>     # a specific funded bounty
 *
 * In CI the same two inputs arrive as the env vars MP_AGENT / MP_TASK
 * (.github/workflows/mp-fleet.yml). Nothing in this file reaches a shell at
 * all: every external program — git, gh, npm, npx — is spawned with an argv
 * ARRAY and no shell, so a task title, an agent prompt, or a pull request body
 * carrying `backticks` or $(command substitution) is one opaque argument and
 * never a command. The pull request body is handed to gh as a FILE, for that
 * reason and because a body is many lines and an argument is one.
 * A real run additionally needs: ANTHROPIC_API_KEY, an authenticated gh CLI
 * (GH_TOKEN), and a git identity.
 *
 * Exit codes carry meaning. A missing precondition is exit 0 with a plain
 * sentence — dormant is normal, not broken. Exit 1 or 2 is reserved for a
 * contradiction: a malformed input, a corrupt committed file, or a deployment
 * record that gates a collection other than Merged Public.
 */
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.env.DRY_RUN === "1";

/* Addresses. Only two are known-good and therefore pinned here: the Merged
 * Public collection and the Merged Credit token, both source-verified on
 * Blockscout. The BOARD address is deliberately absent — it is read at runtime
 * from deployments/mp-board.robinhood.json and from nowhere else. An address
 * this file could invent is an address nobody can check. */
const MERGED_PUBLIC = "0x5D000b230653E416FF41451525b144a6C2Ad7178";
const MERGED_CREDIT = "0x040f12C71ddA0bA9D91E94016ea5C348106ab429";
const CHAIN_ID = 4663;
const RPC =
  process.env.RH_RPC_URL ||
  process.env.RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const SELF_REPO = "Dozier-Tech-Group/merged-public-archive";
const REGISTRY_PATH = join(ROOT, "agents", "registry.json");
const TASKS_PATH = join(ROOT, "agents", "tasks.json");
const BOARD_RECORD_PATH = join(ROOT, "deployments", "mp-board.robinhood.json");
const BOARD_RECORD_REL = "deployments/mp-board.robinhood.json";

/* The Claude Code CLI is PINNED. A run holds ANTHROPIC_API_KEY and a write
 * token, so a compromised upstream publish must never land in it silently.
 * Bump this deliberately, in a reviewed commit. */
const CLAUDE_CODE = "@anthropic-ai/claude-code@2.1.235";
/* Turns are the cost ceiling: a stuck task burns a bounded amount of budget
 * and then stops, instead of running until someone notices the bill. */
const MAX_TURNS = 40;

/* 4-byte selectors — first 4 bytes of keccak256 of the signature.
 * Recomputable with ethers: id("bounties(uint256)").slice(0, 10). */
const SEL_BOUNTIES = "0xdc2f8744"; // bounties(uint256) -> (uint256 reward, address winner, bool settled)
const SEL_BALANCE_OF = "0x70a08231"; // balanceOf(address)
const SEL_OWNER_OF = "0x6352211e"; // ownerOf(uint256)
/* MergedPublic is a plain ERC-721 (not Enumerable), so a wallet's token ids
 * cannot be read from the chain — they come from the registry, and the chain
 * only confirms them. Scanning is bounded so a long list cannot fan out. */
const MAX_TOKEN_CHECKS = 10;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/* Same username shape scripts/link-mp.mjs accepts into the registry: no
 * leading, trailing, or doubled hyphen. A value that could never be in the
 * registry should be refused before it reaches a lookup. */
const GITHUB_RE = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
const ISSUE_RE = /^\d{1,12}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^mp\/\d{1,5}\/task-\d{1,12}$/;
/* agents/tasks.json is a repo file, and a repo file is an INPUT. Its title
 * becomes a pull request title and two commit message lines; its prompt
 * becomes the agent's instructions. Both are shape-checked as strictly as
 * MP_AGENT/MP_TASK are, and for the same reason: an unchecked value that
 * reaches a command line, a commit, or an agent is not free. */
const TITLE_MAX = 200;
const PROMPT_MAX = 20000;
/* No control characters — that covers newlines, so a title stays one line, and
 * covers NUL and terminal escapes, so a log line stays a log line. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/* Bytes that are hashed into commitments already on chain. They are not
 * "sensitive files"; they are the record itself, and re-serializing one cannot
 * be fixed on-chain afterwards. The agent is TOLD not to touch them (§8) and
 * then mechanically PREVENTED from committing them (§9). */
const LOCKED_DIRS = ["deployments/", "metadata/mp/"];
const LOCKED_FILES = [
  "generator/merged-public/provenance.json",
  "game/season-zero/manifest.json",
];

const USAGE =
  "usage: [DRY_RUN=1] node agents/run-agent.mjs [--agent <github>] [--task <issueId>]";

/* ── input ──────────────────────────────────────────────────────────────
 * Strict argv: an unrecognized flag is a HOLD before anything is read, run,
 * or pushed. A typo'd --taks would otherwise silently become "next open task"
 * and spend the budget on work nobody asked for. */
const argv = process.argv.slice(2);
let cliAgent;
let cliTask;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.indexOf("=");
  const key = eq > 0 ? a.slice(0, eq) : a;
  // A flag with no value must not fall through to the CI env var: "--agent"
  // alone would then quietly run as whoever MP_AGENT names.
  const val = () => {
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || v === "" || v.startsWith("--")) {
      console.error(`HOLD: ${key} needs a value. Nothing read, nothing run.`);
      console.error(USAGE);
      process.exit(2);
    }
    return v;
  };
  if (key === "--agent") cliAgent = val();
  else if (key === "--task") cliTask = val();
  else {
    console.error(`HOLD: unknown argument '${a}'. Nothing read, nothing run.`);
    console.error(USAGE);
    process.exit(2);
  }
}

/* CLI flag or CI env var, same validation either way. Both values only ever
 * index into repo-committed JSON, but a shape check is cheap and an unchecked
 * value that reaches a command line is not. */
function pickInput(value, envName, pattern, label) {
  const raw = value !== undefined ? value : process.env[envName];
  const v = typeof raw === "string" ? raw.trim() : raw;
  if (v === undefined || v === "") return undefined;
  if (!pattern.test(v)) {
    console.error(
      `HOLD: ${label} must match ${pattern} — refusing.\n` +
        `Received it via ${value !== undefined ? "the command line" : envName}. ` +
        "Nothing read, nothing run."
    );
    process.exit(2);
  }
  return v;
}

const agentName = pickInput(cliAgent, "MP_AGENT", GITHUB_RE, "the agent (a GitHub username)");
const taskInput = pickInput(cliTask, "MP_TASK", ISSUE_RE, "the task (a numeric issueId)");

/* ── helpers ────────────────────────────────────────────────────────── */

function stop(message) {
  // Every precondition failure lands here: say what is missing and why that
  // means no work can happen, then exit clean.
  console.log(message);
  process.exit(0);
}

function hold(message) {
  console.error(`HOLD: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    hold(`${label} exists but is not valid JSON (${e.message}). Fix the file; nothing run.`);
  }
}

/* ── running other programs ───────────────────────────────────────────────
 * There is no shell in this file. Every external program is spawned with an
 * argv ARRAY, so each argument arrives at git, gh, npm, or npx exactly as it
 * was written — a title containing `backticks` or $(command substitution) is
 * a title, not a command. JSON.stringify is NOT shell quoting: it escapes a
 * backslash and a double quote and nothing else, so under POSIX sh a `word`
 * would run as a command and its output would replace it, silently. That is
 * why none of these helpers accepts a command string. */

/* show() renders an argv for a HUMAN — the dry-run log and error messages.
 * It is a display function. Its output must never be handed to a shell, and
 * cannot be, because nothing here takes a command string. */
const PLAIN_ARG = /^[A-Za-z0-9._:@=+,\/-]+$/;
function show(file, args) {
  return [file, ...args]
    .map((a) => (PLAIN_ARG.test(a) ? a : "'" + String(a).replaceAll("'", "'\\''") + "'"))
    .join(" ");
}

/* The workhorse: run argv, return trimmed stdout, throw on a non-zero exit.
 * With stdio:"inherit" there is no captured stdout and execFileSync returns
 * null, so the return is normalised to a string either way. */
function run(file, args, opts = {}) {
  if (DRY) {
    console.log("  [dry-run] " + show(file, args));
    return "";
  }
  const out = execFileSync(file, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...opts,
  });
  return typeof out === "string" ? out.trim() : "";
}

/* Same argv discipline, but a non-zero exit is an ANSWER, not a throw: the
 * test gate below has to be able to fail quietly and stop the run without a
 * stack trace, because failing the tests is a normal outcome, not a crash. */
function runStatus(file, args, opts = {}) {
  if (DRY) {
    console.log("  [dry-run] " + show(file, args));
    return { ok: true, detail: "dry run" };
  }
  const r = spawnSync(file, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
  if (r.error) return { ok: false, detail: r.error.message };
  if (r.signal) return { ok: false, detail: `killed by ${r.signal}` };
  return { ok: r.status === 0, detail: `exit code ${r.status}` };
}

/* NUL-separated capture, for reading path lists out of git. -z is not a
 * detail: without it git quotes and escapes unusual filenames, and a guard
 * that compares mangled paths is a guard with a hole in it. */
function capture0(file, args, opts = {}) {
  if (DRY) {
    console.log("  [dry-run] " + show(file, args));
    return [];
  }
  const out = execFileSync(file, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...opts,
  });
  return String(out || "")
    .split("\0")
    .filter((p) => p !== "");
}

/* Raw JSON-RPC. No key, no signer, no library: an eth_call is a POST.
 * node:http(s) with agent:false rather than fetch — fetch leaves a pooled
 * keep-alive socket open, and every exit here is a process.exit whose CODE IS
 * THE MESSAGE in CI. A clean no-op that exits 127 because of a dangling handle
 * would read as a broken fleet. */
function rpcPost(payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(RPC);
    } catch {
      return reject(new Error("RH_RPC_URL/RPC_URL is not a URL"));
    }
    const send = url.protocol === "http:" ? httpRequest : httpsRequest;
    const body = JSON.stringify(payload);
    const req = send(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`rpc ${res.statusCode}`));
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("rpc returned non-JSON"));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`rpc timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function ethCall(to, data) {
  const body = await rpcPost({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  if (body.error) throw new Error(body.error.message || "rpc error");
  if (typeof body.result !== "string") throw new Error("rpc returned no result");
  return body.result;
}

const pad32 = (addr) => addr.toLowerCase().replace("0x", "").padStart(64, "0");
const padUint = (n) => BigInt(n).toString(16).padStart(64, "0");
const word = (hex, i) => {
  const start = 2 + i * 64;
  const slice = hex.slice(start, start + 64);
  if (slice.length !== 64) throw new Error("short return data");
  return BigInt("0x" + slice);
};
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/* ── 1. budget ──────────────────────────────────────────────────────── */
/* Whitespace is not a key. A secret set to " " is the same dormant state as a
 * secret that was never set, and the workflow's gate reads it the same way. */
if (!DRY && String(process.env.ANTHROPIC_API_KEY || "").trim() === "") {
  stop(
    "The MP fleet is dormant: ANTHROPIC_API_KEY is not configured.\n" +
      "Agent compute is paid by the operator, so with no key there is no run.\n" +
      "Nothing was read and nothing was changed. (DRY_RUN=1 plans without a key.)"
  );
}

/* ── 2. who is running ──────────────────────────────────────────────── */
const registry = readJson(REGISTRY_PATH, "agents/registry.json");
if (!registry) {
  stop("No agents/registry.json — no verified holders yet, nothing to run.");
}
const roster = Array.isArray(registry.agents) ? registry.agents : [];
if (roster.length === 0) {
  stop(
    "The registry lists no verified holders yet, nothing to run.\n" +
      "An entry is added only after a signature recovers the wallet AND that\n" +
      "wallet is shown to hold a Merged Public identity on chain 4663."
  );
}

/* A usable entry has a wallet to settle to and at least one identity to work
 * as. Naming an agent overrides this: a named entry is checked strictly below
 * so its owner learns exactly what is wrong with it. */
const usable = (a) =>
  a && ADDRESS_RE.test(String(a.wallet || "")) && Array.isArray(a.tokenIds) && a.tokenIds.length > 0;

/* There is no rotation. Without a named agent the first usable entry runs —
 * said plainly rather than dressed up as a queue. The operator dispatches
 * --agent / MP_AGENT to run anyone else. */
const agent = agentName ? roster.find((a) => same(a && a.github, agentName)) : roster.find(usable);
if (!agent) {
  stop(
    agentName
      ? `'${agentName}' is not a registered Merged Public holder — nothing to run.\n` +
          "Only wallets verified into agents/registry.json get an agent."
      : "No registry entry is usable yet: every verified holder is missing a wallet or a\n" +
          "token id. Nothing to run, and nothing invented to fill the gap."
  );
}

/* A malformed entry is a repo bug, not a dormant state: be red about it. */
if (!ADDRESS_RE.test(String(agent.wallet || ""))) {
  hold(
    `registry entry for '${agent.github}' has no valid wallet address. ` +
      "The wallet is what the operator settles to; refusing to run without one."
  );
}
const tokenIds = Array.isArray(agent.tokenIds) ? agent.tokenIds : [];
for (const id of tokenIds) {
  if (!Number.isInteger(id) || id < 1 || id > 10000) {
    hold(
      `registry entry for '${agent.github}' lists token id ${JSON.stringify(id)}, which is not ` +
        "an integer in 1..10000. The archive is exactly 10,000 entities; refusing to name a " +
        "token that cannot exist."
    );
  }
}
if (tokenIds.length === 0) {
  // The registry allows an empty tokenIds array because balanceOf is the
  // settlement gate — but the fleet names an identity in the branch and the
  // pull request title, and it will not invent one. Clean no-op, not a failure.
  stop(
    `Registry entry for '${agent.github}' lists no tokenIds, so there is no identity to work as.\n` +
      "Re-link with the tokens you hold (scripts/link-mp.mjs sign --tokens ...) and the fleet\n" +
      "will pick this holder up on the next run. Nothing run."
  );
}
/* Provisional until the chain confirms it below; never printed as verified
 * before that. */
let tokenId = tokenIds[0];
let tokenVerified = false;

/* ── 3. the board (funding is meaningless without it) ───────────────── */
const boardRecord = readJson(BOARD_RECORD_PATH, BOARD_RECORD_REL);
if (!boardRecord && !DRY) {
  stop(
    `The Merged Public board is not deployed: ${BOARD_RECORD_REL} does not exist.\n` +
      "No bounty can be treated as funded, so there is nothing to work and\n" +
      "nothing to settle. This is the expected state until the board deploys —\n" +
      "run with DRY_RUN=1 to rehearse the pipeline in the meantime."
  );
}
let board = null;
if (boardRecord) {
  board = String(boardRecord.address || "");
  if (!ADDRESS_RE.test(board)) {
    hold(`${BOARD_RECORD_REL} has no valid 'address'. Trust no board that is not in that file.`);
  }
  // The record must gate MERGED PUBLIC and pay MERGED CREDITS. A board wired to
  // anything else would settle work to the wrong collection's holders, and
  // that is a stop-the-line contradiction, not a retryable hiccup.
  if (!same(boardRecord.identity, MERGED_PUBLIC)) {
    hold(
      `${BOARD_RECORD_REL} names identity ${boardRecord.identity}, not the Merged Public\n` +
        `collection ${MERGED_PUBLIC}. That board does not gate this archive.`
    );
  }
  if (!same(boardRecord.credit, MERGED_CREDIT)) {
    hold(
      `${BOARD_RECORD_REL} names credit ${boardRecord.credit}, not Merged Credits\n` +
        `${MERGED_CREDIT}.`
    );
  }
  if (boardRecord.chainId !== undefined && Number(boardRecord.chainId) !== CHAIN_ID) {
    hold(`${BOARD_RECORD_REL} records chainId ${boardRecord.chainId}, not ${CHAIN_ID}.`);
  }
}

/* ── 4. what to work ────────────────────────────────────────────────── */
const queue = readJson(TASKS_PATH, "agents/tasks.json");
if (!queue) {
  stop("No agents/tasks.json — the task queue is empty, nothing to run.");
}
const tasks = Array.isArray(queue.tasks) ? queue.tasks : [];
const taskId = taskInput ? Number(taskInput) : null;
/* tasks.json is the off-chain MIRROR of the board; the chain below is the
 * authority. Under DRY_RUN an unfunded task is allowed through so the pipeline
 * can be inspected before any bounty exists — and it is labelled as such. */
const task = tasks.find(
  (t) =>
    t &&
    t.status === "open" &&
    (taskId === null || Number(t.issueId) === taskId) &&
    (t.funded === true || DRY)
);
if (!task) {
  stop(
    taskId !== null
      ? `Task ${taskId} is not both open and funded in agents/tasks.json — nothing to run.`
      : "No open funded task in agents/tasks.json — nothing to run.\n" +
          "(Unfunded tasks are visible only under DRY_RUN=1.)"
  );
}
const issueId = Number(task.issueId);
if (!Number.isInteger(issueId) || issueId < 0) {
  hold(`task entry has a non-numeric issueId (${task.issueId}); the on-chain bounty key must be a number.`);
}
const repo = String(task.repo || SELF_REPO);
if (!REPO_RE.test(repo)) {
  hold(`task ${issueId} names repo '${task.repo}', which is not an owner/name pair.`);
}
if (typeof task.prompt !== "string" || task.prompt.trim() === "") {
  hold(`task ${issueId} has no prompt. There is nothing for an agent to do.`);
}
if (task.prompt.length > PROMPT_MAX) {
  hold(
    `task ${issueId} has a ${task.prompt.length}-character prompt; the ceiling is ${PROMPT_MAX}. ` +
      "A prompt that long is a document, not an instruction — put it in the repo and point at it."
  );
}
/* The title is optional (the fallback below is `Issue <n>`), but a title that
 * IS present is a pull request title, a commit subject, and a log line, so it
 * is checked as strictly as the CI inputs are: one line, no control
 * characters, bounded length. */
if (task.title !== undefined && task.title !== null) {
  if (typeof task.title !== "string") {
    hold(`task ${issueId} has a non-string title (${JSON.stringify(task.title)}). Fix the file; nothing run.`);
  }
  if (task.title.trim() === "") {
    hold(`task ${issueId} has an empty title. Give it one or omit the field; refusing to guess.`);
  }
  if (CONTROL_RE.test(task.title)) {
    hold(
      `task ${issueId} has a title containing a control character (newline, NUL, or escape). ` +
        "A pull request title is one line; refusing to commit or open anything with that in it."
    );
  }
  if (task.title.length > TITLE_MAX) {
    hold(
      `task ${issueId} has a ${task.title.length}-character title; the ceiling is ${TITLE_MAX}.`
    );
  }
}

/* ── 5. the chain is the authority on "funded" ──────────────────────── */
let onChainReward = null;
if (board) {
  try {
    const raw = await ethCall(board, SEL_BOUNTIES + padUint(issueId));
    const reward = word(raw, 0);
    const settled = word(raw, 2) !== 0n;
    onChainReward = reward;
    if (reward === 0n) {
      stop(
        `Issue ${issueId} is not funded on the board (reward 0 at ${board}).\n` +
          "agents/tasks.json is only a mirror; the board is the record. Nothing run."
      );
    }
    if (settled) {
      stop(`Issue ${issueId} is already settled on the board — the bounty is closed. Nothing run.`);
    }
    // The contract requires the winner to hold a Merged Public identity at
    // settlement. Checking now costs one eth_call; skipping it would spend the
    // whole budget on work that could never be settled.
    const balRaw = await ethCall(MERGED_PUBLIC, SEL_BALANCE_OF + pad32(agent.wallet));
    if (word(balRaw, 0) === 0n) {
      stop(
        `${agent.wallet} holds no Merged Public identity right now, so settle() would\n` +
          "revert (MergedPublicBoardNeedIdentity). Not spending budget on unsettleable work."
      );
    }
    // The wallet holds SOMETHING; now confirm it still holds one of the ids the
    // registry claims, so the pull request names an identity that is actually
    // theirs at run time. Registration was a moment in the past; tokens move.
    for (const id of tokenIds.slice(0, MAX_TOKEN_CHECKS)) {
      const ownerRaw = await ethCall(MERGED_PUBLIC, SEL_OWNER_OF + padUint(id));
      if (same("0x" + ownerRaw.slice(-40), agent.wallet)) {
        tokenId = id;
        tokenVerified = true;
        break;
      }
    }
    if (!tokenVerified) {
      stop(
        `${agent.wallet} holds a Merged Public identity but none of the token ids in its\n` +
          `registry entry (${tokenIds.slice(0, MAX_TOKEN_CHECKS).join(", ")}). Re-link with a current\n` +
          "token id rather than have the fleet claim one it cannot verify. Nothing run."
      );
    }
  } catch (e) {
    const msg =
      `Could not confirm funding on chain ${CHAIN_ID} (${e.message}).\n` +
      "Refusing to treat the bounty as funded on the strength of a JSON file alone.\n" +
      "Nothing run — retry when the RPC answers.";
    if (!DRY) stop(msg);
    console.log("[dry-run] " + msg.split("\n")[0]);
  }
}

/* ── 6. the plan ────────────────────────────────────────────────────── */
const branch = `mp/${tokenId}/task-${issueId}`;
if (!BRANCH_RE.test(branch)) {
  hold(`refusing to work on branch '${branch}' — it is not an mp/<tokenId>/task-<issueId> branch.`);
}
const title = `[MP #${tokenId}] ${task.title || `Issue ${issueId}`}`;

console.log("Merged Public fleet — one task, one branch, one pull request.");
console.log(
  `  Agent   : @${agent.github} (Merged Public #${tokenId}${tokenVerified ? "" : ", UNCONFIRMED on chain"}, wallet ${agent.wallet})`
);
console.log(`  Task    : ${issueId} in ${repo} — ${task.title || "(untitled)"}`);
console.log(
  `  Reward  : ${onChainReward !== null ? `${onChainReward} MC confirmed on the board` : `${task.rewardMC ?? "?"} MC per tasks.json (UNCONFIRMED)`}`
);
console.log(`  Board   : ${board || "NOT DEPLOYED — no bounty can be treated as funded"}`);
console.log(`  Branch  : ${branch}`);
console.log(`  PR title: ${title}`);
if (DRY) {
  console.log("\nDRY RUN — planning only. Nothing is cloned, edited, committed, pushed, or opened.");
  if (!board) {
    console.log(
      "REHEARSAL ONLY: with no " + BOARD_RECORD_REL + " this task is NOT funded and a\n" +
        "real run would stop right here."
    );
  }
}
console.log("");

/* ── 7. workspace ───────────────────────────────────────────────────── */
/* Work clones land in the OS temp dir, never inside the archive: this
 * repository is a public record and must not grow stray checkouts. */
let cwd = ROOT;
if (repo !== SELF_REPO) {
  // Cross-repo work needs a token with access to that repo. If the run only
  // carries the default GITHUB_TOKEN, this clone fails loudly — which is the
  // correct outcome, not something to paper over.
  cwd = DRY
    ? join(tmpdir(), "mp-fleet-<run>", repo.split("/")[1])
    : join(mkdtempSync(join(tmpdir(), "mp-fleet-")), repo.split("/")[1]);
  run("gh", ["repo", "clone", repo, cwd, "--", "--depth", "1"]);
}
run("git", ["-C", cwd, "checkout", "-b", branch]);
if (!DRY) {
  const current = run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== branch) {
    hold(`expected to be on ${branch} but HEAD is ${current}. Refusing to touch anything else.`);
  }
}

/* ── 8. the agent works ─────────────────────────────────────────────── */
const prompt = [
  task.prompt,
  "",
  `You are working as Merged Public #${tokenId} on funded bounty issue ${issueId} in ${repo}.`,
  "Keep the diff minimal and the repository's tests green (npm test).",
  "Do not touch deployments/, generator/merged-public/provenance.json,",
  "metadata/mp/, or game/season-zero/manifest.json — those files are byte-locked",
  "to commitments that are already on-chain.",
  "Open no pull request yourself and merge nothing: this runner opens one PR and",
  "a human decides whether it lands.",
].join("\n");

/* The agent's environment is CONSTRUCTED, not inherited. It gets the key that
 * pays for it plus the plumbing any Node child needs, and nothing else — most
 * pointedly not GH_TOKEN. The agent edits files in a work tree; it has no
 * errand at GitHub, so a write token has no reason to be readable by the model
 * that is about to read this repository's untrusted issue text. The push and
 * the pull request happen below, in this process, where the token belongs. */
const AGENT_ENV_KEYS = [
  "PATH", "HOME", "USERPROFILE", "SHELL", "LANG", "LC_ALL", "TZ", "CI",
  "TMPDIR", "TMP", "TEMP", "SystemRoot", "windir", "ComSpec", "APPDATA",
  "LOCALAPPDATA", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "NODE_EXTRA_CA_CERTS",
  "npm_config_cache", "NPM_CONFIG_CACHE",
];
const agentEnv = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "" };
// Windows environment names are case-insensitive, so PATH and Path are one
// variable there and passing both would hand the child a duplicate entry.
const envSeen = new Set(["anthropic_api_key"]);
for (const key of AGENT_ENV_KEYS) {
  if (process.env[key] === undefined) continue;
  const seenAs = process.platform === "win32" ? key.toLowerCase() : key;
  if (envSeen.has(seenAs)) continue;
  envSeen.add(seenAs);
  agentEnv[key] = process.env[key];
}
run(
  "npx",
  [
    "--yes",
    CLAUDE_CODE,
    "-p",
    prompt,
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    String(MAX_TURNS),
  ],
  { cwd, stdio: "inherit", env: agentEnv }
);

/* ── 9. one pull request, for humans to judge ───────────────────────── */
const changed = DRY ? "" : run("git", ["-C", cwd, "status", "--porcelain"]);
if (!DRY && !changed) {
  stop("The agent produced no changes — nothing to open. No PR, no claim.");
}

/* The byte-lock, enforced by machine. §8 asks the agent to leave the committed
 * commitments alone; this checks. Staged, unstaged, and untracked are all
 * asked for separately because "the agent edited it", "the agent staged it",
 * and "the agent created it" are three different ways to break the same
 * promise. --no-renames so a file moved OUT of a locked path shows up as the
 * deletion it is. */
const touched = new Set();
for (const args of [
  ["diff", "-z", "--name-only", "--no-renames"],
  ["diff", "-z", "--name-only", "--no-renames", "--cached"],
  ["ls-files", "-z", "--others", "--exclude-standard"],
]) {
  for (const p of capture0("git", ["-C", cwd, ...args])) touched.add(p.replaceAll("\\", "/"));
}
const locked = [...touched].filter(
  (p) => LOCKED_FILES.includes(p) || LOCKED_DIRS.some((d) => p.startsWith(d))
);
if (locked.length > 0) {
  hold(
    "the agent touched files that are byte-locked to commitments already on chain:\n" +
      locked.map((p) => `  ${p}`).join("\n") +
      "\nNothing was committed, nothing was pushed, and no pull request was opened.\n" +
      "These bytes ARE the record — a re-serialized deployment record, provenance\n" +
      "file, sealed metadata file, or season manifest cannot be fixed on-chain\n" +
      "afterwards. Revert them and run the task again."
  );
}

/* The test gate, run HERE because it cannot run anywhere else. A pull request
 * opened with GITHUB_TOKEN does not trigger `pull_request` workflows, so
 * ci.yml never fires on a fleet PR: if this job does not run the suite, then
 * nothing does, and "a pull request that breaks the tests does not merge"
 * would be a sentence rather than a gate. Failing is a normal outcome — exit
 * 0, no commit, no push, no pull request, no claim. */
const tests = runStatus("npm", ["test"], { cwd });
if (!tests.ok) {
  stop(
    `The agent's work does not pass 'npm test' in ${repo} (${tests.detail}).\n` +
      "It therefore does not earn: nothing was committed, the branch was not pushed,\n" +
      `and no pull request was opened. The work exists only in this run's workspace\n` +
      `(${cwd}) and disappears with it. The test output above is the whole reason.`
  );
}

run("git", ["-C", cwd, "add", "-A"]);
run("git", [
  "-C", cwd, "commit",
  "-m", title,
  "-m", `Merged Public fleet: task ${issueId} worked for holder ${agent.wallet}`,
]);

/* Push credentials, handed over at the one step that needs them. The checkout
 * runs with persist-credentials:false, so no token sits in .git/config while
 * the agent has the tree. Here the token reaches git through git's own
 * credential helper, which reads it out of the ENVIRONMENT: it never appears
 * in an argv (visible in the process list), never in .git/config (readable by
 * anything with the tree), and never in a log line (git prints the remote URL
 * on failure). Without a token — a human running this locally — git is left
 * to whatever credentials that machine already has. */
const pushToken = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
const pushEnv = pushToken
  ? {
      ...process.env,
      GH_TOKEN: pushToken,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      // A constant, not a template: no value from this run is interpolated
      // into it. $GH_TOKEN is expanded by the shell git runs for its own
      // credential helper, from the environment, at the moment of the push.
      GIT_CONFIG_VALUE_0: '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f',
    }
  : process.env;
run("git", ["-C", cwd, "push", "-u", "origin", branch], { env: pushEnv });

const body = [
  "Automated Merged Public fleet submission. An agent opened this; a human reviews and merges it.",
  "",
  `- Bounty issueId: **${issueId}**${onChainReward !== null ? ` (**${onChainReward} MC** escrowed on the board)` : ""}`,
  `- Merged Public identity: **#${tokenId}**, held by \`${agent.wallet}\`` +
    (tokenVerified ? " (ownerOf confirmed when this run started)" : " (NOT confirmed on chain — rehearsal)"),
  `- Agent operator: @${agent.github}`,
  `- Board: \`${board || "not deployed"}\` (recorded in ${BOARD_RECORD_REL} — trust no other address)`,
  "- Test gate: `npm test` passed in the fleet job, in this working tree, before this",
  "  pull request was opened. GitHub does not run `pull_request` workflows for pull",
  "  requests opened with GITHUB_TOKEN, so the suite runs where the work happened.",
  "",
  "After this pull request merges, the operator settles the bounty on-chain:",
  `\`MergedPublicBoard.settle(${issueId}, ${agent.wallet})\`. First settle wins, and the`,
  "contract requires the winner to still hold a Merged Public identity at that moment.",
  "The operator is the board's owner and oracle — a trusted role, said plainly.",
  "",
  "Merged Credits settle only when work merges: payment for verified work, never for holding.",
  "No yield, no returns. Robinhood has not endorsed, reviewed, or partnered with this project.",
].join("\n");
/* The body goes to gh as a FILE. Two reasons, both load-bearing: a body is
 * many lines and an argument is one, and a body is the place where this
 * runner writes the wallet to settle to and the board address — inside
 * markdown backticks, which a shell would have executed and replaced with
 * nothing, deleting exactly the facts a reviewer needs, while gh still exited
 * 0. The file lands in the OS temp dir and is removed either way. */
if (DRY) {
  console.log(
    "  [dry-run] " +
      show("gh", [
        "pr", "create", "--repo", repo, "--head", branch,
        "--title", title, "--body-file", "<temp file, written only on a real run>",
      ])
  );
  console.log("  [dry-run] the body that file would hold:");
  for (const line of body.split("\n")) console.log("    | " + line);
} else {
  const bodyDir = mkdtempSync(join(tmpdir(), "mp-fleet-body-"));
  const bodyPath = join(bodyDir, "pr-body.md");
  writeFileSync(bodyPath, body, "utf8");
  try {
    run(
      "gh",
      [
        "pr", "create", "--repo", repo, "--head", branch,
        "--title", title, "--body-file", bodyPath,
      ],
      { cwd }
    );
  } finally {
    rmSync(bodyDir, { recursive: true, force: true });
  }
}

console.log(
  DRY
    ? "\nDry run complete — nothing was changed, pushed, or opened."
    : "\nPull request opened. It earns nothing until a human merges it."
);
