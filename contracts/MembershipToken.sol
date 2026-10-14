// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Votes.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "./ATTRToken.sol";
import "./Errors.sol";
import "./interfaces/IMintMembership.sol";

/**
 * @title MembershipToken
 * @dev ATTR-MEMBER-ID — tiered membership NFT with on-chain voting power and royalties.
 *      Replaces the former GovernanceNFT and MembershipToken contracts.
 *      Token IDs start at 0. Public mint via `mintMembership`; admin mint via `adminMintMembership`.
 */
contract MembershipToken is ERC721URIStorage, ERC721Votes, ERC2981, Ownable, Pausable, ReentrancyGuard, IMintMembership {

    using SafeERC20 for IERC20;

    uint256 private _nextTokenId;
    /// @notice Canonical native USDC on Base mainnet.
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    /// @notice Minimum notice for all subsequent tranche price changes.
    uint256 public constant PRICE_NOTICE = 48 hours;
    /// @notice Liquid welcome-grant token; requires externally granted MINTER_ROLE.
    ATTRToken public attrToken;
    /// @notice Immutable-after-configuration checkout token.
    IERC20 public usdc;
    mapping(uint256 => uint256) public tierUSDCPrices;
    struct PendingPrice { uint256 price; uint256 effectiveTime; }
    mapping(uint256 => PendingPrice) public pendingETHPrices;
    mapping(uint256 => PendingPrice) public pendingUSDCPrices;

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

    /// @notice ETH price per paid tier, in wei.
    mapping(uint256 => uint256) public tierPrices;

    /// @notice Receiver for ETH proceeds from `mintMembership`.
    address public paymentReceiver;

    // ── Events ─────────────────────────────────────────────────────────────────

    event MembershipMinted(address indexed to, uint256 indexed tokenId, uint256 tier, address paymentToken, uint256 amount);
    event WelcomeGrantIssued(address indexed recipient, uint256 tier, uint256 grantAmount);
    event PaymentTokensConfigured(address indexed attrToken, address indexed usdc);
    event TierUpdated(uint256 indexed tokenId, uint256 newTier);
    event TierPriceUpdated(uint256 indexed tier, address indexed paymentToken, uint256 oldPrice, uint256 newPrice, uint256 effectiveTime);
    event TierPriceQueued(uint256 indexed tier, bool indexed isUSDC, uint256 newPrice, uint256 effectiveTime);
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
        if (maxSupply_ == 0 || maxSupply_ > 50_000) revert InvalidMaxSupply();
        if (maxMintPerWallet_ == 0 || maxMintPerWallet_ > 2 || maxMintPerWallet_ > maxSupply_) revert InvalidMaxMintPerWallet();

        paymentReceiver = paymentReceiver_;
        MAX_SUPPLY = maxSupply_;
        MAX_MINT_PER_WALLET = maxMintPerWallet_;
        tierPrices[1] = 0.225 ether;
        tierPrices[2] = 0.100 ether;
        tierUSDCPrices[1] = 580e6;
        tierUSDCPrices[2] = 260e6;
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

    /// @notice Bind deployed tokens once. Base mainnet accepts only native USDC.
    /// @dev ATTR administrator must separately grant this contract MINTER_ROLE.
    function configurePaymentTokens(address attrToken_, address usdc_) external onlyOwner {
        if (address(attrToken) != address(0)) revert PaymentTokensAlreadyConfigured();
        if (attrToken_.code.length == 0 || usdc_.code.length == 0 || attrToken_ == usdc_) revert InvalidPaymentToken();
        if (block.chainid == 8453 && usdc_ != BASE_USDC) revert InvalidPaymentToken();
        attrToken = ATTRToken(attrToken_);
        usdc = IERC20(usdc_);
        emit PaymentTokensConfigured(attrToken_, usdc_);
    }

    /// @notice Mint tier 1 or 2 with exact ETH payment and an atomic liquid grant.
    function mintMembership(uint256 tier, string memory metadataURI)
        public payable nonReentrant whenNotPaused returns (uint256)
    {
        _validateTier(tier);
        uint256 price = tierPrices[tier];
        if (price == 0) revert InvalidTierPrice();
        if (msg.value != price) revert ExactPaymentRequired(price, msg.value);
        uint256 tokenId = _reservePublicMint(tier);
        (bool success, ) = paymentReceiver.call{value: price}("");
        if (!success) revert TransferFailed();
        _completePublicMint(tokenId, tier, metadataURI, address(0), price);
        emit PaymentReceived(msg.sender, price, tier);
        return tokenId;
    }

    /// @notice Mint with an exact-price, single-use EIP-2612 USDC permit.
    /// @dev Signer, payer and NFT/grant recipient are msg.sender; no allowance fallback.
    function mintMembershipWithUSDC(uint256 tier, string calldata metadataURI,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external nonReentrant whenNotPaused returns (uint256)
    {
        _validateTier(tier);
        uint256 price = tierUSDCPrices[tier];
        if (price == 0) revert InvalidTierPrice();
        uint256 tokenId = _reservePublicMint(tier);
        IERC20Permit(address(usdc)).permit(msg.sender, address(this), price, deadline, v, r, s);
        usdc.safeTransferFrom(msg.sender, paymentReceiver, price);
        _completePublicMint(tokenId, tier, metadataURI, address(usdc), price);
        return tokenId;
    }

    function _validateTier(uint256 tier) internal pure {
        if (tier != 1 && tier != 2) revert InvalidTier(tier);
    }

    function _reservePublicMint(uint256 tier) internal returns (uint256 tokenId) {
        if (address(attrToken) == address(0)) revert InvalidPaymentToken();
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyExceeded();
        if (_mintedCounts[msg.sender] >= MAX_MINT_PER_WALLET) revert MaxMintPerWalletExceeded();
        tokenId = _nextTokenId++;
        _mintedCounts[msg.sender]++;
        tokenTiers[tokenId] = tier;
    }

    function _completePublicMint(uint256 tokenId, uint256 tier, string memory metadataURI,
        address paymentToken, uint256 price) internal
    {
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        uint256 grant = tier == 1 ? 2500 ether : 1000 ether;
        attrToken.mint(msg.sender, grant);
        emit WelcomeGrantIssued(msg.sender, tier, grant);
        emit MembershipMinted(msg.sender, tokenId, tier, paymentToken, price);
    }

    // ── Admin Mint ─────────────────────────────────────────────────────────────

    /**
     * @notice Owner-only free mint (airdrops, team allocations, etc.).
     */
    function adminMintMembership(
        address to,
        uint256 tier,
        string memory metadataURI
    ) public onlyOwner whenNotPaused nonReentrant returns (uint256) {
        _validateTier(tier);
        if (to == address(0)) revert ZeroAddress();
        if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyExceeded();

        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        tokenTiers[tokenId] = tier;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);

        emit MembershipMinted(to, tokenId, tier, address(0), 0);

        return tokenId;
    }

    /**
     * @notice Owner-only batch free mint.
     */
    function adminBatchMintMemberships(
        address[] calldata recipients,
        uint256[] calldata tiers,
        string[] calldata metadataURIs
    ) public onlyOwner whenNotPaused nonReentrant {
        if (recipients.length != tiers.length || tiers.length != metadataURIs.length) revert ArrayLengthMismatch();
        if (_nextTokenId + recipients.length > MAX_SUPPLY) revert MaxSupplyExceeded();

        for (uint256 i = 0; i < recipients.length; i++) {
            _validateTier(tiers[i]);
            if (recipients[i] == address(0)) revert ZeroAddress();
            // Re-check the hard cap on every iteration so the invariant holds even
            // if capacity is consumed mid-loop (e.g. a `_safeMint` callback path).
            if (_nextTokenId >= MAX_SUPPLY) revert MaxSupplyExceeded();
            uint256 tokenId = _nextTokenId;
            _nextTokenId++;

            tokenTiers[tokenId] = tiers[i];
            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, metadataURIs[i]);

            emit MembershipMinted(recipients[i], tokenId, tiers[i], address(0), 0);
        }
    }

    // ── Owner Configuration ────────────────────────────────────────────────────

    /// @notice Queue an ETH tranche price with 48 hours advance notice.
    function setTierPrice(uint256 tier, uint256 price) external onlyOwner {
        _queuePrice(tier, price, false);
    }

    /// @notice Queue a USDC tranche price, in six-decimal base units.
    function setTierUSDCPrice(uint256 tier, uint256 price) external onlyOwner {
        _queuePrice(tier, price, true);
    }

    function _queuePrice(uint256 tier, uint256 price, bool isUSDC) internal {
        _validateTier(tier);
        if (price == 0) revert InvalidTierPrice();
        uint256 effectiveTime = block.timestamp + PRICE_NOTICE;
        if (isUSDC) pendingUSDCPrices[tier] = PendingPrice(price, effectiveTime);
        else pendingETHPrices[tier] = PendingPrice(price, effectiveTime);
        emit TierPriceQueued(tier, isUSDC, price, effectiveTime);
    }

    /// @notice Permissionlessly activate a previously owner-queued tranche price.
    function executeTierPrice(uint256 tier, bool isUSDC) external {
        _validateTier(tier);
        PendingPrice memory pending = isUSDC ? pendingUSDCPrices[tier] : pendingETHPrices[tier];
        if (pending.effectiveTime == 0 || block.timestamp < pending.effectiveTime) revert PriceUpdateNotReady();
        uint256 oldPrice = isUSDC ? tierUSDCPrices[tier] : tierPrices[tier];
        if (isUSDC) {
            tierUSDCPrices[tier] = pending.price;
            delete pendingUSDCPrices[tier];
        } else {
            tierPrices[tier] = pending.price;
            delete pendingETHPrices[tier];
        }
        emit TierPriceUpdated(tier, isUSDC ? address(usdc) : address(0), oldPrice, pending.price, pending.effectiveTime);
    }

    /// @notice Change the primary-sale treasury receiver. Owner only.
    function setPaymentReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        address oldReceiver = paymentReceiver;
        paymentReceiver = newReceiver;
        emit PaymentReceiverUpdated(oldReceiver, newReceiver);
    }

    /// @notice Update an existing membership metadata URI. Owner only.
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

    /// @notice Relabel a membership as tier 1 or 2 without another grant. Owner only.
    function updateTier(uint256 tokenId, uint256 newTier) external onlyOwner {
        _validateTier(newTier);
        ownerOf(tokenId); // reverts if token doesn't exist
        tokenTiers[tokenId] = newTier;
        emit TierUpdated(tokenId, newTier);
    }

    /// @notice Read the tier of an existing membership.
    function getTier(uint256 tokenId) external view returns (uint256) {
        ownerOf(tokenId); // reverts if token doesn't exist
        return tokenTiers[tokenId];
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    /// @notice Return lifetime minted membership supply.
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice Return the next zero-based token ID.
    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice Return lifetime public-sale mints for a wallet (transfers do not reset it).
    function getMintedCount(address account) external view returns (uint256) {
        return _mintedCounts[account];
    }

    // ── Pause ──────────────────────────────────────────────────────────────────

    /// @notice Pause all membership mint paths. Owner only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume membership mint paths. Owner only.
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
