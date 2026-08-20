# The Merged Public fleet

The rail by which people who hold a Merged Public identity — and the AI
agents they run — work funded bounties in public CI, open pull requests, and
get settled on-chain after a human merges the work.

This file describes what is in this repository today. Every step below
resolves to a file you can read, a command you can run, or a contract call
you can make yourself. Where the rail is dormant, this file says so and says
which precondition is missing, because a rail that pretends to be running is
worse than one that is honestly stopped.

**Nothing here pays anyone for holding anything.** Merged Credits (MC)
settle only when work merges: payment for verified work, never for holding.

## The parts

| Path | What it is |
| --- | --- |
| [`registry.json`](registry.json) | The verified holder bindings — wallet to GitHub account. Empty today. |
| [`tasks.json`](tasks.json) | The off-chain mirror of the on-chain work queue. Empty today. |
| [`run-agent.mjs`](run-agent.mjs) | The runner: works exactly one funded task per run and opens one pull request. Reads no key. |
| [`../scripts/link-mp.mjs`](../scripts/link-mp.mjs) | Two modes: `sign` (holder, local, touches the key) and `verify` (anyone, no key, no `.env`). |
| [`../.github/workflows/mp-fleet.yml`](../.github/workflows/mp-fleet.yml) | The dispatch. Dormant without the operator's API key secret. |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | The test gate for pull requests opened by people. No secrets, `contents: read`. |
| [`../contracts/MergedPublicBoard.sol`](../contracts/MergedPublicBoard.sol) | The board: `fund`, `settle`, `withdraw`. Not deployed. |
| [`../test/agents.test.js`](../test/agents.test.js) | Shape tests for the two JSON files, including the one that forbids claiming a bounty is funded while no board exists. |

Three addresses matter, and only two of them exist:

| Thing | Address |
| --- | --- |
| Merged Public (the identity gate) | `0x5D000b230653E416FF41451525b144a6C2Ad7178` on Robinhood Chain 4663 |
| Merged Credits (MC, 0-decimals ERC-20) | `0x040f12C71ddA0bA9D91E94016ea5C348106ab429` |
| `MergedPublicBoard` | **No address. Not deployed.** When it deploys, its address lands in `deployments/mp-board.robinhood.json` and is read from that file at runtime, by every tool, always. |

Trust no board address that is not in that record. Neither
`run-agent.mjs` nor `link-mp.mjs` contains one, and neither will guess.

## The lifecycle, end to end

Seven steps. Each one has a different actor, and the boundaries between
them are the point.

**1. A holder binds a wallet to a GitHub account, by signature.**
On their own machine, the holder signs the canonical message

```
Merged Public fleet link v1: github=<github> wallet=<wallet>
```

with the key of the wallet holding their identity. The signature is the
whole proof: anyone can recover the signing address from it, and nobody can
produce it without the key. The key never leaves that machine — it is not
printed, not written into the submitted block, and never enters CI. The
signed block goes up as a pull request against `registry.json`; a reviewer
re-runs the public verifier rather than taking anyone's word for it, and a
human merges. Registering is not payment and not a queue position.

**2. The operator funds a bounty on-chain.**
`MergedPublicBoard.fund(issueId, reward)` is `onlyOwner` and pulls MC from
the operator's own wallet into the board's escrow. Only after that
transaction is mined does the matching entry in `tasks.json` flip
`funded: true`. Never in advance, never as an intention — and while
`deployments/mp-board.robinhood.json` does not exist, `funded: true` is a
claim nothing could back, which is why `test/agents.test.js` fails the suite
if any task carries it.

**3. One CI run works one task.**
`mp-fleet.yml` runs weekly (Tuesdays 07:41 UTC) or on manual dispatch. It
checks the operator's API key first and skips everything below if it is
missing. `run-agent.mjs` then re-checks every precondition in order —
registry, board record, task queue, and finally the chain itself — before
any budget is spent. The chain is the authority on "funded": the runner
calls `bounties(issueId)` on the board and stops if the reward is zero or
the bounty is already settled. It also calls `balanceOf` and `ownerOf` on
Merged Public, so it refuses to spend budget on work that `settle` would
later revert on.

**4. The agent opens a pull request. That is all it does.**
Work happens on a branch named `mp/<tokenId>/task-<issueId>`, the pull
request is titled `[MP #<tokenId>] <task title>`, and the body names the
issue id, the identity, the wallet to settle to, and the board address read
from the deployment record. The agent cannot merge, cannot settle, and
cannot move a credit. If it produced no changes, the run stops and no pull
request is opened — no work, no claim.

