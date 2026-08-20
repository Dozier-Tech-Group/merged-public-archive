// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MergedPublicBoard
/// @notice The Merged Public work board: maps a task id to a Merged Credit
///         reward. First settle wins; owner or oracle calls
///         settle(issueId, winner), then the winner pulls their credits.
/// @dev Payment for verified work, never for holding. Only a wallet holding a
///      Merged Public identity can be settled or withdraw. No emissions, no
///      staking, no passive yield. Intended for Robinhood Chain (chain ID
///      4663). Not upgradeable.
contract MergedPublicBoard is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable credit;
    IERC721 public immutable identity;
    address public oracle;

    struct Bounty {
        uint256 reward;
        address winner;
        bool settled;
    }

    mapping(uint256 => Bounty) public bounties;
    mapping(address => uint256) public claimable;

    event Funded(uint256 indexed issueId, uint256 reward);
    event Settled(uint256 indexed issueId, address indexed winner, uint256 reward);
    event Withdrawn(address indexed account, uint256 amount);
    event OracleUpdated(address indexed oracle);

    error MergedPublicBoardZeroAddress();
    error MergedPublicBoardUnauthorized();
    error MergedPublicBoardNeedIdentity();
    error MergedPublicBoardRewardZero();
    error MergedPublicBoardAlreadyFunded();
    error MergedPublicBoardUnfunded();
    error MergedPublicBoardAlreadySettled();
    error MergedPublicBoardNothingToWithdraw();

    constructor(address credit_, address identity_) Ownable(msg.sender) {
        if (credit_ == address(0) || identity_ == address(0)) revert MergedPublicBoardZeroAddress();
        credit = IERC20(credit_);
        identity = IERC721(identity_);
    }

    function _requireIdentity(address account) internal view {
        if (identity.balanceOf(account) == 0) revert MergedPublicBoardNeedIdentity();
    }

    modifier onlyOwnerOrOracle() {
        if (msg.sender != owner() && msg.sender != oracle) {
            revert MergedPublicBoardUnauthorized();
        }
        _;
    }

    function setOracle(address oracle_) external onlyOwner {
        oracle = oracle_;
        emit OracleUpdated(oracle_);
    }

    function fund(uint256 issueId, uint256 reward) external onlyOwner whenNotPaused nonReentrant {
        if (reward == 0) revert MergedPublicBoardRewardZero();
        if (bounties[issueId].reward != 0) revert MergedPublicBoardAlreadyFunded();
        bounties[issueId].reward = reward;
        credit.safeTransferFrom(msg.sender, address(this), reward);
        emit Funded(issueId, reward);
    }

    /// @notice First settle wins. Owner or designated oracle only.
    ///         Winner must hold at least one Merged Public identity.
    function settle(uint256 issueId, address winner) external onlyOwnerOrOracle whenNotPaused {
        if (winner == address(0)) revert MergedPublicBoardZeroAddress();
        _requireIdentity(winner);
        Bounty storage bounty = bounties[issueId];
        if (bounty.reward == 0) revert MergedPublicBoardUnfunded();
        if (bounty.settled) revert MergedPublicBoardAlreadySettled();
        bounty.winner = winner;
        bounty.settled = true;
        claimable[winner] += bounty.reward;
        emit Settled(issueId, winner, bounty.reward);
    }

    /// @notice Pull-over-push: an identity holder withdraws their own credits.
    function withdraw() external whenNotPaused nonReentrant {
        _requireIdentity(msg.sender);
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert MergedPublicBoardNothingToWithdraw();
        claimable[msg.sender] = 0;
        credit.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
