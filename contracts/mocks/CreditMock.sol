// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Test stand-in for the live Merged Credits token
///      (0x040f12C71ddA0bA9D91E94016ea5C348106ab429): 0-decimals ERC-20,
///      owner-minted. The live token's verified source is on Blockscout;
///      this mock exists only so the board suite runs self-contained.
contract CreditMock is ERC20, Ownable {
    constructor() ERC20("Credit Mock", "CRM") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
