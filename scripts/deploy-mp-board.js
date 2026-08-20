/**
 * Deploy MergedPublicBoard — the MP-native work board.
 *
 *   npx hardhat run scripts/deploy-mp-board.js --network robinhood
 *
 * Gate = the Merged Public collection (identity), credit = the existing
 * MergedCredit. No new token: MC carries over; only the board is new.
 * Records deployments/mp-board.robinhood.json.
 */
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");
const hre = require("hardhat");

// MergedCredit (MC), 0-decimals ERC-20, deployed 2026-08-18, source-verified
// on Blockscout. MC predates this repo, so its address is pinned here.
const MERGED_CREDIT = "0x040f12C71ddA0bA9D91E94016ea5C348106ab429";

const MP_PATH = join(__dirname, "..", "deployments", "merged-public.robinhood.json");
const RECORD_PATH = join(__dirname, "..", "deployments", "mp-board.robinhood.json");

async function main() {
  if (existsSync(RECORD_PATH) && process.env.REDEPLOY !== "1") {
    throw new Error(`Refusing: ${RECORD_PATH} already exists. Set REDEPLOY=1 only if you truly want a second board.`);
  }
  const credits = { credit: MERGED_CREDIT };
  const mp = JSON.parse(readFileSync(MP_PATH, "utf8"));
  if (!mp.address) throw new Error("Missing MP address in deployments/merged-public.robinhood.json.");

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set PRIVATE_KEY in .env (never paste the key into chat).");

  console.log("Network :", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Credit  :", credits.credit, "(existing MergedCredit)");
  console.log("Identity:", mp.address, "(Merged Public)");

  const factory = await hre.ethers.getContractFactory("MergedPublicBoard");
  const board = await factory.deploy(credits.credit, mp.address);
  await board.waitForDeployment();
  const address = await board.getAddress();
  const deployTx = board.deploymentTransaction();
  console.log("MergedPublicBoard deployed:", address);

  const record = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    contract: "MergedPublicBoard",
    address,
    credit: credits.credit,
    identity: mp.address,
    deployer: deployer.address,
    deployTx: deployTx ? deployTx.hash : null,
    explorer: `https://robinhoodchain.blockscout.com/address/${address}`,
    note: "MP-native work board: settlement and withdraw gated on holding a Merged Public identity. Payment for verified work, never for holding. Replaces the retired BAYOU-gated BountyBoard (see credits.json windDown).",
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log("Wrote", RECORD_PATH);
  console.log(`
NEXT:
  1. Verify source on Blockscout (standard-input API works keyless).
  2. transferOwnership to the operator if deployed from another key.
  3. Fund the first MP bounties: MC approve(board) then fund(issueId, reward).`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