Two guards run before anything is committed. The fleet job runs the
repository's own `npm test` in the work tree, and if it fails **no pull
request is opened at all** — the work did not pass, so it cannot earn. And
the files whose exact bytes are on-chain commitments (`deployments/`,
`generator/merged-public/provenance.json`, `metadata/mp/`,
`game/season-zero/manifest.json`) are protected by a mechanical `git diff`
check, not by a sentence in the agent's prompt: if the agent touched one,
the run stops and names the path.

**5. A human reviews and merges.**
**A pull request that breaks the tests does not merge, and therefore does
not earn.** For fleet pull requests that gate runs inside the fleet job
itself, before the request is ever opened — GitHub does not start
`pull_request` workflows for pull requests opened with its own job token,
so `ci.yml` would never have fired on them, and a gate that does not fire is
not a gate. `ci.yml` runs `npm test` on pull requests opened by people.
Merging is a human decision about whether the work is real; no automation in
this repository can make it.

**6. The operator settles on-chain, and the first settle wins.**
After the merge, the operator calls
`MergedPublicBoard.settle(issueId, winner)` from their own machine with the
owner or oracle key. There is no settle script in this repository and no CI
job that could run one. The contract checks exactly three things: the
bounty was funded, it is not already settled, and the winner holds a Merged
Public identity. It **cannot** judge whether the work was real — that
judgment was step 5, and it already happened. A second `settle` on the same
issue id reverts; the first one is final.

**7. The holder withdraws, and only while they still hold an identity.**
Settlement credits `claimable[winner]`; it does not push tokens anywhere.
The holder calls `withdraw()` themselves and the contract re-checks
`identity.balanceOf(msg.sender) > 0` at that moment, not at settlement time.
A wallet that sold its last identity keeps the `claimable` balance but
cannot pull it until that wallet holds an identity again. There is no
sweep, rescue, or refund function on the board, and pausing halts
withdrawals along with everything else. [`../SECURITY.md`](../SECURITY.md)
enumerates the rest of what the board cannot do.

## How to join

You need a wallet that holds at least one Merged Public identity, Node 20,
and this repository cloned.

```bash
npm install
cp .env.example .env      # then put PRIVATE_KEY in .env — it is gitignored
```

Sign the link message locally. This mode makes no network calls at all, and
writes the registry block to stdout and nothing else, so redirecting it
gives you a submittable file:

```bash
node scripts/link-mp.mjs sign --github <your-github-username> --tokens 12,3400 > entry.json
```

List the token ids you actually hold. An entry with none still verifies —
`balanceOf` is the gate — but the runner works *as* a specific identity and
will skip an entry that names none, saying so rather than picking one.

Check your own entry before you submit it. This mode needs no key, never
opens `.env`, and can be run by anyone, including a skeptic reading your
pull request:

```bash
node scripts/link-mp.mjs verify --file entry.json
```

It recovers the signer from the signature, refuses a duplicate wallet or
GitHub account, then reads chain 4663 to confirm `balanceOf(wallet) > 0` on
Merged Public and `ownerOf(id)` for every token id you claimed. It refuses
outright if the RPC reports a chain other than 4663, or if the deployment
record names a contract other than Merged Public. Override the endpoint
with `RH_RPC_URL` or `RPC_URL`; the default is
`https://rpc.mainnet.chain.robinhood.com`.

Then open a pull request adding the printed block to the `"agents"` array in
`registry.json`. A reviewer re-runs the verifier — `--write` is what appends
a checked entry to the file — and a human merges it. One wallet, one GitHub
account, once.

To rehearse the runner without side effects, at any time, key or no key:

```bash
DRY_RUN=1 node agents/run-agent.mjs
```

PowerShell: `$env:DRY_RUN = "1"; node agents/run-agent.mjs`. A dry run
clones nothing, edits nothing, commits nothing, pushes nothing, and opens
nothing. Today it stops at the registry and says so.

## What is dormant today, and exactly why

Three preconditions gate this rail. **All three are unmet as of
2026-08-20**, so every automated path is a stated no-op. This is the
expected state, not a broken one.

| Precondition | State today | Check it yourself |
| --- | --- | --- |
| The operator's `ANTHROPIC_API_KEY` secret | **Not configured.** The workflow's first step is a budget gate: with no key it writes "The MP fleet is DORMANT" to the run log and the job summary, and every later step — checkout included — is skipped. Nothing is cloned and nothing is changed. | Run the workflow from the Actions tab ("MP fleet" -> Run workflow) and read the gate step; until someone does, or the weekly cron fires, there is no run to read. |
| A verified holder in `registry.json` | **Empty.** `"agents": []`. The runner stops with "The registry lists no verified holders yet, nothing to run." It never invents a participant. | `registry.json` in this directory. `test/agents.test.js` asserts it is empty. |
| `deployments/mp-board.robinhood.json` | **Does not exist.** The board is not deployed, so there is no escrow, so **no bounty can be treated as funded** and nothing is workable or settleable. The runner stops and says which file is missing. | `ls deployments/` — one record, for the collection, not the board. |

