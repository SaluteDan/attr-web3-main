// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Errors.sol";

/**
 * @title ATTRSpender
 * @dev Shared ATTR-token payment proxy for all factory-deployed NFT collections.
 *      Users approve ATTR once to this contract; authorised collections call
 *      `collectPayment` to pull base + tip amounts from a payer and route them
 *      to separate receivers.
 *
 *      Only the owner (ATTRDeployer) may authorise or revoke collections.
 *      This keeps the approval surface narrow: one allowance, one spender.
 */
contract ATTRSpender is Ownable {
    using SafeERC20 for IERC20;

    /// @notice The ATTR ERC20 token this contract operates on.
    IERC20 public immutable ATTR_TOKEN;

    /// @notice Tracks which collection addresses are allowed to call `collectPayment`.
    mapping(address => bool) public authorizedCollections;

    // ── Events ─────────────────────────────────────────────────────────────────

    event CollectionAuthorized(address indexed collection, bool authorized);

    event PaymentCollected(
        address indexed collection,
        address indexed payer,
        address primaryReceiver,
        address tipReceiver,
        uint256 baseAmount,
        uint256 tipAmount
    );

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param attrToken_    Address of the ATTR ERC20 token.
     * @param initialOwner  Owner address (should be ATTRDeployer).
     */
    constructor(address attrToken_, address initialOwner) Ownable(initialOwner) {
        if (attrToken_ == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();
        ATTR_TOKEN = IERC20(attrToken_);
    }

    // ── Owner Functions ────────────────────────────────────────────────────────

    /**
     * @notice Grant or revoke collection authorisation.
     * @dev Only the owner (ATTRDeployer) calls this — automatically on each `createCollection`.
     * @param collection  Collection contract address.
     * @param authorized  True to authorise, false to revoke.
     */
    function setCollectionAuthorized(address collection, bool authorized) external onlyOwner {
        if (collection == address(0)) revert ZeroAddress();
        authorizedCollections[collection] = authorized;
        emit CollectionAuthorized(collection, authorized);
    }

    // ── Collection-facing Functions ────────────────────────────────────────────

    /**
     * @notice Pull ATTR from `payer` and route base + tip to their respective receivers.
     * @dev Only callable by an authorised collection contract.
     *      The collection is responsible for verifying the payer has approved this contract.
     *      Emits {PaymentCollected}.
     *
     * @param payer            Address whose ATTR balance is pulled (voucher signer / msg.sender in the collection).
     * @param primaryReceiver  Receives `baseAmount` ATTR (mint payment receiver).
     * @param tipReceiver      Receives `tipAmount` ATTR (creator tip receiver).
     * @param baseAmount       Base mint price in ATTR wei.
     * @param tipAmount        Creator tip in ATTR wei (may be 0).
     */
    function collectPayment(
        address payer,
        address primaryReceiver,
        address tipReceiver,
        uint256 baseAmount,
        uint256 tipAmount
    ) external {
        if (!authorizedCollections[msg.sender]) revert UnauthorizedCollection();
        if (payer == address(0)) revert ZeroAddress();
        if (primaryReceiver == address(0)) revert ZeroAddress();

        if (baseAmount > 0) {
            // slither-disable-next-line arbitrary-send-erc20
            ATTR_TOKEN.safeTransferFrom(payer, primaryReceiver, baseAmount);
        }
        if (tipAmount > 0) {
            if (tipReceiver == address(0)) revert ZeroAddress();
            // slither-disable-next-line arbitrary-send-erc20
            ATTR_TOKEN.safeTransferFrom(payer, tipReceiver, tipAmount);
        }

        emit PaymentCollected(msg.sender, payer, primaryReceiver, tipReceiver, baseAmount, tipAmount);
    }
}
