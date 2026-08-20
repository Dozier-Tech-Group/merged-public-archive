const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");
const hre = require("hardhat");

// Start the Ownable2Step handover of MergedPublic to the treasury.
// Safe: nothing changes until the treasury calls acceptOwnership();
// until then the current owner can overwrite or cancel the pending owner.
const TREASURY = "0xBCCAecdBb4F0c7af32C8018486D0b52A474d9B4a";

async function main() {
  const recordPath = join(__dirname, "..", "deployments", `merged-public.${hre.network.name}.json`);
  if (!existsSync(recordPath)) throw new Error(`HOLD: ${recordPath} not found.`);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));

  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No signer. Set PRIVATE_KEY in .env.");
  const nft = await hre.ethers.getContractAt("MergedPublic", record.address, signer);

  const owner = await nft.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`HOLD: signer ${signer.address} is not the owner (${owner}).`);
  }
  const treasury = hre.ethers.getAddress(process.env.MP_NEW_OWNER || TREASURY);
  const pending = await nft.pendingOwner();
  if (pending.toLowerCase() === treasury.toLowerCase()) {
    console.log("Already pending to", treasury, "— treasury just needs to acceptOwnership().");
    return;
  }
  const tx = await nft.transferOwnership(treasury);
  await tx.wait();
  console.log(`transferOwnership(${treasury}) sent: ${tx.hash}`);
  console.log("Pending owner is now the treasury. Complete it by calling acceptOwnership()");
  console.log("FROM THE TREASURY WALLET on Blockscout:");
  console.log(`https://robinhoodchain.blockscout.com/address/${record.address}?tab=write_contract`);

  record.ownershipPendingTo = treasury;
  record.ownershipTransferTx = tx.hash;
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
