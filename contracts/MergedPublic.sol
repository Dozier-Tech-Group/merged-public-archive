// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Merged Public
/// @notice 10,000-entity archive collection on Robinhood Chain (chain ID 4663).
///         Owner-mint to treasury, pre-reveal launch: every token serves the sealed
///         metadata until reveal, and the generative provenance (seed + weights +
///         rules) is committed as an immutable hash at deploy time — before any
///         art exists onchain, so the draw can be audited after reveal.
/// @dev Immutable implementation — not upgradeable. No public sale, staking,
///      yield, or rewards. msg.sender is the only authorization surface.
contract MergedPublic is ERC721, ERC2981, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_BATCH = 250;
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10% of 10_000
    uint96 public constant DEFAULT_ROYALTY_BPS = 500; // 5%

    /// @notice keccak256 of the canonical provenance JSON (seed 20260818 +
    ///         weights.json + rules.json). Fixed forever at deploy.
    bytes32 public immutable provenanceHash;

    uint256 public nextTokenId = 1;
    string private _unrevealedURI;
    string private _baseTokenURI;
    string private _contractURI;
    bool public revealed;
    bool public uriFrozen;

    event Minted(address indexed to, uint256 indexed tokenId);
    event BatchMinted(address indexed to, uint256 indexed fromId, uint256 count);
    event ProvenanceCommitted(bytes32 indexed hash);
    event UnrevealedURISet(string uri);
    event Revealed(string baseURI);
    event BaseURISet(string uri);
    event URIFrozen(string uri);
    event RoyaltyUpdated(address indexed receiver, uint96 feeBps);
    event ContractURISet(string uri);

    error MergedPublicZeroAddress();
    error MergedPublicZeroCount();
    error MergedPublicBatchTooLarge(uint256 count);
    error MergedPublicEmptyURI();
    error MergedPublicZeroProvenance();
    error MergedPublicAlreadyRevealed();
    error MergedPublicNotRevealed();
    error MergedPublicUriFrozen();
    error MergedPublicAlreadyFrozen();
    error MergedPublicUriNotFrozen();
    error MergedPublicSoldOut();
    error MergedPublicExceedsSupply(uint256 count);
    error MergedPublicRoyaltyTooHigh(uint96 bps);
    error MergedPublicPausedRenounce();

    /// @param unrevealedURI_ Full URI of the sealed metadata document served for
    ///        every token until reveal (a single JSON, not a directory).
    /// @param provenanceHash_ keccak256 of the canonical provenance JSON.
    constructor(string memory unrevealedURI_, bytes32 provenanceHash_)
        ERC721("Merged Public", "MP")
        Ownable(msg.sender)
    {
        if (bytes(unrevealedURI_).length == 0) revert MergedPublicEmptyURI();
        if (provenanceHash_ == bytes32(0)) revert MergedPublicZeroProvenance();
        _unrevealedURI = unrevealedURI_;
        provenanceHash = provenanceHash_;
        _setDefaultRoyalty(msg.sender, DEFAULT_ROYALTY_BPS);
        emit UnrevealedURISet(unrevealedURI_);
        emit ProvenanceCommitted(provenanceHash_);
        emit RoyaltyUpdated(msg.sender, DEFAULT_ROYALTY_BPS);
    }

    function mint(address to) external onlyOwner whenNotPaused nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert MergedPublicZeroAddress();
        tokenId = nextTokenId;
        if (tokenId > MAX_SUPPLY) revert MergedPublicSoldOut();
        unchecked {
            nextTokenId = tokenId + 1;
        }
        _safeMint(to, tokenId);
        emit Minted(to, tokenId);
    }

    function mintBatch(address to, uint256 count) external onlyOwner whenNotPaused nonReentrant {
        if (to == address(0)) revert MergedPublicZeroAddress();
        if (count == 0) revert MergedPublicZeroCount();
        if (count > MAX_BATCH) revert MergedPublicBatchTooLarge(count);

        uint256 start = nextTokenId;
        uint256 end = start + count;
        if (end - 1 > MAX_SUPPLY) revert MergedPublicExceedsSupply(count);
        nextTokenId = end;

        for (uint256 tokenId = start; tokenId < end; ) {
            _safeMint(to, tokenId);
            emit Minted(to, tokenId);
            unchecked {
                ++tokenId;
            }
        }
        emit BatchMinted(to, start, count);
    }

    /// @notice One-way switch from sealed metadata to the real archive.
    /// @param baseURI_ Metadata root with trailing slash. tokenURI(1) => {baseURI_}1.json
    function reveal(string calldata baseURI_) external onlyOwner {
        if (revealed) revert MergedPublicAlreadyRevealed();
        if (bytes(baseURI_).length == 0) revert MergedPublicEmptyURI();
        revealed = true;
        _baseTokenURI = baseURI_;
        emit Revealed(baseURI_);
        emit BaseURISet(baseURI_);
    }

    /// @notice Correct the sealed metadata location before reveal (typo insurance).
    function setUnrevealedURI(string calldata uri) external onlyOwner {
        if (revealed) revert MergedPublicAlreadyRevealed();
        if (bytes(uri).length == 0) revert MergedPublicEmptyURI();
        _unrevealedURI = uri;
        emit UnrevealedURISet(uri);
    }

    /// @notice Correct the revealed metadata root until it is frozen.
    function setBaseURI(string calldata uri) external onlyOwner {
        if (!revealed) revert MergedPublicNotRevealed();
        if (uriFrozen) revert MergedPublicUriFrozen();
        if (bytes(uri).length == 0) revert MergedPublicEmptyURI();
        _baseTokenURI = uri;
        emit BaseURISet(uri);
    }

    /// @notice Permanently lock metadata. Only meaningful after reveal. Irreversible.
    function freezeURI() external onlyOwner {
        if (!revealed) revert MergedPublicNotRevealed();
        if (uriFrozen) revert MergedPublicAlreadyFrozen();
        uriFrozen = true;
        emit URIFrozen(_baseTokenURI);
    }

    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        if (receiver == address(0)) revert MergedPublicZeroAddress();
        if (feeBps > MAX_ROYALTY_BPS) revert MergedPublicRoyaltyTooHigh(feeBps);
        _setDefaultRoyalty(receiver, feeBps);
        emit RoyaltyUpdated(receiver, feeBps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Refuse to renounce until metadata is revealed and frozen, and
    ///         never while paused — otherwise all transfers would be bricked
    ///         forever with no owner left to unpause.
    function renounceOwnership() public override onlyOwner {
        if (!uriFrozen) revert MergedPublicUriNotFrozen();
        if (paused()) revert MergedPublicPausedRenounce();
        super.renounceOwnership();
    }

    /// @notice Collection-level metadata (EIP-7572). Marketplaces such as
    ///         OpenSea read this for the collection page: name, description,
    ///         image, external_link, royalties.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice Update the collection page document. Branding, not token
    ///         metadata — stays owner-editable and is not subject to freezeURI.
    function setContractURI(string calldata uri) external onlyOwner {
        if (bytes(uri).length == 0) revert MergedPublicEmptyURI();
        _contractURI = uri;
        emit ContractURISet(uri);
    }

    function unrevealedURI() external view returns (string memory) {
        return _unrevealedURI;
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return _unrevealedURI;
        return string.concat(_baseURI(), tokenId.toString(), ".json");
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
