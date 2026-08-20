const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");
const hre = require("hardhat");

const recordPath = (network) => join(__dirname, "..", "deployments", `merged-public.${network}.json`);

// Treasury supplied by the owner on 2026-08-18. Every token mints here.
const DEFAULT_TREASURY = "0xBCCAecdBb4F0c7af32C8018486D0b52A474d9B4a";
const MAX_SUPPLY = 10_000n;
const MAINNET_CONFIRM = "yes-mint-merged-public";

async function main() {
  const RECORD_PATH = recordPath(hre.network.name);
  if (!existsSync(RECORD_PATH)) {
    throw new Error(`HOLD: ${RECORD_PATH} not found. Deploy first (npm run deploy:mp:*).`);
  }
  const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  if (record.network !== hre.network.name) {
    throw new Error(
      `HOLD: record is for network "${record.network}" but you are on "${hre.network.name}".`
    );
  }

  // Gate on the chain id the NODE reports, not what the local config declares.
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (chainId === 4663 && process.env.MP_MINT_CONFIRM !== MAINNET_CONFIRM) {
    throw new Error(
      `HOLD: refusing to mint on mainnet (4663) without MP_MINT_CONFIRM="${MAINNET_CONFIRM}".`
    );
  }

  const treasury = hre.ethers.getAddress(process.env.MP_TREASURY || DEFAULT_TREASURY);
  const batchSize = BigInt(process.env.MP_BATCH_SIZE || "250");
  if (batchSize === 0n || batchSize > 250n) throw new Error("MP_BATCH_SIZE must be 1..250.");

  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No signer. Set PRIVATE_KEY in .env (never paste the key into chat).");

  const nft = await hre.ethers.getContractAt("MergedPublic", record.address, signer);
  const balance = await hre.ethers.provider.getBalance(signer.address);

  let next = await nft.nextTokenId();
  console.log("Network   :", hre.network.name, `(chain ${chainId})`);
  console.log("Contract  :", record.address);
  console.log("Treasury  :", treasury);
  console.log("Signer    :", signer.address, "|", hre.ethers.formatEther(balance), "ETH");
  console.log("Progress  :", (next - 1n).toString(), "of", MAX_SUPPLY.toString(), "minted");

  if (next > MAX_SUPPLY) {
    console.log("Nothing to do — supply fully minted.");
  }

  // Resumable by construction: each run reads nextTokenId from the chain and
  // continues; a crash mid-run loses nothing.
  while (next <= MAX_SUPPLY) {
    const remaining = MAX_SUPPLY - next + 1n;
    const count = remaining < batchSize ? remaining : batchSize;
    const tx = await nft.mintBatch(treasury, count);
    const receipt = await tx.wait();
    next = await nft.nextTokenId();
    console.log(
      `mintBatch(${count}) -> tokens through ${(next - 1n).toString()} | tx ${receipt.hash} | gas ${receipt.gasUsed.toString()}`
    );
  }

  const held = await nft.balanceOf(treasury);
  console.log("Treasury balance:", held.toString(), "MP");
  if (held === MAX_SUPPLY) {
    record.status = "minted";
    record.treasury = treasury;
    record.mintedAt = new Date().toISOString();
    writeFileSync(recordPath(hre.network.name), JSON.stringify(record, null, 2) + "\n");
    console.log("Record updated: status=minted. Next: publish provenance, claim the OpenSea page.");
  } else {
    console.log("NOTE: treasury holds", held.toString(), "— if tokens were minted elsewhere earlier, reconcile before updating the record.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
