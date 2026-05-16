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
    
    // Receiver for mint payments
    address public paymentReceiver;

    /// @notice Represents a voucher to mint an NFT
    struct NFTVoucher {
        address recipient;
        string uri;
        string nonce;
        address currency; // address(0) for ETH, otherwise ERC20 address
        uint256 minPrice;
        uint256 deadline;
        bytes signature;
    }

    // EIP-712 TypeHash
    bytes32 private constant _VOUCHER_TYPEHASH =
        keccak256("NFTVoucher(address recipient,string uri,string nonce,address currency,uint256 minPrice,uint256 deadline)");

    // Track used nonces to prevent replay attacks
    mapping(string => bool) private usedNonces;

    // Errors
    error InvalidSignature();
    error VoucherAlreadyUsed();

    // Events
    event NFTMinted(address indexed recipient, uint256 indexed tokenId, string tokenURI);

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
        uint256 maxMintPerWallet_
    ) ERC721(name_, symbol_) Ownable(initialOwner) EIP712("NFTCollection", "1") {
        _nextTokenId = 1; // Start token IDs at 1
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        _contractURI = contractURI_;
        MAX_SUPPLY = maxSupply_;
        paymentReceiver = paymentReceiver_;
        MAX_MINT_PER_WALLET = maxMintPerWallet_;
    }

    /**
     * @dev Returns the collection-level metadata URI
     * @return The contract URI string
     */
    function contractURI() public view returns (string memory) {
        return _contractURI;
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
        require(!usedNonces[voucher.nonce], "Nonce already used");
        require(block.timestamp <= voucher.deadline, "Voucher expired");
        require(_mintedCounts[voucher.recipient] < MAX_MINT_PER_WALLET, "Max mint per wallet exceeded");

        address signer = _verify(voucher);
        require(owner() == signer, "Invalid voucher signature");

        // Checks-Effects-Interactions: mark nonce used and bump mint counter
        // BEFORE any external call (ETH forward / ERC20 transfer) to prevent
        // re-entrancy replay of the same voucher via a malicious paymentReceiver.
        usedNonces[voucher.nonce] = true;
        _mintedCounts[voucher.recipient]++;

        // Handle Payment with Permit
        if (voucher.minPrice > 0) {
            if (voucher.currency == address(0)) {
                // ETH Payment
                require(msg.value >= voucher.minPrice, "Insufficient ETH sent");
                
                // Forward ETH to payment receiver
                (bool success, ) = payable(paymentReceiver).call{value: msg.value}("");
                require(success, "Failed to send ETH");
            } else {
                // ERC20 Payment with Permit
                require(msg.value == 0, "ETH sent with ERC20 payment");
                
                // Execute permit to approve this contract
                // The permit allows the contract to transfer tokens on behalf of msg.sender
                // Parameter order: owner, spender, value, deadline, v, r, s
                try IERC20Permit(voucher.currency).permit(
                    msg.sender,
                    address(this),
                    voucher.minPrice,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s
                ) {
                    // Permit executed successfully
                } catch Error(string memory reason) {
                    // Permit failed - revert with reason
                    revert(reason);
                } catch {
                    // Permit failed for unknown reason
                    revert("Permit execution failed");
                }
                
                // Transfer tokens from user to payment receiver
                IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.minPrice);
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
        require(!usedNonces[voucher.nonce], "Nonce already used");
        require(block.timestamp <= voucher.deadline, "Voucher expired");
        require(_mintedCounts[voucher.recipient] < MAX_MINT_PER_WALLET, "Max mint per wallet exceeded");

        address signer = _verify(voucher);
        require(owner() == signer, "Invalid voucher signature");

        // Checks-Effects-Interactions: mark nonce used and bump mint counter
        // BEFORE any external call (ETH forward / ERC20 transfer) to prevent
        // re-entrancy replay of the same voucher via a malicious paymentReceiver.
        usedNonces[voucher.nonce] = true;
        _mintedCounts[voucher.recipient]++;

        // Handle Payment (assumes approval already exists)
        if (voucher.minPrice > 0) {
            if (voucher.currency == address(0)) {
                // ETH Payment
                require(msg.value >= voucher.minPrice, "Insufficient ETH sent");
                
                // Forward ETH to payment receiver
                (bool success, ) = payable(paymentReceiver).call{value: msg.value}("");
                require(success, "Failed to send ETH");
            } else {
                // ERC20 Payment - assumes approval exists from separate transaction or batch
                require(msg.value == 0, "ETH sent with ERC20 payment");
                
                // Transfer tokens from voucher recipient to payment receiver.
                // `voucher.recipient` is used instead of `msg.sender` for ERC-4337
                // smart account compatibility: with wallet_sendCalls, msg.sender is
                // the EntryPoint/bundler, not the token owner. The recipient field is
                // safe here because the entire voucher struct (including recipient) is
                // covered by the owner's EIP-712 signature verified above — an attacker
                // cannot substitute an arbitrary address without invalidating the sig.
                // slither-disable-next-line arbitrary-send-erc20
                IERC20(voucher.currency).safeTransferFrom(voucher.recipient, paymentReceiver, voucher.minPrice);
            }
        }

        return _mintNFT(voucher.recipient, voucher.uri);
    }

    /**
     * @dev Internal function to handle minting logic
     */
    function _mintNFT(address recipient, string memory uri) internal returns (uint256) {
        require(recipient != address(0), "Cannot mint to zero address");
        require(bytes(uri).length > 0, "URI cannot be empty");
        require(_nextTokenId <= MAX_SUPPLY, "Max supply exceeded");

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
            voucher.minPrice,
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
