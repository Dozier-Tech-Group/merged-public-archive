/* ── Fleet Operations Board — board.js ──────────────────────────────────
 *
 * Everything this board shows is read by YOUR browser, directly, from
 * public sources. There is no backend, no database, no analytics:
 *
 *   1. Robinhood Chain JSON-RPC  — live contract state (eth_call)
 *   2. Blockscout REST API       — decoded history (holders, transfers, logs)
 *   3. GitHub public API         — the MP fleet's CI runs and the task mirror
 *
 * The board reports; it never pays. It holds no keys, signs nothing, and
 * cannot move anything. Read it top to bottom — it is meant to be read.
 */
(() => {
  "use strict";

  /* ── configuration ────────────────────────────────────────────────────
   * Record of truth for every address: deployments/merged-public.robinhood.json
   * and deployments/mp-board.robinhood.json in this repo
   * (Dozier-Tech-Group/merged-public-archive). Trust no address that is not
   * in those files. */
  const CFG = {
    chainId: 4663,
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    scout: "https://robinhoodchain.blockscout.com",
    repo: "Dozier-Tech-Group/merged-public-archive",
    contracts: {
      credit:      "0x040f12C71ddA0bA9D91E94016ea5C348106ab429", // MergedCredit (MC), ERC-20, 0 decimals
      // MergedPublicBoard — set from deployments/mp-board.robinhood.json the
      // moment it deploys. null renders the honest "deploying" state; the
      // board never invents an address.
      board:       null,
      mergedPublic:"0x5D000b230653E416FF41451525b144a6C2Ad7178", // Merged Public (MP), ERC-721
    },
    // Fixed at mint: all 10,000 sealed at launch. A historical fact, not a
    // live read — holders ARE read live.
    minted: { mergedPublic: 10000 },
    chainTickSeconds: 60,   // one on-chain sweep per minute
    githubTickSeconds: 300, // GitHub every 5 min (keyless quota: 60 req/hr/IP)
  };

  const RECORD_URL = "https://github.com/Dozier-Tech-Group/merged-public-archive/blob/main/deployments/mp-board.robinhood.json";
  const BOARD_PENDING = "BOARD DEPLOYING — THE RECORD LANDS IN deployments/mp-board.robinhood.json";

  /* keccak256 topic0 for the three MergedPublicBoard events the board
   * decodes (identical signatures to the audited board lineage).
   * Recomputable with ethers.id("Funded(uint256,uint256)") etc. */
  const TOPIC = {
    funded:    "0xa1dd612b9278fe0bb5d89ed1f642dc3678d0e558630c5a4a8df212ba2197cdb4", // Funded(uint256 indexed issueId, uint256 reward)
    settled:   "0x2c35d68fdf40b18e913bb877373b4a4fc67810e2546dc5c9f9208eb8494057cb", // Settled(uint256 indexed issueId, address indexed winner, uint256 reward)
    withdrawn: "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5", // Withdrawn(address indexed account, uint256 amount)
  };

  /* 4-byte selectors for the eth_call reads (first 4 bytes of keccak256 of
   * the function signature). */
  const SEL = {
    totalSupply: "0x18160ddd",            // totalSupply()
    balanceOf:   "0x70a08231",            // balanceOf(address)
  };

  /* ── tiny helpers ─────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const short = (addr) => addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "—";
  const low = (s) => String(s || "").toLowerCase();
  const ZERO = "0x0000000000000000000000000000000000000000";

  const timeAgo = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return Math.round(s) + "S AGO";
    if (s < 5400) return Math.round(s / 60) + "M AGO";
    if (s < 129600) return Math.round(s / 3600) + "H AGO";
    return Math.round(s / 86400) + "D AGO";
  };

  /* last 20 bytes of a 32-byte topic word = the address it encodes */
  const topicToAddress = (topic) => "0x" + topic.slice(-40);
  const wordToBigInt = (hex) => (hex && hex !== "0x" ? BigInt(hex) : 0n);

  const txUrl = (hash) => `${CFG.scout}/tx/${hash}`;
  const addrUrl = (addr) => `${CFG.scout}/address/${addr}`;
  const tokenUrl = (addr) => `${CFG.scout}/token/${addr}`;

  /* ── data sources ─────────────────────────────────────────────────── */

  /* JSON-RPC: the rawest possible read — POST a method name and params,
   * the chain answers. This is all a "web3 library" does underneath. */
  async function rpc(method, params) {
    const res = await fetch(CFG.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`rpc: ${body.error.message}`);
    return body.result;
  }

  /* eth_call = run a read-only contract function. `data` is the function
   * selector plus ABI-encoded arguments. */
  const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const pad32 = (addr) => addr.toLowerCase().replace("0x", "").padStart(64, "0");

  /* Blockscout REST: indexed, decoded history. Plain fetch, no key, no
   * credentials (its CORS policy requires anonymous requests). */
  async function scout(path) {
    const res = await fetch(`${CFG.scout}/api/v2${path}`);
    if (!res.ok) throw new Error(`blockscout ${res.status} ${path}`);
    return res.json();
  }

  /* Follow Blockscout pagination: each page hands back next_page_params to
   * append as query params. Capped so one tick stays bounded. */
  async function scoutAll(path, maxPages = 10) {
    const items = [];
    let params = null;
    for (let i = 0; i < maxPages; i++) {
      const qs = params
        ? (path.includes("?") ? "&" : "?") +
          new URLSearchParams(
            Object.entries(params).filter(([, v]) => v !== null && v !== undefined),
          ).toString()
        : "";
      const page = await scout(path + qs);
      items.push(...(page.items || []));
      params = page.next_page_params;
      if (!params) break;
    }
    return items; // newest-first across all pages, as Blockscout returns them
  }

  /* GitHub REST with a tiny ETag cache: a 304 answer is free — it does not
   * count against the keyless 60-requests-per-hour budget. */
  const etags = new Map();
  async function github(path) {
    const url = `https://api.github.com/${path}`;
    const known = etags.get(url);
    const headers = { accept: "application/vnd.github+json" };
    if (known) headers["if-none-match"] = known.etag;
    const res = await fetch(url, { headers });
    if (res.status === 304 && known) return known.body;
    if (!res.ok) throw new Error(`github ${res.status} ${path}`);
    const body = await res.json();
    const etag = res.headers.get("etag");
    if (etag) etags.set(url, { etag, body });
    return body;
  }

  /* ── decoding (pure functions — unit-tested in test/fleet-board.test.js) ── */

  /* Rebuild the bounty book from the MergedPublicBoard's raw event log.
   * Funded fires exactly once per bounty ever; Settled marks the winner. */
  function decodeBounties(logItems) {
    const book = new Map();
    for (const item of [...logItems].reverse()) { // oldest first
      const t0 = low(item.topics?.[0]);
      if (t0 === TOPIC.funded) {
        const issueId = wordToBigInt(item.topics[1]).toString();
        book.set(issueId, {
          issueId,
          reward: wordToBigInt(item.data).toString(),
          settled: false,
          winner: null,
          fundedAt: item.block_timestamp || null,
          txHash: item.transaction_hash || item.tx_hash || null,
        });
      } else if (t0 === TOPIC.settled) {
        const issueId = wordToBigInt(item.topics[1]).toString();
        const b = book.get(issueId);
        if (b) {
          b.settled = true;
          b.winner = topicToAddress(item.topics[2]);
          b.settledTx = item.transaction_hash || item.tx_hash || null;
        }
      }
    }
    return [...book.values()].reverse(); // newest first
  }

  /* Label an MC transfer by what it actually is on this rail. */
  function classifyTransfer(item, board) {
    const from = low(item.from?.hash);
    const to = low(item.to?.hash);
    const bb = board ? low(board) : " no-board"; // never matches when unset
    if (from === low(ZERO)) return { kind: "MINT", cls: "st-done", text: `MINT → ${short(item.to?.hash)}` };
    if (to === bb) return { kind: "FUND", cls: "st-work", text: "FUND ESCROW → MP BOARD" };
    if (from === bb) return { kind: "WITHDRAW", cls: "st-open", text: `WITHDRAW → ${short(item.to?.hash)}` };
    return { kind: "TRANSFER", cls: "st-done", text: `${short(item.from?.hash)} → ${short(item.to?.hash)}` };
  }

  /* Label a CI run for the board. */
  function classifyRun(run) {
    if (run.status !== "completed") return { cls: "st-work", text: "RUNNING" };
    if (run.conclusion === "success") return { cls: "st-open", text: "PASS" };
    if (run.conclusion === "skipped") return { cls: "st-done", text: "SKIPPED" };
    if (run.conclusion === "cancelled") return { cls: "st-done", text: "CANCELLED" };
    return { cls: "st-fail", text: String(run.conclusion || "UNKNOWN").toUpperCase() };
  }

  /* ── state ────────────────────────────────────────────────────────── */
  const state = {
    block: null,
    mcSupply: null,
    mcEscrow: null,
    holders: { credit: null, mergedPublic: null },
    bounties: [],
    transfers: [],
    runs: [],
    taskTitles: new Map(), // issueId -> title, from agents/tasks.json
    sources: { chain: "pending", scout: "pending", github: "pending" },
    // Set only when the matching source has ACTUALLY answered. "No data yet"
    // and "verified empty" are different facts and render differently.
    scoutTick: null,
    githubTick: null,
    lastTick: null,
  };

  /* Three-way placeholder: verified data may be empty; anything else is
   * either still loading or a source outage — never claim a false zero. */
  function placeholderRow(cols, source, reading, emptyText) {
    const text =
      source === "fail" ? "SOURCE UNREACHABLE — RETRYING…"
      : source === "pending" ? reading
      : emptyText;
    return `<tr class="placeholder"><td colspan="${cols}">${text}</td></tr>`;
  }

  /* ── rendering ────────────────────────────────────────────────────── */

  function renderSupply() {
    const board = CFG.contracts.board;
    const boardHref = board ? addrUrl(board) : RECORD_URL;
    const open = state.bounties.filter((b) => !b.settled).length;
    const settled = state.bounties.filter((b) => b.settled).length;
    const fig = (label, value, href, title) => `
      <div class="fig">
        <dt>${esc(label)}</dt>
        <dd${title ? ` title="${esc(title)}"` : ""}><a href="${esc(href)}" target="_blank" rel="noopener">${value}</a></dd>
      </div>`;
    const live = (v) => (v === null ? "&mdash;" : esc(fmt(v)));
    $("supply-figures").innerHTML =
      fig("MP ARCHIVE MINTED", fmt(CFG.minted.mergedPublic), tokenUrl(CFG.contracts.mergedPublic), "Fixed at mint — all 10,000 sealed at launch") +
      fig("MP HOLDERS", live(state.holders.mergedPublic), tokenUrl(CFG.contracts.mergedPublic)) +
      fig("MC SUPPLY", live(state.mcSupply), tokenUrl(CFG.contracts.credit), "Merged Credits minted, read via eth_call") +
      fig("MC IN ESCROW", live(state.mcEscrow), boardHref, "MC held in MergedPublicBoard escrow") +
      fig("OPEN BOUNTIES", board && state.scoutTick ? esc(fmt(open)) : "&mdash;", boardHref) +
      fig("SETTLED", board && state.scoutTick ? esc(fmt(settled)) : "&mdash;", boardHref);
  }

  function renderDemand() {
    const rows = state.bounties.map((b) => {
      const title = state.taskTitles.get(b.issueId) || `ISSUE #${b.issueId}`;
      const status = b.settled
        ? `<span class="st st-done">SETTLED → ${esc(short(b.winner))}</span>`
        : `<span class="st st-open">OPEN</span>`;
      const verify = b.txHash
        ? `<a class="txlink" href="${esc(txUrl(b.txHash))}" target="_blank" rel="noopener">TX ⧉</a>`
        : `<a class="txlink" href="${esc(CFG.contracts.board ? addrUrl(CFG.contracts.board) : RECORD_URL)}" target="_blank" rel="noopener">CONTRACT ⧉</a>`;
      return `<tr>
        <td>${esc(b.issueId)}</td>
        <td class="desc">${esc(title)}</td>
        <td>${esc(fmt(b.reward))} MC</td>
        <td>${status}</td>
        <td>${verify}</td>
      </tr>`;
    });
    $("demand-rows").innerHTML = !CFG.contracts.board
      ? `<tr class="placeholder"><td colspan="5">${BOARD_PENDING}</td></tr>`
      : rows.length
        ? rows.join("")
        : placeholderRow(5, state.scoutTick ? "ok" : state.sources.scout,
            "READING THE EVENT LOG…", "QUEUE CLEAR — NO BOUNTIES FUNDED ON THE BOARD");
  }

  function renderLedger() {
    const rows = state.transfers.slice(0, 12).map((t) => {
      const c = classifyTransfer(t, CFG.contracts.board);
      return `<tr>
        <td>${esc(timeAgo(t.timestamp))}</td>
        <td><span class="st ${c.cls}">${esc(c.text)}</span></td>
        <td>${esc(fmt(t.total?.value ?? 0))} MC</td>
        <td><a class="txlink" href="${esc(txUrl(t.transaction_hash))}" target="_blank" rel="noopener">${esc(short(t.transaction_hash))} ⧉</a></td>
      </tr>`;
    });
    $("ledger-rows").innerHTML = rows.length
      ? rows.join("")
      : placeholderRow(4, state.scoutTick ? "ok" : state.sources.scout,
          "READING TOKEN TRANSFERS…", "NO CREDIT MOVEMENTS YET");
  }

  function renderPipeline() {
    const rows = state.runs.slice(0, 8).map((r) => {
      const c = classifyRun(r);
      const kind = r.event === "schedule" ? "CRON" : "MANUAL";
      return `<tr>
        <td><a class="txlink" href="${esc(r.html_url)}" target="_blank" rel="noopener">#${esc(r.run_number)} ${kind} ⧉</a></td>
        <td><span class="st ${c.cls}">${esc(c.text)}</span></td>
        <td>${esc(timeAgo(r.created_at))}</td>
      </tr>`;
    });
    $("pipeline-rows").innerHTML = rows.length
      ? rows.join("")
      : placeholderRow(3, state.githubTick ? "ok" : state.sources.github,
          "READING GITHUB ACTIONS…", "NO FLEET RUNS RECORDED YET");
  }

  function renderTicker() {
    const parts = [];
    if (state.block !== null) parts.push(`BLOCK ${fmt(state.block)}`);
    if (state.mcSupply !== null) parts.push(`MC SUPPLY ${fmt(state.mcSupply)}`);
    if (state.mcEscrow !== null) parts.push(`IN ESCROW ${fmt(state.mcEscrow)}`);
    if (!CFG.contracts.board) {
      parts.push("MP BOARD DEPLOYING");
    } else if (state.scoutTick) {
      parts.push(`OPEN BOUNTIES ${state.bounties.filter((b) => !b.settled).length}`);
      parts.push(`SETTLED ${state.bounties.filter((b) => b.settled).length}`);
    }
    const run = state.runs[0];
    if (run) parts.push(`LAST FLEET RUN ${classifyRun(run).text} ${timeAgo(run.created_at)}`);
    const t = state.transfers[0];
    if (t) {
      const c = classifyTransfer(t, CFG.contracts.board);
      parts.push(`LATEST MOVEMENT: ${c.text} ${fmt(t.total?.value ?? 0)} MC`);
    }
    parts.push("MC SETTLES ONLY WHEN WORK MERGES");
    const line = parts.join(" · ") + " · ";
    // Doubled + translateX(-50%) = a seamless loop; reduced-motion gets the
    // line once, statically, so nothing reads duplicated.
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("ticker").textContent = reduced ? line : line + line;
  }

  function renderStatus() {
    const vals = Object.values(state.sources);
    const dot = $("live-dot");
    const label = $("live-label");
    dot.classList.remove("live", "stale", "down");
    if (vals.every((v) => v === "ok")) {
      dot.classList.add("live");
      label.textContent = "LIVE";
    } else if (vals.some((v) => v === "ok")) {
      dot.classList.add("stale");
      const bad = Object.entries(state.sources).filter(([, v]) => v === "fail").map(([k]) => k.toUpperCase());
      label.textContent = `DEGRADED — ${bad.join("+") || "PARTIAL"}`;
    } else if (vals.every((v) => v === "pending")) {
      label.textContent = "CONNECTING";
    } else {
      dot.classList.add("down");
      label.textContent = "SOURCES UNREACHABLE — RETRYING";
    }
  }

  function renderAll() {
    renderSupply();
    renderDemand();
    renderLedger();
    renderPipeline();
    renderTicker();
    renderStatus();
  }

  /* ── the ticks ────────────────────────────────────────────────────── */

  /* One on-chain sweep: raw RPC reads + Blockscout reads. Each group fails
   * independently — a dead indexer never blanks live chain data. Reads that
   * need the MergedPublicBoard address are skipped until it deploys. */
  async function chainTick() {
    const c = CFG.contracts;
    try {
      const calls = [rpc("eth_blockNumber", []), ethCall(c.credit, SEL.totalSupply)];
      if (c.board) calls.push(ethCall(c.credit, SEL.balanceOf + pad32(c.board)));
      const [blockHex, supplyHex, escrowHex] = await Promise.all(calls);
      state.block = Number(BigInt(blockHex));
      state.mcSupply = Number(wordToBigInt(supplyHex)); // MC has 0 decimals: 1 unit = 1 credit
      state.mcEscrow = c.board ? Number(wordToBigInt(escrowHex)) : null;
      state.sources.chain = "ok";
      $("block-height").textContent = fmt(state.block);
    } catch (e) {
      state.sources.chain = "fail";
      console.log("[fleet-board] chain read failed:", e.message);
    }

    try {
      const reads = [
        scout(`/tokens/${c.credit}`),
        scout(`/tokens/${c.mergedPublic}`),
        scout(`/tokens/${c.credit}/transfers`),
      ];
      if (c.board) reads.push(scoutAll(`/addresses/${c.board}/logs`)); // paginated: old bounties never fall off
      const [mc, mp, transfers, logs] = await Promise.all(reads);
      state.holders.credit = Number(mc.holders_count ?? mc.holders) || 0;
      state.holders.mergedPublic = Number(mp.holders_count ?? mp.holders) || 0;
      state.bounties = c.board ? decodeBounties(logs) : [];
      state.transfers = transfers.items || [];
      state.sources.scout = "ok";
      state.scoutTick = Date.now();
    } catch (e) {
      state.sources.scout = "fail";
      console.log("[fleet-board] blockscout read failed:", e.message);
    }

    state.lastTick = state.sources.chain === "ok" || state.sources.scout === "ok" ? Date.now() : state.lastTick;
    renderAll();
  }

  /* GitHub sweep: the archive repo's CI runs (the MP fleet works here), plus
   * (once) the task mirror that gives bounties their human titles. */
  async function githubTick() {
    try {
      const runs = await github(`repos/${CFG.repo}/actions/runs?per_page=8`);
      state.runs = runs.workflow_runs || [];
      state.sources.github = "ok";
      state.githubTick = Date.now();
    } catch (e) {
      state.sources.github = "fail";
      console.log("[fleet-board] github read failed:", e.message);
    }
    renderAll();
  }

  async function loadTaskTitles() {
    try {
      const file = await github(`repos/${CFG.repo}/contents/tasks.json`);
      const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (ch) => ch.charCodeAt(0));
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      for (const task of doc.tasks || []) state.taskTitles.set(String(task.issueId), task.title);
      renderDemand();
    } catch (e) {
      console.log("[fleet-board] tasks.json unavailable (titles fall back to issue ids):", e.message);
    }
  }

  /* ── clock, countdown, scheduling ─────────────────────────────────── */

  let nextChainTick = 0;
  let nextGithubTick = 0;

  function clockTick() {
    const now = new Date();
    $("clock").textContent = now.toISOString().slice(11, 19) + " UTC";
    const left = Math.max(0, Math.round((nextChainTick - Date.now()) / 1000));
    $("tick-countdown").textContent = left + "S";
  }

  function init() {
    if (new URLSearchParams(location.search).has("embed")) {
      document.body.classList.add("embed");
      // inside an <iframe>, links must escape the frame
      document.querySelectorAll("a").forEach((a) => { if (!a.target) a.target = "_top"; });
    }

    clockTick();
    setInterval(clockTick, 1000);

    const runChain = () => { nextChainTick = Date.now() + CFG.chainTickSeconds * 1000; chainTick(); };
    const runGithub = () => { nextGithubTick = Date.now() + CFG.githubTickSeconds * 1000; githubTick(); };
    runChain();
    runGithub();
    loadTaskTitles();

    setInterval(() => { if (!document.hidden) runChain(); }, CFG.chainTickSeconds * 1000);
    setInterval(() => { if (!document.hidden) runGithub(); }, CFG.githubTickSeconds * 1000);
    document.addEventListener("visibilitychange", () => {
      // returning to a hidden tab whose data went stale: refresh immediately
      if (!document.hidden && Date.now() > nextChainTick) runChain();
      if (!document.hidden && Date.now() > nextGithubTick) runGithub();
    });
  }

  /* Exposed for the test harness (test/fleet-board.test.js) and for anyone
   * poking around in the console — the whole pipeline is inspectable. */
  window.FleetBoard = {
    CFG, TOPIC, SEL, state,
    decodeBounties, classifyTransfer, classifyRun, scoutAll,
    chainTick, githubTick, loadTaskTitles, renderAll, init,
  };

  if (!window.__FLEET_BOARD_NO_AUTOSTART__) init();
})();
