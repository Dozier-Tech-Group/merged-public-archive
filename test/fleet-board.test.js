import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

const BB = "0xd7899073819206828b7f4c7bB8aE4C530E93C0A2";
const MC = "0x040f12C71ddA0bA9D91E94016ea5C348106ab429";
const TOPIC_FUNDED = "0xa1dd612b9278fe0bb5d89ed1f642dc3678d0e558630c5a4a8df212ba2197cdb4";
const TOPIC_SETTLED = "0x2c35d68fdf40b18e913bb877373b4a4fc67810e2546dc5c9f9208eb8494057cb";
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const addrWord = (a) => "0x" + a.toLowerCase().replace("0x", "").padStart(64, "0");

// Canned responses shaped like the real sources (shapes verified live against
// rpc.mainnet.chain.robinhood.com and robinhoodchain.blockscout.com).
const FIXTURES = {
  logs: {
    items: [
      { topics: [TOPIC_SETTLED, word(1003), addrWord("0x1111111111111111111111111111111111111111")],
        data: word(10), block_timestamp: "2026-08-19T04:00:00.000000Z", transaction_hash: "0xsettle3" },
      { topics: [TOPIC_FUNDED, word(1003)], data: word(10),
        block_timestamp: "2026-08-18T15:40:20.000000Z", transaction_hash: "0xfund3" },
      { topics: [TOPIC_FUNDED, word(1002)], data: word(15),
        block_timestamp: "2026-08-18T15:40:10.000000Z", transaction_hash: "0xfund2" },
      { topics: [TOPIC_FUNDED, word(1001)], data: word(25),
        block_timestamp: "2026-08-18T15:40:02.000000Z", transaction_hash: "0xfund1" },
    ],
  },
  transfers: {
    items: [
      { timestamp: "2026-08-18T15:40:02.000000Z", method: "fund",
        from: { hash: "0xBA98546Ea9E60Ff469bE7735c0a482C86865aa71" },
        to: { hash: BB }, total: { decimals: "0", value: "10" },
        transaction_hash: "0x825d6d21aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { timestamp: "2026-08-18T15:39:50.000000Z", method: "mint",
        from: { hash: "0x0000000000000000000000000000000000000000" },
        to: { hash: "0xBA98546Ea9E60Ff469bE7735c0a482C86865aa71" },
        total: { decimals: "0", value: "50" },
        transaction_hash: "0xmintbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    ],
  },
  runs: {
    workflow_runs: [
      { run_number: 3, event: "schedule", status: "completed", conclusion: "success",
        created_at: "2026-08-17T14:17:00Z", html_url: "https://github.com/x/runs/3" },
      { run_number: 2, event: "workflow_dispatch", status: "completed", conclusion: "failure",
        created_at: "2026-08-10T14:17:00Z", html_url: "https://github.com/x/runs/2" },
    ],
  },
  tasks: {
    tasks: [
      { issueId: 1001, title: "Add negative-path tests for BountyBoard.fund", rewardMC: 25 },
      { issueId: 1002, title: "Add a registry JSON-shape check to npm test", rewardMC: 15 },
      { issueId: 1003, title: "Docs pass on merged-public README", rewardMC: 10 },
    ],
  },
};

function stubFetch(url, opts = {}) {
  const respond = (json) =>
    Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(json),
      headers: { get: () => null },
    });
  if (url.includes("rpc.mainnet")) {
    const { method, params } = JSON.parse(opts.body);
    if (method === "eth_blockNumber") return respond({ jsonrpc: "2.0", id: 1, result: "0x2664a51" });
    if (method === "eth_call") {
      const data = params[0].data;
      if (data === "0x18160ddd") return respond({ jsonrpc: "2.0", id: 1, result: word(50) });
      if (data.startsWith("0x70a08231")) return respond({ jsonrpc: "2.0", id: 1, result: word(50) });
    }
    return respond({ jsonrpc: "2.0", id: 1, result: "0x" });
  }
  if (url.includes("/api/v2/addresses/") && url.includes("/logs")) return respond(FIXTURES.logs);
  if (url.includes("/api/v2/tokens/") && url.includes("/transfers")) return respond(FIXTURES.transfers);
  if (url.includes(`/api/v2/tokens/${MC}`)) return respond({ holders_count: "1" });
  if (url.includes("/api/v2/tokens/0x5D000b")) return respond({ holders_count: "1" });
  if (url.includes("actions/workflows/mp-fleet.yml/runs")) return respond(FIXTURES.runs);
  if (url.includes("contents/agents/tasks.json")) {
    const b64 = Buffer.from(JSON.stringify(FIXTURES.tasks), "utf8").toString("base64");
    return respond({ content: b64, encoding: "base64" });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), headers: { get: () => null } });
}

