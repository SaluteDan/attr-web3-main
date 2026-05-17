// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Shared custom errors for the ATTR protocol contracts.
//
// Severity tiers (referenced in contracts/docs/ERRORS.md):
//   CRITICAL — exploitable without special access; fix immediately
//   HIGH     — revert on bad input / payment mismatch; fix before launch
//   MEDIUM   — guard rails that block normal misuse
//   LOW      — convenience / informational guards
// ─────────────────────────────────────────────────────────────────────────────

// ── CRITICAL ──────────────────────────────────────────────────────────────────

/// @dev EIP-712 voucher signature does not match the contract owner. [NFTCollection]
error InvalidSignature();

/// @dev Caller is not authorized to perform the action. [ATTRSpender, MembershipFeeDistributor]
error Unauthorized();

/// @dev A required address argument is the zero address. [All contracts]
error ZeroAddress();

/// @dev Collection is not authorized in ATTRSpender; only factory-registered collections may call. [ATTRSpender]
error UnauthorizedCollection();

// ── HIGH ──────────────────────────────────────────────────────────────────────

/// @dev Voucher deadline has passed. [NFTCollection]
error VoucherExpired();

/// @dev Voucher nonce has already been redeemed (replay protection). [NFTCollection]
error VoucherAlreadyUsed();

/// @dev ETH sent does not exactly equal basePrice + creatorTip. [NFTCollection]
error ExactETHRequired(uint256 required, uint256 sent);

/// @dev ETH sent is less than the tier price for a membership mint. [MembershipToken]
error InsufficientPayment(uint256 required, uint256 sent);

/// @dev ETH forward to receiver failed. [MembershipSaleSplitter, MembershipToken, MembershipFeeDistributor]
error TransferFailed();

/// @dev Claim caller does not own the supplied token ID. [MembershipFeeDistributor]
error NotTokenOwner(uint256 tokenId);

// ── MEDIUM ────────────────────────────────────────────────────────────────────

/// @dev Mint would exceed the collection's maximum supply. [NFTCollection, MembershipToken, ATTRToken]
error MaxSupplyExceeded();

/// @dev Minting address has already reached its per-wallet cap. [NFTCollection, MembershipToken]
error MaxMintPerWalletExceeded();

/// @dev ETH was sent alongside an ERC20-payment voucher. [NFTCollection]
error ETHWithERC20Payment();

/// @dev Input arrays have different lengths. [ATTRDeployer]
error ArrayLengthMismatch();

/// @dev Royalty fee exceeds 100% (10000 bps). [ATTRDeployer]
error RoyaltyFeeTooHigh();

// ── LOW ───────────────────────────────────────────────────────────────────────

/// @dev Token metadata URI string is empty. [NFTCollection, MembershipToken]
error EmptyURI();

/// @dev Collection name string is empty. [ATTRDeployer]
error EmptyName();

/// @dev Collection symbol string is empty. [ATTRDeployer]
error EmptySymbol();

/// @dev Array index is out of bounds. [ATTRDeployer]
error IndexOutOfBounds();

/// @dev Max supply must be greater than zero. [ATTRDeployer, MembershipToken]
error InvalidMaxSupply();

/// @dev Max mint per wallet must be > 0 and <= maxSupply. [ATTRDeployer, MembershipToken]
error InvalidMaxMintPerWallet();

/// @dev No funds available to withdraw or claim. [MembershipToken, MembershipFeeDistributor]
error NothingToClaim();

/// @dev Deposit amount must be greater than zero. [MembershipFeeDistributor]
error ZeroDeposit();

/// @dev No token IDs supplied to a claim call. [MembershipFeeDistributor]
error NoTokenIds();

/// @dev Payment splitter has no payees. [PaymentSplitter]
error NoPayees();

/// @dev Payment splitter payee address is the zero address. [PaymentSplitter]
error InvalidPayee();

/// @dev Payment splitter share value is zero. [PaymentSplitter]
error InvalidShare();

/// @dev Payment splitter payee is duplicated. [PaymentSplitter]
error DuplicatePayee();

/// @dev Nothing to release for the given account. [PaymentSplitter]
error NoPaymentDue();
