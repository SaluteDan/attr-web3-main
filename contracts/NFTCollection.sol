// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Errors.sol";
import "./ATTRSpender.sol";

/**
 * @title NFTCollection
 * @dev ERC-721 NFT Collection with dynamic metadata and owner-controlled minting
 * @notice This contract is deployed by the ATTRDeployer
 */
contract NFTCollection is ERC721URIStorage, ERC2981, Ownable, EIP712, Pausable, ReentrancyGuard {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    uint256 private _nextTokenId;
    
    // Collection Metadata URI (OpenSea Standard)
    string private _contractURI;
    
    // Max Supply Cap
    uint256 public immutable MAX_SUPPLY;
    
    // Max Mint Per Wallet Cap
    uint256 public immutable MAX_MINT_PER_WALLET;

    // Track mints per wallet
    mapping(address => uint256) private _mintedCounts;
    
    // Receiver for base mint payments
    address public paymentReceiver;

    // Receiver for creator tips (may equal paymentReceiver)
    address public tipReceiver;

    // Shared ATTR payment proxy (set by ATTRDeployer; address(0) disables ATTR routing)
    ATTRSpender public attrSpender;

    /// @notice Represents a voucher to mint an NFT
    struct NFTVoucher {
        address recipient;
        string uri;
        string nonce;
        address currency; // address(0) for ETH, otherwise ERC20 address
        uint256 basePrice; // base mint payment routed to paymentReceiver
        uint256 creatorTip; // optional tip routed to tipReceiver
        uint256 deadline;
        bytes signature;
    }

    // EIP-712 TypeHash
    bytes32 private constant _VOUCHER_TYPEHASH =
        keccak256("NFTVoucher(address recipient,string uri,string nonce,address currency,uint256 basePrice,uint256 creatorTip,uint256 deadline)");

    // Track used nonces to prevent replay attacks
    mapping(string => bool) private usedNonces;

    // Events
    event NFTMinted(address indexed recipient, uint256 indexed tokenId, string tokenURI);
    event ContractURIUpdated(string oldURI, string newURI);
    event TipReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    /**
     * @dev Constructor sets the collection name and symbol
     * @param name_ The name of the NFT collection
     * @param symbol_ The symbol of the NFT collection
     * @param initialOwner The address that will own this contract (backend wallet)
     * @param royaltyReceiver The address that will receive royalty payments
     * @param royaltyFeeNumerator The royalty fee in basis points (e.g. 500 = 5%)
     * @param contractURI_ The URI for the collection-level metadata
     * @param maxSupply_ The maximum number of NFTs that can be minted
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator,
        string memory contractURI_,
        uint256 maxSupply_,
        address paymentReceiver_,
        uint256 maxMintPerWallet_,
        address tipReceiver_,
        address attrSpender_
    ) ERC721(name_, symbol_) Ownable(initialOwner) EIP712("NFTCollection", "1") {
        if (paymentReceiver_ == address(0)) revert ZeroAddress();
        if (tipReceiver_ == address(0)) revert ZeroAddress();
        _nextTokenId = 1; // Start token IDs at 1
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        _contractURI = contractURI_;
        MAX_SUPPLY = maxSupply_;
        paymentReceiver = paymentReceiver_;
        MAX_MINT_PER_WALLET = maxMintPerWallet_;
        tipReceiver = tipReceiver_;
        attrSpender = ATTRSpender(attrSpender_);
    }

    /**
     * @dev Returns the collection-level metadata URI
     * @return The contract URI string
     */
    function contractURI() public view returns (string memory) {
        return _contractURI;
    }

    /// @notice Updates the collection-level metadata URI. Owner only.
    function setContractURI(string calldata newURI) external onlyOwner {
        string memory oldURI = _contractURI;
        _contractURI = newURI;
        emit ContractURIUpdated(oldURI, newURI);
    }

    /// @notice Updates the tip receiver address. Owner only.
    function setTipReceiver(address newTipReceiver) external onlyOwner {
        if (newTipReceiver == address(0)) revert ZeroAddress();
        address old = tipReceiver;
        tipReceiver = newTipReceiver;
        emit TipReceiverUpdated(old, newTipReceiver);
    }

    /**
     * @dev Mint a new NFT to a recipient with a specific metadata URI
     * @param recipient The address that will receive the NFT
     * @param uri The IPFS URI for the NFT metadata
     * @return tokenId The ID of the newly minted token
     * @notice Only the contract owner (backend) can call this function
     */
    function mintTo(address recipient, string memory uri) 
        external 
        onlyOwner
        whenNotPaused 
        returns (uint256) 
    {
        return _mintNFT(recipient, uri);
    }

    /**
     * @dev Update the metadata URI for a specific token
     * @param tokenId The ID of the token to update
     * @param _tokenURI The new metadata URI
     * @notice Only the contract owner (backend) can call this function
     */
    function setTokenURI(uint256 tokenId, string memory _tokenURI) 
        external 
        onlyOwner 
    {
        _setTokenURI(tokenId, _tokenURI);
    }

    /// @notice Represents an ERC20Permit signature for gasless approval
    struct PermitSignature {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 deadline;
        uint256 nonce;
    }

    /**
     * @dev Mint a new NFT using a signed voucher with ERC20Permit for gasless approval
     * @param voucher The voucher containing mint details and signature
     * @param permit The permit signature for ERC20 approval
     * @return tokenId The ID of the newly minted token
     * @notice Allows minting without pre-approval by using ERC20Permit
     */
    function redeem(NFTVoucher calldata voucher, PermitSignature calldata permit) 
        external 
        payable
        whenNotPaused
        nonReentrant
        returns (uint256) 
    {
        if (usedNonces[voucher.nonce]) revert VoucherAlreadyUsed();
        if (block.timestamp > voucher.deadline) revert VoucherExpired();
        if (_mintedCounts[voucher.recipient] >= MAX_MINT_PER_WALLET) revert MaxMintPerWalletExceeded();

        address signer = _verify(voucher);
        if (owner() != signer) revert InvalidSignature();

        // Checks-Effects-Interactions: mark nonce used and bump mint counter
        // BEFORE any external call (ETH forward / ERC20 transfer) to prevent
        // re-entrancy replay of the same voucher via a malicious paymentReceiver.
        usedNonces[voucher.nonce] = true;
        _mintedCounts[voucher.recipient]++;

        // Handle Payment with Permit
        uint256 totalPayment = voucher.basePrice + voucher.creatorTip;
        if (totalPayment > 0) {
            if (voucher.currency == address(0)) {
                // ETH Payment: exact amount required
                if (msg.value != totalPayment) revert ExactETHRequired(totalPayment, msg.value);
                if (voucher.basePrice > 0) {
                    (bool ok1, ) = payable(paymentReceiver).call{value: voucher.basePrice}("");
                    if (!ok1) revert TransferFailed();
                }
                if (voucher.creatorTip > 0) {
                    // slither-disable-next-line arbitrary-send-eth
                    (bool ok2, ) = payable(tipReceiver).call{value: voucher.creatorTip}("");
                    if (!ok2) revert TransferFailed();
                }
            } else {
                // ERC20 Payment
                if (msg.value != 0) revert ETHWithERC20Payment();

                if (address(attrSpender) != address(0) &&
                    voucher.currency == address(attrSpender.ATTR_TOKEN())) {
                    // ATTR: route through shared spender (user approved ATTRSpender directly)
                    attrSpender.collectPayment(
                        msg.sender, paymentReceiver, tipReceiver,
                        voucher.basePrice, voucher.creatorTip
                    );
                } else {
                    // Other ERC20 with Permit
                    try IERC20Permit(voucher.currency).permit(
                        msg.sender,
                        address(this),
                        totalPayment,
                        permit.deadline,
                        permit.v,
                        permit.r,
                        permit.s
                    ) {
                        // Permit executed successfully
                    } catch Error(string memory reason) {
                        revert(reason);
                    } catch {
                        revert("Permit execution failed");
                    }
                    if (voucher.basePrice > 0) {
                        IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.basePrice);
                    }
                    if (voucher.creatorTip > 0) {
                        IERC20(voucher.currency).safeTransferFrom(msg.sender, tipReceiver, voucher.creatorTip);
                    }
                }
            }
        }

        return _mintNFT(voucher.recipient, voucher.uri);
    }

    /**
     * @dev Mint a new NFT using a signed voucher (assumes approval already exists)
     * @param voucher The voucher containing mint details and signature
     * @return tokenId The ID of the newly minted token
     * @notice For use with Smart Accounts or when approval is done separately
     * @notice This function assumes the caller has already approved the contract to spend tokens
     */
    function redeemWithApproval(NFTVoucher calldata voucher) 
        external 
        payable
        whenNotPaused
        nonReentrant
        returns (uint256) 
    {
        if (usedNonces[voucher.nonce]) revert VoucherAlreadyUsed();
        if (block.timestamp > voucher.deadline) revert VoucherExpired();
        if (_mintedCounts[voucher.recipient] >= MAX_MINT_PER_WALLET) revert MaxMintPerWalletExceeded();

        address signer = _verify(voucher);
        if (owner() != signer) revert InvalidSignature();

        // Checks-Effects-Interactions: mark nonce used and bump mint counter
        // BEFORE any external call (ETH forward / ERC20 transfer) to prevent
        // re-entrancy replay of the same voucher via a malicious paymentReceiver.
        usedNonces[voucher.nonce] = true;
        _mintedCounts[voucher.recipient]++;

        // Handle Payment (assumes approval already exists)
        uint256 totalPayment = voucher.basePrice + voucher.creatorTip;
        if (totalPayment > 0) {
            if (voucher.currency == address(0)) {
                // ETH Payment: exact amount required
                if (msg.value != totalPayment) revert ExactETHRequired(totalPayment, msg.value);
                if (voucher.basePrice > 0) {
                    (bool ok1, ) = payable(paymentReceiver).call{value: voucher.basePrice}("");
                    if (!ok1) revert TransferFailed();
                }
                if (voucher.creatorTip > 0) {
                    // slither-disable-next-line arbitrary-send-eth
                    (bool ok2, ) = payable(tipReceiver).call{value: voucher.creatorTip}("");
                    if (!ok2) revert TransferFailed();
                }
            } else {
                // ERC20 Payment - assumes approval exists from separate transaction or batch
                if (msg.value != 0) revert ETHWithERC20Payment();

                if (address(attrSpender) != address(0) &&
                    voucher.currency == address(attrSpender.ATTR_TOKEN())) {
                    // ATTR: route through shared spender.
                    // `voucher.recipient` is used for ERC-4337 smart account compatibility;
                    // it is safe because the full voucher struct is covered by the owner's
                    // EIP-712 signature verified above.
                    // slither-disable-next-line arbitrary-send-erc20
                    attrSpender.collectPayment(
                        voucher.recipient, paymentReceiver, tipReceiver,
                        voucher.basePrice, voucher.creatorTip
                    );
                } else {
                    // Other ERC20 — direct split transfer.
                    if (voucher.basePrice > 0) {
                        // slither-disable-next-line arbitrary-send-erc20
                        IERC20(voucher.currency).safeTransferFrom(voucher.recipient, paymentReceiver, voucher.basePrice);
                    }
                    if (voucher.creatorTip > 0) {
                        // slither-disable-next-line arbitrary-send-erc20
                        IERC20(voucher.currency).safeTransferFrom(voucher.recipient, tipReceiver, voucher.creatorTip);
                    }
                }
            }
        }

        return _mintNFT(voucher.recipient, voucher.uri);
    }

    /**
     * @dev Internal function to handle minting logic
     */
    function _mintNFT(address recipient, string memory uri) internal returns (uint256) {
        if (recipient == address(0)) revert ZeroAddress();
        if (bytes(uri).length == 0) revert EmptyURI();
        if (_nextTokenId > MAX_SUPPLY) revert MaxSupplyExceeded();

        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        emit NFTMinted(recipient, tokenId, uri);
        return tokenId;
    }

    /**
     * @dev Verify the voucher signature
     */
    function _verify(NFTVoucher calldata voucher) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            _VOUCHER_TYPEHASH,
            voucher.recipient,
            keccak256(bytes(voucher.uri)),
            keccak256(bytes(voucher.nonce)),
            voucher.currency,
            voucher.basePrice,
            voucher.creatorTip,
            voucher.deadline
        )));
        return ECDSA.recover(digest, voucher.signature);
    }

    /**
     * @dev Get the total number of NFTs minted
     * @return The total supply of NFTs
     */
    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @dev Get the next token ID that will be minted
     * @return The next token ID
     */
    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @dev Get the number of NFTs minted by a specific address in this collection
     * @param account The address to check
     * @return The number of NFTs minted by the account
     */
    function getMintedCount(address account) external view returns (uint256) {
        return _mintedCounts[account];
    }

    /**
     * @dev Returns the token collection name.
     */
    function name() public view override returns (string memory) {
        return super.name();
    }

    /**
     * @dev Returns the token collection symbol.
     */
    function symbol() public view override returns (string memory) {
        return super.symbol();
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721URIStorage, ERC2981)
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
