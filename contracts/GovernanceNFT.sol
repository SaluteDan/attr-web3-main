// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Votes.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GovernanceNFT
 * @dev Standalone NFT Collection with Voting Capabilities (ERC721Votes).
 *      Used for Platform Membership Passes and Governance.
 */
contract GovernanceNFT is ERC721URIStorage, ERC721Votes, ERC2981, Ownable, Pausable, ReentrancyGuard {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    uint256 private _nextTokenId;
    
    // Collection Metadata URI
    string private _contractURI;
    
    // Max Supply Cap
    uint256 public immutable MAX_SUPPLY;
    
    // Max Mint Per Wallet Cap
    uint256 public immutable MAX_MINT_PER_WALLET;

    // Track mints per wallet
    mapping(address => uint256) private _mintedCounts;
    
    // Receiver for mint payments
    address public paymentReceiver;

    /// @notice Represents a voucher to mint an NFT
    struct NFTVoucher {
        address recipient;
        string uri;
        string nonce;
        address currency; // address(0) for ETH
        uint256 minPrice;
        uint256 deadline;
        bytes signature;
    }

    // EIP-712 TypeHash for Voucher (Separate from Votes EIP712)
    bytes32 private constant _VOUCHER_TYPEHASH =
        keccak256("NFTVoucher(address recipient,string uri,string nonce,address currency,uint256 minPrice,uint256 deadline)");

    // Track used nonces
    mapping(string => bool) private usedNonces;

    // Errors
    error InvalidSignature();
    error VoucherAlreadyUsed();

    // Events
    event NFTMinted(address indexed recipient, uint256 indexed tokenId, string tokenURI);

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator,
        string memory contractURI_,
        uint256 maxSupply_,
        address paymentReceiver_,
        uint256 maxMintPerWallet_
    ) 
        ERC721(name_, symbol_) 
        Ownable(initialOwner) 
        EIP712(name_, "1") 
    {
        _nextTokenId = 1;
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        _contractURI = contractURI_;
        MAX_SUPPLY = maxSupply_;
        paymentReceiver = paymentReceiver_;
        MAX_MINT_PER_WALLET = maxMintPerWallet_;
    }

    function contractURI() public view returns (string memory) {
        return _contractURI;
    }

    function mintTo(address recipient, string memory uri) 
        external 
        onlyOwner
        whenNotPaused 
        returns (uint256) 
    {
        return _mintNFT(recipient, uri);
    }

    function setTokenURI(uint256 tokenId, string memory _tokenURI) 
        external 
        onlyOwner 
    {
        _setTokenURI(tokenId, _tokenURI);
    }

    function mintWithVoucher(NFTVoucher calldata voucher) 
        external 
        payable
        whenNotPaused
        nonReentrant
        returns (uint256) 
    {
        if (usedNonces[voucher.nonce]) revert VoucherAlreadyUsed();
        if (block.timestamp > voucher.deadline) revert("Voucher expired");
        if (_mintedCounts[voucher.recipient] >= MAX_MINT_PER_WALLET) revert("Max mint per wallet exceeded");

        address signer = _verify(voucher);
        if (owner() != signer) revert InvalidSignature();

        usedNonces[voucher.nonce] = true;
        _mintedCounts[voucher.recipient]++;

        if (voucher.minPrice > 0) {
            if (voucher.currency == address(0)) {
                require(msg.value >= voucher.minPrice, "Insufficient ETH");
                (bool success, ) = payable(paymentReceiver).call{value: msg.value}("");
                require(success, "Failed to send ETH");
            } else {
                require(msg.value == 0, "ETH sent with ERC20");
                IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.minPrice);
            }
        }

        return _mintNFT(voucher.recipient, voucher.uri);
    }

    function _mintNFT(address recipient, string memory uri) internal returns (uint256) {
        require(recipient != address(0), "Zero address");
        require(bytes(uri).length > 0, "Empty URI");
        require(_nextTokenId <= MAX_SUPPLY, "Max supply exceeded");

        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        emit NFTMinted(recipient, tokenId, uri);
        return tokenId;
    }

    function _verify(NFTVoucher calldata voucher) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            _VOUCHER_TYPEHASH,
            voucher.recipient,
            keccak256(bytes(voucher.uri)),
            keccak256(bytes(voucher.nonce)),
            voucher.currency,
            voucher.minPrice,
            voucher.deadline
        )));
        return ECDSA.recover(digest, voucher.signature);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // --- Overrides for Multi-Inheritance ---

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
