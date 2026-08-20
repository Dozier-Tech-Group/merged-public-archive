const { writeFileSync, mkdirSync, existsSync, readFileSync } = require("fs");
const { join } = require("path");
const hre = require("hardhat");

// Record is keyed per network so a testnet rehearsal can never merge into,
// or be mistaken for, the mainnet launch record.
const recordPath = (network) => join(__dirname, "..", "deployments", `merged-public.${network}.json`);
const PROVENANCE_PATH = join(__dirname, "..", "generator", "merged-public", "provenance.json");
const DEFAULT_TREASURY = "0xBCCAecdBb4F0c7af32C8018486D0b52A474d9B4a";
const EXPLORER = {
  robinhood: "https://robinhoodchain.blockscout.com",
  robinhoodTestnet: "https://explorer.testnet.chain.robinhood.com",
};

const DEFAULT_UNREVEALED_URI =
  "https://raw.githubusercontent.com/Dozier-Tech-Group/silicon-bayou/master/metadata/mp/unrevealed.json";
const DEFAULT_CONTRACT_URI =
  "https://raw.githubusercontent.com/Dozier-Tech-Group/silicon-bayou/master/metadata/mp/collection.json";

// The passphrase is deliberate friction: chain 4663 is real ETH and a real
// 10,000-token commitment. Type it on purpose, never bake it into .env defaults.
const MAINNET_CONFIRM = "yes-launch-merged-public";

