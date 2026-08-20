const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MergedPublic", function () {
  const UNREVEALED_URI = "ipfs://SEALED/prereveal.json";
  const BASE_URI = "ipfs://CID/";
  const PROVENANCE = ethers.keccak256(
    ethers.toUtf8Bytes("merged-public provenance seed 20260818")
  );

  async function deploy() {
    const [owner, stranger, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MergedPublic");
    const nft = await factory.deploy(UNREVEALED_URI, PROVENANCE);
    await nft.waitForDeployment();
    return { nft, factory, owner, stranger, other };
  }

  async function expectRevert(promise) {
    let reverted = false;
    try {
      await promise;
    } catch {
      reverted = true;
    }
    expect(reverted).to.equal(true);
  }

  it("deploys with name, symbol, provenance, and default 5% royalty", async function () {
    const { nft, owner } = await deploy();
    expect(await nft.name()).to.equal("Merged Public");
    expect(await nft.symbol()).to.equal("MP");
    expect(await nft.nextTokenId()).to.equal(1n);
    expect(await nft.MAX_SUPPLY()).to.equal(10_000n);
    expect(await nft.MAX_BATCH()).to.equal(250n);
    expect(await nft.provenanceHash()).to.equal(PROVENANCE);
    expect(await nft.revealed()).to.equal(false);
    expect(await nft.uriFrozen()).to.equal(false);
    expect(await nft.unrevealedURI()).to.equal(UNREVEALED_URI);
    expect(await nft.baseURI()).to.equal("");
    expect(await nft.contractURI()).to.equal("");
    const [receiver, amount] = await nft.royaltyInfo(1, 10_000n);
    expect(receiver).to.equal(owner.address);
    expect(amount).to.equal(500n);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x2a55205a")).to.equal(true);
  });

  it("constructor rejects empty unrevealed URI and zero provenance", async function () {
    const { factory } = await deploy();
    await expectRevert(factory.deploy("", PROVENANCE));
    await expectRevert(factory.deploy(UNREVEALED_URI, ethers.ZeroHash));
  });

  it("owner can mint tokens 1 through 4; all serve the sealed URI", async function () {
    const { nft, owner } = await deploy();
    for (let i = 1; i <= 4; i++) {
      await nft.mint(owner.address);
      expect(await nft.ownerOf(i)).to.equal(owner.address);
      expect(await nft.tokenURI(i)).to.equal(UNREVEALED_URI);
    }
    expect(await nft.nextTokenId()).to.equal(5n);
  });

  it("owner can mintBatch 4; all serve the sealed URI", async function () {
    const { nft, owner } = await deploy();
    await nft.mintBatch(owner.address, 4);
    expect(await nft.ownerOf(1)).to.equal(owner.address);
    expect(await nft.ownerOf(4)).to.equal(owner.address);
    expect(await nft.tokenURI(1)).to.equal(UNREVEALED_URI);
    expect(await nft.tokenURI(4)).to.equal(UNREVEALED_URI);
    expect(await nft.nextTokenId()).to.equal(5n);
  });

  it("mint and mintBatch reject the zero address", async function () {
    const { nft } = await deploy();
    await expectRevert(nft.mint(ethers.ZeroAddress));
    await expectRevert(nft.mintBatch(ethers.ZeroAddress, 1));
  });

  it("mintBatch rejects zero count and batches above 250", async function () {
    const { nft, owner } = await deploy();
    await expectRevert(nft.mintBatch(owner.address, 0));
    await expectRevert(nft.mintBatch(owner.address, 251));
    await nft.mintBatch(owner.address, 250);
    expect(await nft.nextTokenId()).to.equal(251n);
  });

  it("non-owner cannot mint or mintBatch", async function () {
    const { nft, stranger } = await deploy();
    await expectRevert(nft.connect(stranger).mint(stranger.address));
    await expectRevert(nft.connect(stranger).mintBatch(stranger.address, 1));
  });

  it("tokenURI reverts for unminted ids", async function () {
    const { nft, owner } = await deploy();
    await expectRevert(nft.tokenURI(1));
    await nft.mint(owner.address);
    await expectRevert(nft.tokenURI(2));
    await expectRevert(nft.tokenURI(10_001));
  });

  it("reveal is one-way and switches tokenURI to {base}{id}.json", async function () {
    const { nft, owner, stranger } = await deploy();
    await nft.mintBatch(owner.address, 3);
    expect(await nft.tokenURI(2)).to.equal(UNREVEALED_URI);
    await expectRevert(nft.reveal(""));
    await expectRevert(nft.connect(stranger).reveal(BASE_URI));
    await nft.reveal(BASE_URI);
    expect(await nft.revealed()).to.equal(true);
    expect(await nft.baseURI()).to.equal(BASE_URI);
    for (let i = 1; i <= 3; i++) {
      expect(await nft.tokenURI(i)).to.equal(`${BASE_URI}${i}.json`);
    }
    await expectRevert(nft.reveal("ipfs://AGAIN/"));
  });

  it("setUnrevealedURI works pre-reveal only", async function () {
    const { nft, owner, stranger } = await deploy();
    await nft.mint(owner.address);
    await expectRevert(nft.setUnrevealedURI(""));
    await expectRevert(nft.connect(stranger).setUnrevealedURI("ipfs://X/x.json"));
    await nft.setUnrevealedURI("ipfs://FIXED/prereveal.json");
    expect(await nft.unrevealedURI()).to.equal("ipfs://FIXED/prereveal.json");
    expect(await nft.tokenURI(1)).to.equal("ipfs://FIXED/prereveal.json");
    await nft.reveal(BASE_URI);
    await expectRevert(nft.setUnrevealedURI("ipfs://LATE/late.json"));
  });

  it("setBaseURI only after reveal; freezeURI only after reveal", async function () {
    const { nft, owner } = await deploy();
    await nft.mint(owner.address);
    await expectRevert(nft.setBaseURI("ipfs://EARLY/"));
    await expectRevert(nft.freezeURI());
    await nft.reveal(BASE_URI);
    await expectRevert(nft.setBaseURI(""));
    await nft.setBaseURI("ipfs://NEW/");
    expect(await nft.baseURI()).to.equal("ipfs://NEW/");
    expect(await nft.tokenURI(1)).to.equal("ipfs://NEW/1.json");
  });

  it("freezeURI then setBaseURI reverts", async function () {
    const { nft } = await deploy();
    await nft.reveal(BASE_URI);
    await nft.setBaseURI("ipfs://NEW/");
    await nft.freezeURI();
    expect(await nft.uriFrozen()).to.equal(true);
    await expectRevert(nft.setBaseURI("ipfs://MUTATE/"));
    await expectRevert(nft.freezeURI());
    expect(await nft.baseURI()).to.equal("ipfs://NEW/");
  });

  it("contractURI is owner-settable and survives freeze", async function () {
    const { nft, stranger } = await deploy();
    await expectRevert(nft.setContractURI(""));
    await expectRevert(nft.connect(stranger).setContractURI("ipfs://C/c.json"));
    await nft.setContractURI("ipfs://COLLECTION/collection.json");
    expect(await nft.contractURI()).to.equal("ipfs://COLLECTION/collection.json");
    await nft.reveal(BASE_URI);
    await nft.freezeURI();
    await nft.setContractURI("ipfs://COLLECTION/v2.json");
    expect(await nft.contractURI()).to.equal("ipfs://COLLECTION/v2.json");
  });

  it("pause blocks mint and transfer; unpause restores", async function () {
    const { nft, owner, stranger } = await deploy();
    await nft.mint(owner.address);
    await nft.pause();
    await expectRevert(nft.mint(owner.address));
    await expectRevert(nft.mintBatch(owner.address, 1));
    await expectRevert(nft.transferFrom(owner.address, stranger.address, 1));
    await nft.unpause();
    await nft.mint(owner.address);
    expect(await nft.ownerOf(2)).to.equal(owner.address);
    await nft.transferFrom(owner.address, stranger.address, 1);
    expect(await nft.ownerOf(1)).to.equal(stranger.address);
  });

  it("non-owner cannot pause", async function () {
    const { nft, stranger } = await deploy();
    await expectRevert(nft.connect(stranger).pause());
  });

  it("2-step ownership: transfer does not instantly change owner", async function () {
    const { nft, owner, stranger } = await deploy();
    await nft.transferOwnership(stranger.address);
    expect(await nft.owner()).to.equal(owner.address);
    expect(await nft.pendingOwner()).to.equal(stranger.address);
    await expectRevert(nft.connect(owner).acceptOwnership());
    await nft.connect(stranger).acceptOwnership();
    expect(await nft.owner()).to.equal(stranger.address);
    await expectRevert(nft.connect(owner).mint(owner.address));
    await nft.connect(stranger).mint(stranger.address);
    expect(await nft.ownerOf(1)).to.equal(stranger.address);
  });

  it("cannot renounce ownership before reveal and freeze", async function () {
    const { nft } = await deploy();
    await expectRevert(nft.renounceOwnership());
    await nft.reveal(BASE_URI);
    await expectRevert(nft.renounceOwnership());
    await nft.freezeURI();
    await nft.renounceOwnership();
    expect(await nft.owner()).to.equal(ethers.ZeroAddress);
  });

  it("cannot renounce ownership while paused (would brick transfers forever)", async function () {
    const { nft } = await deploy();
    await nft.reveal(BASE_URI);
    await nft.freezeURI();
    await nft.pause();
    await expectRevert(nft.renounceOwnership());
    await nft.unpause();
    await nft.renounceOwnership();
    expect(await nft.owner()).to.equal(ethers.ZeroAddress);
  });

  it("royalty bps cap at 10%", async function () {
    const { nft, owner, stranger } = await deploy();
    await expectRevert(nft.setDefaultRoyalty(owner.address, 1001));
    await expectRevert(nft.setDefaultRoyalty(ethers.ZeroAddress, 100));
    await nft.setDefaultRoyalty(stranger.address, 1000);
    const [receiver, amount] = await nft.royaltyInfo(1, 10_000n);
    expect(receiver).to.equal(stranger.address);
    expect(amount).to.equal(1000n);
  });

  it("caps supply at 10,000", async function () {
    this.timeout(300_000);
    const { nft, owner } = await deploy();
    for (let i = 0; i < 39; i++) {
      await nft.mintBatch(owner.address, 250);
    }
    expect(await nft.nextTokenId()).to.equal(9_751n);
    await nft.mintBatch(owner.address, 249);
    expect(await nft.nextTokenId()).to.equal(10_000n);
    await expectRevert(nft.mintBatch(owner.address, 2));
    await nft.mint(owner.address);
    expect(await nft.ownerOf(10_000)).to.equal(owner.address);
    expect(await nft.nextTokenId()).to.equal(10_001n);
    await expectRevert(nft.mint(owner.address));
    await expectRevert(nft.mintBatch(owner.address, 1));
    expect(await nft.tokenURI(10_000)).to.equal(UNREVEALED_URI);
    await nft.reveal(BASE_URI);
    expect(await nft.tokenURI(10_000)).to.equal(`${BASE_URI}10000.json`);
  });

  it("fuzz-cheap: royalty above cap and oversized batches revert", async function () {
    const { nft, owner } = await deploy();
    for (const bps of [1001, 2500, 5000, 10000, 65535]) {
      await expectRevert(nft.setDefaultRoyalty(owner.address, bps));
    }
    for (const count of [0, 251, 300, 1000, 10_000]) {
      await expectRevert(nft.mintBatch(owner.address, count));
    }
    await nft.mintBatch(owner.address, 250);
    expect(await nft.nextTokenId()).to.equal(251n);
  });
});