Consequences worth stating rather than leaving to be discovered:

- `tasks.json` is empty, and no task in it may carry `funded: true` while
  the board record is absent. The test suite enforces that.
- Registering now changes none of the above. `link-mp.mjs verify` says so
  in its own output when the board record is missing.
- The weekly cron still fires. It costs nothing and produces a run whose
  log states the dormancy. That is the design: a silent skip and a stated
  stop look identical from outside, so this rail always states.

The runner's exit codes carry that distinction. A missing precondition is
**exit 0** with a plain sentence — dormant is normal. **Exit 1 or 2** is
reserved for a contradiction: a malformed input, a corrupt committed file,
or a deployment record pointing at a collection other than Merged Public.

## The trust boundary

Said plainly, because dressing it up would be its own kind of dishonesty.

- **The operator is the board's owner and its settlement oracle. That is a
  trusted role.** `settle(issueId, winner)` is callable by the owner or by
  an oracle address the owner sets. Whoever holds that key decides which
  wallet is recorded as having won a bounty. The contract verifies funding,
  non-settlement, and identity — nothing else. If that key is compromised
  or the operator acts in bad faith, funded credits can be settled to a
  wallet that did no work, provided that wallet holds an identity. Moving
  ownership to a multisig is the plan of record, with no date attached.
- **The fleet job's token never reaches the agent.** The checkout runs with
  `persist-credentials: false`, so no push-capable credential is left in the
  work tree, and the agent process is given an explicitly constructed
  environment that carries the model API key and not the GitHub token. The
  agent also never receives its instructions through a shell: every command
  the runner issues is an argument array, and the pull request body is
  handed over as a file, so nothing in a task title or a bounty description
  can execute or silently vanish.
- **Agent compute is paid by the operator, and that budget is the
  throttle.** There is no key, no fleet — the rail simply does not run.
  There is no rotation, no queue, and no entitlement: without a named
  agent, the first usable registry entry runs, one task per run, forty
  agent turns maximum, thirty CI minutes maximum, one run at a time. The
  ceiling on what the fleet can spend is the ceiling on how much work it
  can do, and this document will not imply otherwise.
- **No signing key ever enters CI.** The runner handles a wallet *address*
  and only to write it into a pull request body so the operator knows who to
  settle to. It reads no `.env`, requires no `PRIVATE_KEY`, and cannot
  settle, merge, or move a credit. The fleet job's write permissions are
  `contents: write` and `pull-requests: write` — enough to push a branch and
  open a pull request, and nothing more.
- **Dispatch inputs are data, not commands.** The `task` and `agent` inputs
  reach the runner only as the environment variables `MP_TASK` and
  `MP_AGENT`, never interpolated into a shell line, and the runner
  re-validates both shapes before either is used.
- **The Claude Code CLI is pinned to an exact version** in `run-agent.mjs`.
  A run holds an API key and a write token; a compromised upstream publish
  must not land in it silently. Bumping it is a reviewed commit.
- **The public record is the check on all of this.** Every fleet run, every
  pull request, every `Funded` and `Settled` and `Withdrawn` event is
  public. The transparency board at
  [mergedpublic.com/fleet](https://www.mergedpublic.com/fleet/) reads this
  repository's CI runs and `tasks.json` alongside the chain, with no backend
  of its own.

## The standing rules

These are commitments, not tone.

- **Merged Credits are payment for verified work, never for holding.**
  Nothing in this rail pays for owning a token.
- **MC settles only when work merges.** No accrual, no emission, no
  schedule, no distribution outside `MergedPublicBoard.settle`.
- **No yield, no APY, no returns, no price talk. Ever.** Not here, not in
  a pull request, not in a commit message.
- **Agents only open pull requests. Humans review and merge.** No
  automation in this repository can merge anything or settle anything.
- **A pull request that breaks the tests does not merge and does not
  earn.** `npm test` is the gate. For fleet work it runs inside the fleet
  job before a pull request is opened; for pull requests opened by people it
  runs in `ci.yml`.
- **The operator is also the settlement oracle, and that is a trusted
  role.** Stated plainly wherever settlement is described.
- **Never trust an address that is not in `deployments/`.** The board has
  no address today, so the correct output of any tool asked for one is a
  clear error.
- **No gate, feature, or migration is promised on a date.**
- Not a security, not a legal record, not a lottery. Anything touching
  real money waits on legal, tax, and payment review.
- Built on Robinhood Chain; **Robinhood has not endorsed, reviewed, or
  partnered with this project.**

For the trust model and the full enumeration of what the contracts cannot
do, read [`../SECURITY.md`](../SECURITY.md). For why Merged Public stands
alone, [`../DECOUPLING.md`](../DECOUPLING.md).
