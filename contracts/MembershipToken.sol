// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Votes.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./Errors.sol";

/**
 * @title MembershipToken
 * @dev ATTR-MEMBER-ID — tiered membership NFT with on-chain voting power and royalties.
 *      Replaces the former GovernanceNFT and MembershipToken contracts.
 *      Token IDs start at 0. Public mint via `mintMembership`; admin mint via `adminMintMembership`.
 */
contract MembershipToken is ERC721URIStorage, ERC721Votes, ERC2981, Ownable, Pausable, ReentrancyGuard {

    uint256 private _nextTokenId;

    // ── Immutables ─────────────────────────────────────────────────────────────

    /// @notice Maximum number of tokens that can ever be minted.
    uint256 public immutable MAX_SUPPLY;

    /// @notice Maximum number of tokens a single wallet may mint via the public sale.
    uint256 public immutable MAX_MINT_PER_WALLET;

    // ── Storage ────────────────────────────────────────────────────────────────

    /// @notice Collection-level metadata URI (OpenSea contractURI standard).
    string private _contractURI;

    /// @notice Tracks per-wallet mint counts for the public sale cap.
    mapping(address => uint256) private _mintedCounts;

    /// @notice Tier assigned to each token ID.
    mapping(uint256 => uint256) public tokenTiers;

    /// @notice ETH price per tier (0 = free).
    mapping(uint256 => uint256) public tierPrices;

    /// @notice Receiver for ETH proceeds from `mintMembership`.
    address public paymentReceiver;

    // ── Events ─────────────────────────────────────────────────────────────────

    event MembershipMinted(address indexed to, uint256 indexed tokenId, uint256 tier, string uri);
    event TierUpdated(uint256 indexed tokenId, uint256 newTier);
    event TierPriceUpdated(uint256 indexed tier, uint256 newPrice);
    event PaymentReceived(address indexed from, uint256 amount, uint256 tier);
    event PaymentReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event ContractURIUpdated(string oldURI, string newURI);

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param name_                 Token name ("ATTR-MEMBER-ID")
     * @param symbol_               Token symbol ("ATTR#")
     * @param initialOwner          Contract owner (backend wallet)
     * @param paymentReceiver_      Receiver of public-mint ETH proceeds
     * @param royaltyReceiver_      ERC2981 royalty recipient
     * @param royaltyFeeNumerator_  Royalty in basis points (e.g. 500 = 5%)
     * @param contractURI_          Initial collection-level metadata URI
     * @param maxSupply_            Hard cap on total tokens (50,000)
     * @param maxMintPerWallet_     Per-wallet cap for the public sale
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner,
        address paymentReceiver_,
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        string memory contractURI_,
        uint256 maxSupply_,
        uint256 maxMintPerWallet_
    )
        ERC721(name_, symbol_)
        Ownable(initialOwner)
        EIP712(name_, "1")
    {
        if (paymentReceiver_ == address(0)) revert ZeroAddress();
        if (royaltyReceiver_ == address(0)) revert ZeroAddress();
        if (maxSupply_ == 0) revert InvalidMaxSupply();
        if (maxMintPerWallet_ == 0 || maxMintPerWallet_ > maxSupply_) revert InvalidMaxMintPerWallet();

        paymentReceiver = paymentReceiver_;
        MAX_SUPPLY = maxSupply_;
        MAX_MINT_PER_WALLET = maxMintPerWallet_;
        _contractURI = contractURI_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);
    }

    // ── Collection URI ─────────────────────────────────────────────────────────

    /// @notice Returns the collection-level metadata URI.
    function contractURI() public view returns (string memory) {
        return _contractURI;
    }

    /// @notice Updates the collection-level metadata URI. Owner only.
    function setContractURI(string calldata newURI) external onlyOwner {
        string memory oldURI = _contractURI;
        _contractURI = newURI;
        emit ContractURIUpdated(oldURI, newURI);
    }

    // ── Public Mint ────────────────────────────────────────────────────────────

    /**
     * @notice Mint a membership NFT for a given tier.
     * @dev Accepts msg.value >= tierPrice (overpay forwarded to paymentReceiver).
     * @param tier        Tier level (must have tierPrice configured).
     * @param metadataURI IPFS/HTTPS URI for the token metadata.
     */
    function mintMembership(
        uint256 tier,
        string memory metadataURI
    ) public payable nonReentrant whenNotPaused returns (uint256) {
        uint256 price = tierPrices[tier];
        if (msg.value < price) revert InsufficientPayment(price, msg.value);
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyExceeded();
        if (_mintedCounts[msg.sender] >= MAX_MINT_PER_WALLET) revert MaxMintPerWalletExceeded();

        // Checks-Effects-Interactions: increment state BEFORE external call.
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _mintedCounts[msg.sender]++;

        if (msg.value > 0) {
            (bool success, ) = paymentReceiver.call{value: msg.value}("");
            if (!success) revert TransferFailed();
        }

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        tokenTiers[tokenId] = tier;

        emit MembershipMinted(msg.sender, tokenId, tier, metadataURI);
        emit PaymentReceived(msg.sender, msg.value, tier);

        return tokenId;
    }

    // ── Admin Mint ─────────────────────────────────────────────────────────────

    /**
     * @notice Owner-only free mint (airdrops, team allocations, etc.).
     */
    function adminMintMembership(
        address to,
        uint256 tier,
        string memory metadataURI
    ) public onlyOwner whenNotPaused returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyExceeded();

        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);
        tokenTiers[tokenId] = tier;

        emit MembershipMinted(to, tokenId, tier, metadataURI);

        return tokenId;
    }

    /**
     * @notice Owner-only batch free mint.
     */
    function adminBatchMintMemberships(
        address[] calldata recipients,
        uint256[] calldata tiers,
        string[] calldata metadataURIs
    ) public onlyOwner whenNotPaused {
        if (recipients.length != tiers.length || tiers.length != metadataURIs.length) revert ArrayLengthMismatch();
        if (_nextTokenId + recipients.length > MAX_SUPPLY) revert MaxSupplyExceeded();

        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            uint256 tokenId = _nextTokenId;
            _nextTokenId++;

            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, metadataURIs[i]);
            tokenTiers[tokenId] = tiers[i];

            emit MembershipMinted(recipients[i], tokenId, tiers[i], metadataURIs[i]);
        }
    }

    // ── Owner Configuration ────────────────────────────────────────────────────

    function setTierPrice(uint256 tier, uint256 price) external onlyOwner {
        tierPrices[tier] = price;
        emit TierPriceUpdated(tier, price);
    }

    function setPaymentReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        address oldReceiver = paymentReceiver;
        paymentReceiver = newReceiver;
        emit PaymentReceiverUpdated(oldReceiver, newReceiver);
    }

    function setTokenURI(uint256 tokenId, string calldata newTokenURI) external onlyOwner {
        _setTokenURI(tokenId, newTokenURI);
    }

    // ── Withdrawals ────────────────────────────────────────────────────────────

    /// @notice Flush any ETH held by the contract to paymentReceiver. Emergency use only.
    function withdrawPayments() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        // slither-disable-next-line incorrect-equality
        if (balance == 0) revert NothingToClaim();
        (bool success, ) = paymentReceiver.call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    // ── Tier Management ────────────────────────────────────────────────────────

    function updateTier(uint256 tokenId, uint256 newTier) external onlyOwner {
        ownerOf(tokenId); // reverts if token doesn't exist
        tokenTiers[tokenId] = newTier;
        emit TierUpdated(tokenId, newTier);
    }

    function getTier(uint256 tokenId) external view returns (uint256) {
        ownerOf(tokenId); // reverts if token doesn't exist
        return tokenTiers[tokenId];
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function getMintedCount(address account) external view returns (uint256) {
        return _mintedCounts[account];
    }

    // ── Pause ──────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Reject direct ETH transfers; payments must flow through `mintMembership`.
    receive() external payable {
        revert TransferFailed();
    }

    // ── Multi-inheritance overrides ────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Votes)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Votes)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981, ERC721)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
