// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./NFTCollection.sol";
import "./PaymentSplitter.sol";
import "./ATTRSpender.sol";
import "./Errors.sol";

/**
 * @title ATTRDeployer
 * @dev Factory contract for deploying new NFT collections
 * @notice Only the owner (backend) can deploy new collections
 */
contract ATTRDeployer is Ownable {
    // Array to track all deployed collections
    address[] private deployedCollections;
    
    // Mapping from collection address to its PaymentSplitter address (if any)
    mapping(address => address) private collectionToSplitter;
    
    // Array to track all deployed PaymentSplitters
    address[] private deployedSplitters;

    // Shared ATTR payment proxy — auto-authorises each new collection on deploy
    ATTRSpender public attrSpender;

    // Events

    /// @dev Emitted when a new NFT collection is deployed by the factory.
    event CollectionDeployed(
        address indexed collection,
        address indexed creator,
        string name,
        string symbol,
        address royaltyReceiver,
        address primaryReceiver,
        address tipReceiver,
        address royaltySplitter,
        address mintSplitter
    );

    /// @dev Legacy alias kept for off-chain indexers that rely on the old event.
    event CollectionCreated(
        address indexed collectionAddress,
        string name,
        string symbol,
        address indexed creator,
        address royaltyReceiver,
        address paymentSplitter
    );

    /**
     * @dev Constructor sets the initial owner and the shared ATTRSpender.
     * @param initialOwner  Backend wallet that owns the factory.
     * @param attrSpender_  Address of the deployed ATTRSpender (address(0) to skip ATTR routing).
     */
    constructor(address initialOwner, address attrSpender_) Ownable(initialOwner) {
        attrSpender = ATTRSpender(attrSpender_);
    }

    /**
     * @dev Deploy a new NFT collection with unified payment distribution (same for mint and royalty)
     * @param name The name of the collection
     * @param symbol The symbol of the collection
     * @param royaltyFeeNumerator The total royalty fee in basis points (e.g. 500 = 5%) charged on secondary sales
     * @param creators Array of creator addresses that will receive royalty and mint payments
     * @param shares Array of share weights for each creator (any proportional values, e.g. [2, 4] for 1/3, 2/3 split)
     * @param contractURI The URI for the collection-level metadata
     * @param maxSupply The maximum number of NFTs that can be minted
     * @param maxMintPerWallet The maximum number of NFTs a single wallet can mint
     * @return The address of the newly deployed collection
     * @notice If creators.length == 1, payments go directly to that address (no splitter).
     *         If creators.length >= 2, a PaymentSplitter is deployed and receives all payments.
     */
    function createCollection(
        string memory name,
        string memory symbol,
        uint96 royaltyFeeNumerator,
        address[] memory creators,
        uint256[] memory shares,
        string memory contractURI,
        uint256 maxSupply,
        uint256 maxMintPerWallet
    )
        external
        onlyOwner
        returns (address)
    {
        if (creators.length == 0) revert ArrayLengthMismatch();
        return createCollectionWithSeparateReceivers(
            name,
            symbol,
            royaltyFeeNumerator,
            creators,
            shares,
            creators, // Same creators for mint payments
            shares,   // Same shares for mint payments
            contractURI,
            maxSupply,
            maxMintPerWallet,
            creators[0] // tipReceiver defaults to first creator
        );
    }

    /**
     * @dev Deploy a new NFT collection with separate mint and royalty payment distribution
     * @param name The name of the collection
     * @param symbol The symbol of the collection
     * @param royaltyFeeNumerator The total royalty fee in basis points for secondary sales
     * @param royaltyCreators Array of creator addresses for royalty payments
     * @param royaltyShares Array of share weights for royalty creators
     * @param mintCreators Array of creator addresses for mint payments
     * @param mintShares Array of share weights for mint creators
     * @param contractURI The URI for the collection-level metadata
     * @param maxSupply The maximum number of NFTs that can be minted
     * @param maxMintPerWallet The maximum number of NFTs a single wallet can mint
     * @return The address of the newly deployed collection
     */
    function createCollectionWithSeparateReceivers(
        string memory name,
        string memory symbol,
        uint96 royaltyFeeNumerator,
        address[] memory royaltyCreators,
        uint256[] memory royaltyShares,
        address[] memory mintCreators,
        uint256[] memory mintShares,
        string memory contractURI,
        uint256 maxSupply,
        uint256 maxMintPerWallet,
        address tipReceiver_
    )
        public
        onlyOwner
        returns (address)
    {
        if (tipReceiver_ == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (royaltyFeeNumerator > 10000) revert RoyaltyFeeTooHigh();
        if (royaltyCreators.length == 0 || royaltyCreators.length != royaltyShares.length) revert ArrayLengthMismatch();
        if (mintCreators.length == 0 || mintCreators.length != mintShares.length) revert ArrayLengthMismatch();
        if (maxSupply == 0) revert InvalidMaxSupply();
        if (maxMintPerWallet == 0 || maxMintPerWallet > maxSupply) revert InvalidMaxMintPerWallet();

        // Validate royalty creators and shares
        for (uint256 i = 0; i < royaltyCreators.length; i++) {
            if (royaltyCreators[i] == address(0)) revert ZeroAddress();
            if (royaltyShares[i] == 0) revert InvalidShare();
        }

        // Validate mint creators and shares
        for (uint256 i = 0; i < mintCreators.length; i++) {
            if (mintCreators[i] == address(0)) revert ZeroAddress();
            if (mintShares[i] == 0) revert InvalidShare();
        }

        // Setup royalty receiver
        address royaltyReceiver;
        address royaltySplitterAddress;

        if (royaltyCreators.length == 1) {
            // Single royalty creator - direct payment
            royaltyReceiver = royaltyCreators[0];
            royaltySplitterAddress = address(0);
        } else {
            // Multiple royalty creators - deploy PaymentSplitter
            PaymentSplitter royaltySplitter = new PaymentSplitter(royaltyCreators, royaltyShares);
            royaltySplitterAddress = address(royaltySplitter);
            royaltyReceiver = royaltySplitterAddress;
            deployedSplitters.push(royaltySplitterAddress);
        }

        // Setup mint payment receiver
        address mintPaymentReceiver;

        if (mintCreators.length == 1) {
            // Single mint creator - direct payment
            mintPaymentReceiver = mintCreators[0];
        } else if (_arraysEqual(royaltyCreators, mintCreators, royaltyShares, mintShares)) {
            // Identical distribution for mint and royalty - reuse the royalty
            // splitter instead of deploying a second identical contract.
            // Safe because PaymentSplitter separates accounting per deposit and
            // distributes based on share weights regardless of payment source.
            mintPaymentReceiver = royaltySplitterAddress;
        } else {
            // Multiple mint creators with a different distribution - deploy a dedicated splitter
            PaymentSplitter mintSplitter = new PaymentSplitter(mintCreators, mintShares);
            mintPaymentReceiver = address(mintSplitter);
            deployedSplitters.push(mintPaymentReceiver);
        }

        // Determine mint splitter address for event (only when a dedicated one was deployed)
        address mintSplitterAddress = (mintCreators.length > 1 &&
            !_arraysEqual(royaltyCreators, mintCreators, royaltyShares, mintShares))
            ? mintPaymentReceiver
            : address(0);

        // Deploy new collection
        NFTCollection newCollection = new NFTCollection(
            name,
            symbol,
            msg.sender,
            royaltyReceiver,
            royaltyFeeNumerator,
            contractURI,
            maxSupply,
            mintPaymentReceiver,
            maxMintPerWallet,
            tipReceiver_,
            address(attrSpender)
        );
        address collectionAddress = address(newCollection);

        // Track the deployed collection
        deployedCollections.push(collectionAddress);

        // Store the mapping from collection to royalty splitter (if any)
        if (royaltySplitterAddress != address(0)) {
            collectionToSplitter[collectionAddress] = royaltySplitterAddress;
        }

        // Auto-authorise the new collection in ATTRSpender
        if (address(attrSpender) != address(0)) {
            attrSpender.setCollectionAuthorized(collectionAddress, true);
        }

        emit CollectionDeployed(
            collectionAddress,
            msg.sender,
            name,
            symbol,
            royaltyReceiver,
            mintPaymentReceiver,
            tipReceiver_,
            royaltySplitterAddress,
            mintSplitterAddress
        );
        emit CollectionCreated(collectionAddress, name, symbol, msg.sender, royaltyReceiver, royaltySplitterAddress);

        return collectionAddress;
    }

    /**
     * @dev Get all deployed collection addresses
     * @return Array of deployed collection addresses
     */
    function getDeployedCollections() external view returns (address[] memory) {
        return deployedCollections;
    }

    /**
     * @dev Get the total number of deployed collections
     * @return The count of deployed collections
     */
    function getCollectionCount() external view returns (uint256) {
        return deployedCollections.length;
    }

    /**
     * @dev Get a specific collection address by index
     * @param index The index of the collection
     * @return The address of the collection at the given index
     */
    function getCollectionAt(uint256 index) external view returns (address) {
        if (index >= deployedCollections.length) revert IndexOutOfBounds();
        return deployedCollections[index];
    }

    /**
     * @dev Get the PaymentSplitter address for a specific collection
     * @param collectionAddress The address of the collection
     * @return The address of the PaymentSplitter (address(0) if none)
     */
    function getPaymentSplitter(address collectionAddress) external view returns (address) {
        return collectionToSplitter[collectionAddress];
    }

    /**
     * @dev Get all deployed PaymentSplitter addresses
     * @return Array of deployed PaymentSplitter addresses
     */
    function getDeployedSplitters() external view returns (address[] memory) {
        return deployedSplitters;
    }

    /**
     * @dev Get the total number of deployed PaymentSplitters
     * @return The count of deployed PaymentSplitters
     */
    function getSplitterCount() external view returns (uint256) {
        return deployedSplitters.length;
    }

    /**
     * @dev Get a specific PaymentSplitter address by index
     * @param index The index of the PaymentSplitter
     * @return The address of the PaymentSplitter at the given index
     */
    function getSplitterAt(uint256 index) external view returns (address) {
        if (index >= deployedSplitters.length) revert IndexOutOfBounds();
        return deployedSplitters[index];
    }

    /**
     * @dev Check whether two (addresses, shares) distributions are identical.
     *      Used to reuse a single PaymentSplitter when mint and royalty configs match,
     *      avoiding a duplicate splitter deployment.
     */
    function _arraysEqual(
        address[] memory a,
        address[] memory b,
        uint256[] memory aShares,
        uint256[] memory bShares
    ) private pure returns (bool) {
        if (a.length != b.length) return false;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i] || aShares[i] != bShares[i]) return false;
        }
        return true;
    }
}
