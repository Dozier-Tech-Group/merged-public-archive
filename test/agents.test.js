/**
 * @vitest-environment node
 *
 * Shape tests for the two public files the Merged Public fleet runs on:
 * agents/registry.json (who is a verified holder) and agents/tasks.json (what
 * is funded). These files are read by CI, by the fleet board, and by anyone
 * auditing the rail, so their shapes are contract, not convention.
 *
 * The load-bearing check is the last one: no task may claim funded:true while
 * deployments/mp-board.robinhood.json is absent. Until the board is deployed
 * there is no escrow, so "funded" could only be a fiction.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_TEMPLATE, canonicalMessage } from "../scripts/link-mp.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));

const registry = readJson("agents/registry.json");
const tasks = readJson("agents/tasks.json");

const MP_SUPPLY = 10000;
const STATUSES = ["open", "in_progress", "done"];

describe("agents/registry.json", () => {
  it("carries exactly the documented top-level shape", () => {
    expect(Object.keys(registry).sort()).toEqual(["$schema", "agents", "how_to_join", "message_template"]);
    expect(typeof registry.$schema).toBe("string");
    expect(registry.$schema.length).toBeGreaterThan(0);
    expect(Array.isArray(registry.agents)).toBe(true);
  });

  it("starts empty — no verified holders yet, so nothing automated may run", () => {
    expect(registry.agents).toEqual([]);
  });

  it("publishes the same canonical message link-mp.mjs signs", () => {
    expect(registry.message_template).toBe(MESSAGE_TEMPLATE);
  });

  it("points at the tool that produces and checks entries", () => {
    expect(registry.how_to_join).toContain("scripts/link-mp.mjs");
  });

  it("states that registering is not payment", () => {
    const prose = `${registry.$schema} ${registry.how_to_join}`;
    expect(prose).toMatch(/payment for verified work/);
    expect(prose).toMatch(/never for holding/);
  });

  // Runs zero times today. It is here so the first real entry cannot land in a
  // shape the verifier would never have produced.
  it("holds only entries in the shape link-mp.mjs writes", () => {
    for (const agent of registry.agents) {
      expect(Object.keys(agent).sort()).toEqual(["github", "linkedAt", "signature", "tokenIds", "wallet"]);
      expect(agent.wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(typeof agent.github).toBe("string");
      expect(agent.github).toMatch(/^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/);
      expect(Array.isArray(agent.tokenIds)).toBe(true);
      for (const id of agent.tokenIds) {
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(MP_SUPPLY);
      }
      expect(new Set(agent.tokenIds).size).toBe(agent.tokenIds.length);
      expect(agent.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
      expect(agent.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const wallets = registry.agents.map((a) => a.wallet.toLowerCase());
    const githubs = registry.agents.map((a) => a.github.toLowerCase());
    expect(new Set(wallets).size).toBe(wallets.length);
    expect(new Set(githubs).size).toBe(githubs.length);
  });
});

describe("the canonical link message", () => {
  it("carries both placeholders", () => {
    expect(MESSAGE_TEMPLATE).toContain("<github>");
    expect(MESSAGE_TEMPLATE).toContain("<wallet>");
  });

  it("substitutes both and leaves nothing behind", () => {
    const wallet = "0x5D000b230653E416FF41451525b144a6C2Ad7178";
    const message = canonicalMessage("octocat", wallet);
    expect(message).toContain("github=octocat");
    expect(message).toContain(`wallet=${wallet}`);
    expect(message).not.toContain("<github>");
    expect(message).not.toContain("<wallet>");
  });

  it("stays a single line, so a signed message hides nothing below the fold", () => {
    expect(canonicalMessage("octocat", "0x0000000000000000000000000000000000000001")).not.toMatch(/[\r\n]/);
  });
});

describe("agents/tasks.json", () => {
  it("carries exactly the documented top-level shape", () => {
    expect(Object.keys(tasks).sort()).toEqual(["$schema", "tasks"]);
    expect(typeof tasks.$schema).toBe("string");
    expect(Array.isArray(tasks.tasks)).toBe(true);
  });

  it("documents that funded means funded on-chain and nothing else", () => {
    expect(tasks.$schema).toContain("MergedPublicBoard");
    expect(tasks.$schema).toContain("deployments/mp-board.robinhood.json");
    expect(tasks.$schema).toMatch(/funded/);
    expect(tasks.$schema).toMatch(/settles only when work merges/);
  });

  it("is empty — the board is not deployed, so nothing is funded", () => {
    expect(tasks.tasks).toEqual([]);
  });

  it("holds only tasks in the documented shape", () => {
    for (const task of tasks.tasks) {
      expect(Object.keys(task).sort()).toEqual(
        ["funded", "issueId", "prompt", "repo", "rewardMC", "status", "title"],
      );
      expect(Number.isInteger(task.issueId)).toBe(true);
      expect(task.issueId).toBeGreaterThan(0);
      expect(task.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(typeof task.title).toBe("string");
      expect(task.title.length).toBeGreaterThan(0);
      expect(typeof task.prompt).toBe("string");
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(Number.isInteger(task.rewardMC)).toBe(true); // MC is 0-decimals
      expect(task.rewardMC).toBeGreaterThan(0);
      expect(typeof task.funded).toBe("boolean");
      expect(STATUSES).toContain(task.status);
    }
    const ids = tasks.tasks.map((t) => t.issueId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never claims a bounty is funded while there is no board to hold escrow", () => {
    const boardDeployed = existsSync(resolve(root, "deployments/mp-board.robinhood.json"));
    if (boardDeployed) return; // funded:true is then a checkable on-chain claim
    for (const task of tasks.tasks) {
      expect(task.funded, `task ${task.issueId} claims funded with no board deployed`).toBe(false);
    }
  });
});
