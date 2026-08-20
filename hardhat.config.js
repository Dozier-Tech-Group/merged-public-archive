require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig
 *
 * Compiler settings are PINNED to reproduce the deployed bytecode of
 * MergedPublic (0x5D000b230653E416FF41451525b144a6C2Ad7178, verified on
 * Blockscout): solc 0.8.24, evmVersion shanghai, optimizer 200 runs,
 * OpenZeppelin exactly 5.2.0. MergedPublicBoard deploys from this repo under
 * the same settings so both contracts re-verify from this tree forever.
 */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    robinhood: {
      url:
        process.env.RH_RPC_URL ||
        process.env.RPC_URL ||
        "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
    },
    robinhoodTestnet: {
      url:
        process.env.RH_TESTNET_RPC_URL ||
        "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
    },
  },
  etherscan: {
    apiKey: { robinhood: "blockscout", robinhoodTestnet: "blockscout" },
    customChains: [
      {
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  paths: { tests: "./test/contracts" },
};