function loadRecord(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveRecord(path, fields) {
  const record = { ...loadRecord(path), ...fields };
  mkdirSync(join(__dirname, "..", "deployments"), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  return record;
}

async function main() {
  // --- Provenance commitment -------------------------------------------------
  // generator/merged-public/provenance.json is the CANONICAL provenance file
  // (seed + weights + rules). The hash below is keccak256 of the EXACT raw
  // bytes of that file — no parsing, no re-serialization, no whitespace or
  // line-ending normalization. Anyone can reproduce it from the committed file:
  //   keccak256(read file bytes) === provenanceHash()
  // So the file must never be reformatted after deploy; byte-for-byte is the
  // contract of reproducibility.
  if (!existsSync(PROVENANCE_PATH)) {
    throw new Error(
      "HOLD: generator/merged-public/provenance.json is missing. The provenance file must exist" +
        " and be final (byte-for-byte) before deploy — its keccak256 is committed immutably in the constructor."
    );
  }
  const provenanceBytes = readFileSync(PROVENANCE_PATH); // raw Buffer, no encoding
  if (provenanceBytes.length === 0) {
    throw new Error("HOLD: provenance.json is empty. Refusing to commit the hash of an empty file.");
  }
  JSON.parse(provenanceBytes.toString("utf8")); // sanity: must be valid JSON (hash still covers raw bytes)
  const provenanceHash = hre.ethers.keccak256(provenanceBytes);

  // --- Redeploy guard --------------------------------------------------------
  const RECORD_PATH = recordPath(hre.network.name);
  const prior = loadRecord(RECORD_PATH);
  if (prior.address && process.env.REDEPLOY !== "1") {
    throw new Error(
      `Refusing to deploy: ${RECORD_PATH} already records MergedPublic ${prior.address}` +
        ` (status: ${prior.status || "unknown"}). A rerun would deploy a SECOND` +
        " collection contract. Finish the recorded one (mint / reveal / freeze read the record)." +
        " Only set REDEPLOY=1 if you truly want a brand-new contract."
    );
  }
  if (prior.address && process.env.REDEPLOY === "1") {
    const archive = RECORD_PATH.replace(/\.json$/, `.superseded-${Date.now()}.json`);
    writeFileSync(archive, JSON.stringify(prior, null, 2) + "\n");
    console.log("Archived prior record to", archive);
  }

  // --- Mainnet confirmation gate --------------------------------------------
  // Gate on the chain id the NODE reports, not what the local config declares.
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (chainId === 4663 && process.env.MP_DEPLOY_CONFIRM !== MAINNET_CONFIRM) {
    throw new Error(
      `HOLD: refusing to deploy Merged Public on Robinhood Chain mainnet (4663) without` +
        ` MP_DEPLOY_CONFIRM="${MAINNET_CONFIRM}". Rehearse on robinhoodTestnet first (npm run deploy:mp:testnet).`
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer. Set PRIVATE_KEY in .env (never paste the key into chat).");
  }

  const unrevealedURI = process.env.MP_UNREVEALED_URI || DEFAULT_UNREVEALED_URI;
  const contractURI = process.env.MP_CONTRACT_URI || DEFAULT_CONTRACT_URI;
  const explorer = EXPLORER[hre.network.name] || EXPLORER.robinhood;
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("Network        :", hre.network.name);
  console.log("Chain ID       :", chainId);
  console.log("Deployer       :", deployer.address);
  console.log("Balance        :", hre.ethers.formatEther(balance), "ETH");
  console.log("Unrevealed URI :", unrevealedURI);
  console.log("Contract URI   :", contractURI);
  console.log("Provenance file:", "generator/merged-public/provenance.json", `(${provenanceBytes.length} bytes)`);
  console.log("Provenance hash:", provenanceHash);
  console.log("Supply plan    : 10,000 owner-minted to treasury in 250-token batches (~40 txs), pre-reveal.");

  if (balance === 0n) {
    throw new Error(
      "Deployer wallet has 0 ETH on this network. Fund it (gas on Robinhood Chain is ETH), then rerun."
    );
  }

  // --- Deploy ----------------------------------------------------------------
  const factory = await hre.ethers.getContractFactory("MergedPublic");
  const nft = await factory.deploy(unrevealedURI, provenanceHash);
  const deployTx = nft.deploymentTransaction();
  await nft.waitForDeployment();
  const address = await nft.getAddress();
  const deployReceipt = await deployTx.wait();

  console.log("MergedPublic deployed:", address);
  console.log("Deploy tx:", deployReceipt.hash);

  // Persist the address the moment it exists, so a mid-run failure never
  // strands a live contract with no on-disk record.
  saveRecord(RECORD_PATH, {
    network: hre.network.name,
    chainId,
    status: "deployed_contract_uri_pending",
    address,
    deployer: deployer.address,
    unrevealedURI,
    provenanceHash,
    provenanceFile: "generator/merged-public/provenance.json",
    deployTx: deployReceipt.hash,
    explorer: `${explorer}/address/${address}`,
    explorerDeployTx: `${explorer}/tx/${deployReceipt.hash}`,
  });

  // --- Collection metadata (EIP-7572) ---------------------------------------
  const uriTx = await nft.setContractURI(contractURI);
  const uriReceipt = await uriTx.wait();
  console.log("contractURI set in tx:", uriReceipt.hash);

  // --- Royalties to treasury (ERC-2981) --------------------------------------
  const treasury = hre.ethers.getAddress(process.env.MP_TREASURY || DEFAULT_TREASURY);
  const royTx = await nft.setDefaultRoyalty(treasury, 500);
  const royReceipt = await royTx.wait();
  console.log(`Royalty receiver set to treasury ${treasury} (5%) in tx:`, royReceipt.hash);

  saveRecord(RECORD_PATH, {
    status: "deployed_mint_pending",
    contractURI,
    contractURITx: uriReceipt.hash,
    treasury,
    royaltyTx: royReceipt.hash,
  });
  console.log("Wrote", RECORD_PATH);

  console.log("");
  console.log("Explorer:", `${explorer}/address/${address}`);
  console.log("Next steps (MP-LAUNCH.md):");
  console.log("  1. Verify onchain: provenanceHash(), unrevealedURI(), contractURI() match the printout above.");
  console.log("  2. Mint 10,000 to treasury: 40 mintBatch(treasury, 250) calls. Do NOT mint before deciding treasury.");
  console.log("  3. Publish the provenance hash + file publicly, then claim the OpenSea collection page.");
  console.log("  4. Much later: reveal(baseURI), then freezeURI(). Both one-way — see the runbook.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