async function loadBoard() {
  const html = readFileSync(resolve(root, "fleet-board/index.html"), "utf8");
  const js = readFileSync(resolve(root, "fleet-board/board.js"), "utf8");
  const window = new Window({
    url: "https://www.mergedpublic.com/fleet/",
    settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  window.__FLEET_BOARD_NO_AUTOSTART__ = true; // drive ticks manually
  window.fetch = stubFetch;
  window.document.write(html);
  await window.happyDOM.waitUntilComplete();
  window.eval(js);
  // Live default is board: null (pre-deploy). Tests exercise the wired state;
  // the pending state has its own test that leaves this unset.
  window.FleetBoard.CFG.contracts.board = BB;
  return { window, document: window.document, board: window.FleetBoard };
}

describe("fleet board page", () => {
  it("carries the standing compliance language and never the forbidden framing", () => {
    const html = readFileSync(resolve(root, "fleet-board/index.html"), "utf8");
    expect(html).toMatch(/payment for verified work, never for holding/);
    expect(html).toMatch(/MC\s+settles only when work merges/);
    expect(html).toMatch(/Settlement reaches wallets holding a Merged\s+Public identity only/);
    for (const gone of ["bayou", "gator", "silicon"]) {
      expect(html.toLowerCase()).not.toContain(gone);
    }
    expect(html).toMatch(/Not endorsed by Robinhood/);
    expect(html).toMatch(/it holds no keys, signs nothing, and never pays/);
    const lower = html.toLowerCase();
    for (const banned of ["apy", "staking", "guaranteed return", "guaranteed yield", "paid out to holders", "passive income"]) {
      expect(lower).not.toContain(banned === "apy" ? "% apy" : banned);
    }
    // "No yield, no APY" as a prohibition is the ONLY place those words appear
    expect(html.match(/APY/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("renders all four panels and the source link", () => {
    const html = readFileSync(resolve(root, "fleet-board/index.html"), "utf8");
    for (const id of ["panel-supply", "panel-demand", "panel-pipeline", "panel-ledger"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Dozier-Tech-Group/merged-public-archive/tree/main/fleet-board");
  });

  it("normalizes a slashless URL before relative assets resolve", () => {
    // Azure SWA serves physical dirs at both /fleet and /fleet/ (route rules
    // lose to physical content); the head guard must redirect the former.
    const html = readFileSync(resolve(root, "fleet-board/index.html"), "utf8");
    const guard = html.indexOf("location.replace(location.pathname");
    const css = html.indexOf('<link rel="stylesheet" href="board.css">');
    expect(guard).toBeGreaterThan(-1);
    expect(css).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(css); // guard runs before any asset reference
    expect(html).toContain("\\.html$"); // .html paths (local preview) exempt
  });
});

describe("fleet board data pipeline (stubbed sources)", () => {
  it("decodes bounties from raw BountyBoard logs", async () => {
    const { board } = await loadBoard();
    const bounties = board.decodeBounties(FIXTURES.logs.items);
    expect(bounties.length).toBe(3);
    const b1003 = bounties.find((b) => b.issueId === "1003");
    expect(b1003.settled).toBe(true);
    expect(b1003.winner).toBe("0x1111111111111111111111111111111111111111");
    expect(b1003.reward).toBe("10");
    const b1001 = bounties.find((b) => b.issueId === "1001");
    expect(b1001.settled).toBe(false);
    expect(b1001.reward).toBe("25");
  });

  it("classifies MC transfers by rail semantics", async () => {
    const { board } = await loadBoard();
    expect(board.classifyTransfer(FIXTURES.transfers.items[0], BB).kind).toBe("FUND");
    expect(board.classifyTransfer(FIXTURES.transfers.items[1], BB).kind).toBe("MINT");
    expect(board.classifyTransfer(
      { from: { hash: BB }, to: { hash: "0x2222222222222222222222222222222222222222" } }, BB,
    ).kind).toBe("WITHDRAW");
  });

  it("runs a full tick and renders live rows into the DOM", async () => {
    const { board, document } = await loadBoard();
    await board.chainTick();
    await board.githubTick();
    await board.loadTaskTitles();

    const text = document.body.textContent;
    expect(document.getElementById("block-height").textContent).toBe("40,258,129");
    expect(text).toContain("MC SUPPLY");
    expect(text).toContain("Add negative-path tests for BountyBoard.fund");
    expect(text).toContain("25 MC");
    expect(text).toContain("OPEN");
    expect(text).toContain("FUND ESCROW → MP BOARD");
    expect(text).toContain("MINT →");
    expect(text).toContain("PASS");
    expect(text).toContain("FAILURE");
    expect(text).toContain("MC SETTLES ONLY WHEN WORK MERGES");
    // supply figures rendered as live numbers, not dashes
    expect(document.getElementById("supply-figures").textContent).toContain("10,000");
  });

  it("shows honest empty states only after sources actually answered", async () => {
    const { board, document } = await loadBoard();
    board.state.scoutTick = Date.now();
    board.state.githubTick = Date.now();
    board.state.bounties = [];
    board.state.transfers = [];
    board.state.runs = [];
    board.renderAll();
    const text = document.body.textContent;
    expect(text).toContain("QUEUE CLEAR");
    expect(text).toContain("NO CREDIT MOVEMENTS YET");
    expect(text).toContain("NO FLEET RUNS RECORDED YET");
  });

  it("never claims an empty queue when Blockscout is unreachable", async () => {
    const { board, document, window } = await loadBoard();
    window.fetch = (url, opts) =>
      String(url).includes("/api/v2/")
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}), headers: { get: () => null } })
        : stubFetch(url, opts);
    await board.githubTick(); // a GitHub-first render must not fake chain facts
    let text = document.body.textContent;
    expect(text).not.toContain("QUEUE CLEAR");
    expect(text).not.toContain("NO CREDIT MOVEMENTS YET");
    await board.chainTick(); // RPC ok, Blockscout 500s
    text = document.body.textContent;
    expect(text).not.toContain("QUEUE CLEAR");
    expect(text).not.toContain("NO CREDIT MOVEMENTS YET");
    expect(text).toContain("SOURCE UNREACHABLE");
    expect(document.getElementById("block-height").textContent).toBe("40,258,129"); // chain data still live
    expect(document.getElementById("supply-figures").textContent).not.toMatch(/OPEN BOUNTIES\s*0/);
  });

  it("shows the honest pending state while the board is undeployed", async () => {
    const { board, document } = await loadBoard();
    board.CFG.contracts.board = null; // the live pre-deploy default
    await board.chainTick();
    const text = document.body.textContent;
    expect(text).toContain("BOARD DEPLOYING");
    expect(text).not.toContain("QUEUE CLEAR");
    expect(text).toContain("MP BOARD DEPLOYING"); // ticker
    // chain + supply still live without the board
    expect(document.getElementById("block-height").textContent).toBe("40,258,129");
    expect(document.getElementById("supply-figures").textContent).toContain("10,000");
  });

  it("follows Blockscout pagination so old bounties never fall off the board", async () => {
    const page2Funded = { topics: [TOPIC_FUNDED, word(1000)], data: word(40),
      block_timestamp: "2026-08-01T00:00:00.000000Z", transaction_hash: "0xfund0" };
    const paged = (url) => {
      const isPage2 = String(url).includes("block_number=");
      return Promise.resolve({
        ok: true, status: 200, headers: { get: () => null },
        json: () => Promise.resolve(
          isPage2
            ? { items: [page2Funded], next_page_params: null }
            : { items: FIXTURES.logs.items, next_page_params: { block_number: 1, index: 0, items_count: 50 } },
        ),
      });
    };
    const { board, window } = await loadBoard();
    window.fetch = paged;
    const all = await board.scoutAll("/addresses/x/logs");
    expect(all.length).toBe(FIXTURES.logs.items.length + 1);
    const bounties = board.decodeBounties(all);
    const b1000 = bounties.find((x) => x.issueId === "1000");
    expect(b1000).toBeTruthy();
    expect(b1000.reward).toBe("40");
  });
});
