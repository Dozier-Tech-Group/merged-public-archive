const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MergedPublicBoard + credit token", function () {
  const UNREVEALED_URI = "ipfs://SEALED/prereveal.json";
  const PROVENANCE = ethers.keccak256(
    ethers.toUtf8Bytes("merged-public provenance seed 20260818")
  );

  async function deploy() {
    const [owner, other, oracle] = await ethers.getSigners();
    const credit = await (await ethers.getContractFactory("CreditMock")).deploy();
    await credit.waitForDeployment();
    const identity = await (await ethers.getContractFactory("MergedPublic")).deploy(
      UNREVEALED_URI,
      PROVENANCE,
    );
    await identity.waitForDeployment();
    const board = await (await ethers.getContractFactory("MergedPublicBoard")).deploy(
      await credit.getAddress(),
      await identity.getAddress(),
    );
    await board.waitForDeployment();
    await credit.mint(owner.address, 1000);
    await credit.approve(await board.getAddress(), 1000);
    await identity.mint(owner.address);
    await identity.mint(other.address);
    await identity.mint(oracle.address);
    return { owner, other, oracle, credit, identity, board };
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

  it("gates on Merged Public identity, not any other collection", async function () {
    const { board } = await deploy();
    expect(await board.identity()).to.not.equal(ethers.ZeroAddress);
  });

  it("first settle wins; winner can withdraw credits (not yield)", async function () {
    const { board, credit, other } = await deploy();
    await board.fund(1, 200);
    await board.settle(1, other.address);
    expect((await board.bounties(1)).settled).to.equal(true);
    await board.connect(other).withdraw();
    expect(await credit.balanceOf(other.address)).to.equal(200n);
    expect(await board.claimable(other.address)).to.equal(0n);
  });

  it("settle twice reverts; second withdraw is safe (reverts)", async function () {
    const { board, other } = await deploy();
    await board.fund(7, 50);
    await board.settle(7, other.address);
    await expectRevert(board.settle(7, other.address));
    await board.connect(other).withdraw();
    await expectRevert(board.connect(other).withdraw());
  });

  it("non-owner cannot settle; oracle can after appointment", async function () {
    const { board, other, oracle } = await deploy();
    await board.fund(2, 50);
    await expectRevert(board.connect(other).settle(2, other.address));
    await board.setOracle(oracle.address);
    await board.connect(oracle).settle(2, other.address);
    expect((await board.bounties(2)).winner).to.equal(other.address);
  });

  it("fund rejects zero reward and double funding", async function () {
    const { board } = await deploy();
    await expectRevert(board.fund(5, 0));
    await board.fund(5, 10);
    await expectRevert(board.fund(5, 10));
  });

  it("pause blocks fund, settle, and withdraw", async function () {
    const { board, other } = await deploy();
    await board.fund(9, 10);
    await board.pause();
    await expectRevert(board.fund(10, 10));
    await expectRevert(board.settle(9, other.address));
    await board.unpause();
    await board.settle(9, other.address);
    await board.pause();
    await expectRevert(board.connect(other).withdraw());
    await board.unpause();
    await board.connect(other).withdraw();
  });

  it("rejects settle and withdraw for a wallet holding no Merged Public identity", async function () {
    const { board, identity, other } = await deploy();
    const stranger = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [stranger.address, "0x56BC75E2D63100000"]);

    await board.fund(11, 10);
    await expectRevert(board.settle(11, stranger.address));

    await board.settle(11, other.address);
    // other gives away their only identity, then cannot withdraw
    await identity.connect(other).transferFrom(other.address, stranger.address, 2);
    await expectRevert(board.connect(other).withdraw());
    // stranger now holds an identity and could be settled going forward
    await board.fund(12, 10);
    await board.settle(12, stranger.address);
    await board.connect(stranger).withdraw();
  });

  it("2-step ownership on the board", async function () {
    const { board, owner, other } = await deploy();
    await board.transferOwnership(other.address);
    expect(await board.owner()).to.equal(owner.address);
    await board.connect(other).acceptOwnership();
    expect(await board.owner()).to.equal(other.address);
  });
});
