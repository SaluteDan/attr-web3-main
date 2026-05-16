// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MembershipToken
 * @dev ERC721 token for membership with tier-based metadata
 * Each token has a tier level stored in its URI metadata
 */
contract MembershipToken is ERC721URIStorage, Ownable, ReentrancyGuard, Pausable {
    uint256 private _nextTokenId;

    // Max Supply Cap
    uint256 public immutable MAX_SUPPLY;

    mapping(uint256 => uint256) public tokenTiers;
    mapping(uint256 => uint256) public tierPrices;

    address public paymentReceiver;

    event MembershipMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 tier,
        string uri
    );

    event TierUpdated(uint256 indexed tokenId, uint256 newTier);
    event TierPriceUpdated(uint256 indexed tier, uint256 newPrice);
    event PaymentReceived(address indexed from, uint256 amount, uint256 tier);
    event PaymentReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    constructor(
        string memory _name,
        string memory _symbol,
        address initialOwner,
        address _paymentReceiver,
        uint256 _maxSupply
    ) ERC721(_name, _symbol) Ownable(initialOwner) {
        require(_paymentReceiver != address(0), "Invalid payment receiver");
        require(_maxSupply > 0, "Max supply must be greater than 0");
        _nextTokenId = 0;
        paymentReceiver = _paymentReceiver;
        MAX_SUPPLY = _maxSupply;
    }

    function mintMembership(
        uint256 tier,
        string memory metadataURI
    ) public payable nonReentrant whenNotPaused returns (uint256) {
        uint256 price = tierPrices[tier];
        require(msg.value >= price, "Insufficient payment for tier");
        require(_nextTokenId < MAX_SUPPLY, "Max supply exceeded");

        // Checks-Effects-Interactions: assign and increment tokenId BEFORE
        // the external ETH call to prevent cross-function reentrancy on _nextTokenId.
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        // Forward payment immediately to reduce risk
        if (msg.value > 0) {
            (bool success, ) = paymentReceiver.call{value: msg.value}("");
            require(success, "Payment forward failed");
        }

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        tokenTiers[tokenId] = tier;

        emit MembershipMinted(msg.sender, tokenId, tier, metadataURI);
        emit PaymentReceived(msg.sender, msg.value, tier);

        return tokenId;
    }

    function adminMintMembership(
        address to,
        uint256 tier,
        string memory metadataURI
    ) public onlyOwner whenNotPaused returns (uint256) {
        require(_nextTokenId < MAX_SUPPLY, "Max supply exceeded");
        
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);
        tokenTiers[tokenId] = tier;

        emit MembershipMinted(to, tokenId, tier, metadataURI);

        return tokenId;
    }

    function adminBatchMintMemberships(
        address[] calldata recipients,
        uint256[] calldata tiers,
        string[] calldata metadataURIs
    ) public onlyOwner whenNotPaused {
        require(
            recipients.length == tiers.length &&
                tiers.length == metadataURIs.length,
            "Array lengths must match"
        );
        require(_nextTokenId + recipients.length <= MAX_SUPPLY, "Would exceed max supply");

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 tokenId = _nextTokenId;
            _nextTokenId++;

            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, metadataURIs[i]);
            tokenTiers[tokenId] = tiers[i];

            emit MembershipMinted(recipients[i], tokenId, tiers[i], metadataURIs[i]);
        }
    }

    function setTierPrice(uint256 tier, uint256 price) public onlyOwner {
        tierPrices[tier] = price;
        emit TierPriceUpdated(tier, price);
    }

    function setPaymentReceiver(address _paymentReceiver) public onlyOwner {
        require(_paymentReceiver != address(0), "Invalid address");
        address oldReceiver = paymentReceiver;
        paymentReceiver = _paymentReceiver;
        emit PaymentReceiverUpdated(oldReceiver, _paymentReceiver);
    }

    function withdrawPayments() public onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        (bool success, ) = paymentReceiver.call{value: balance}("");
        require(success, "Withdrawal failed");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Reject direct ETH transfers. Payments must flow through `mintMembership`.
    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    function updateTier(uint256 tokenId, uint256 newTier) public onlyOwner {
        require(ownerOf(tokenId) != address(0), "Token does not exist");
        tokenTiers[tokenId] = newTier;
        emit TierUpdated(tokenId, newTier);
    }

    function getTier(uint256 tokenId) public view returns (uint256) {
        require(ownerOf(tokenId) != address(0), "Token does not exist");
        return tokenTiers[tokenId];
    }

    function getNextTokenId() public view returns (uint256) {
        return _nextTokenId;
    }

    function name() public view override returns (string memory) {
        return super.name();
    }

    function symbol() public view override returns (string memory) {
        return super.symbol();
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
