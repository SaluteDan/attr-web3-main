# ATTR Protocol — Custom Error Reference

All custom errors are declared in [`contracts/Errors.sol`](../Errors.sol) and imported by each contract that uses them. This single-source approach ensures consistent ABI encoding across the protocol and avoids selector collisions.

## Severity Tiers

| Tier | Meaning |
|------|---------|
| **CRITICAL** | Exploitable or bypass-able without special access; must be fixed before any deployment |
| **HIGH** | Reverts on bad input or payment mismatch; must be fixed before launch |
| **MEDIUM** | Guard rails that block normal misuse |
| **LOW** | Convenience / informational guards |

---

## CRITICAL

| Error | Selector | Used by | Trigger |
|-------|----------|---------|---------|
| `InvalidSignature()` | — | `NFTCollection` | EIP-712 voucher signature does not match the contract owner |
| `Unauthorized()` | — | `ATTRSpender`, `MembershipFeeDistributor` | Caller is not authorised to perform the action |
| `ZeroAddress()` | — | All contracts | A required address argument is `address(0)` |
| `UnauthorizedCollection()` | — | `ATTRSpender` | Collection is not registered in `ATTRSpender`; only factory-deployed collections may call `collectPayment` |

---

## HIGH

| Error | Selector | Used by | Trigger |
|-------|----------|---------|---------|
| `VoucherExpired()` | — | `NFTCollection` | `block.timestamp > voucher.deadline` |
| `VoucherAlreadyUsed()` | — | `NFTCollection` | Nonce has already been redeemed (replay protection) |
| `ExactETHRequired(uint256 required, uint256 sent)` | — | `NFTCollection` | `msg.value != basePrice + creatorTip` for an ETH-payment voucher |
| `InsufficientPayment(uint256 required, uint256 sent)` | — | `MembershipToken` | `msg.value < tierPrices[tier]` on `mintMembership` |
| `TransferFailed()` | — | `MembershipSaleSplitter`, `MembershipToken`, `MembershipFeeDistributor` | Low-level ETH `.call` returned `false` |
| `NotTokenOwner(uint256 tokenId)` | — | `MembershipFeeDistributor` | Claim caller does not own the supplied token ID |

---

## MEDIUM

| Error | Selector | Used by | Trigger |
|-------|----------|---------|---------|
| `MaxSupplyExceeded()` | — | `NFTCollection`, `MembershipToken`, `ATTRToken` | Mint would push total supply past `MAX_SUPPLY` / cap |
| `MaxMintPerWalletExceeded()` | — | `NFTCollection`, `MembershipToken` | Wallet has already reached its per-wallet mint cap |
| `ETHWithERC20Payment()` | — | `NFTCollection` | ETH sent alongside an ERC20-payment voucher |
| `ArrayLengthMismatch()` | — | `ATTRDeployer`, `PaymentSplitter` | Two parallel input arrays have different lengths, or an array is empty where one element is required |
| `RoyaltyFeeTooHigh()` | — | `ATTRDeployer` | Royalty fee exceeds 10 000 bps (100%) |

---

## LOW

| Error | Selector | Used by | Trigger |
|-------|----------|---------|---------|
| `EmptyURI()` | — | `NFTCollection`, `MembershipToken` | Token metadata URI string is empty |
| `EmptyName()` | — | `ATTRDeployer` | Collection name string is empty |
| `EmptySymbol()` | — | `ATTRDeployer` | Collection symbol string is empty |
| `IndexOutOfBounds()` | — | `ATTRDeployer` | `getCollectionAt(i)` called with `i >= collectionCount` |
| `InvalidMaxSupply()` | — | `ATTRDeployer`, `MembershipToken`, `MembershipFeeDistributor` | Max supply is zero, or `totalMintedSnapshot` is zero when a deposit is attempted |
| `InvalidMaxMintPerWallet()` | — | `ATTRDeployer`, `MembershipToken` | Per-wallet cap is zero or exceeds `maxSupply` |
| `NothingToClaim()` | — | `MembershipToken`, `MembershipFeeDistributor` | No funds available to withdraw or claim |
| `ZeroDeposit()` | — | `MembershipFeeDistributor` | Deposit amount is zero (also used as `receive()` guard) |
| `NoTokenIds()` | — | `MembershipFeeDistributor` | Empty `tokenIds[]` array passed to a claim function |
| `NoPayees()` | — | `PaymentSplitter` | Constructor called with an empty payees array |
| `InvalidPayee()` | — | `PaymentSplitter` | Account has no shares (cannot release) |
| `InvalidShare()` | — | `PaymentSplitter` | Share value is zero |
| `DuplicatePayee()` | — | `PaymentSplitter` | Payee address already has shares |
| `NoPaymentDue()` | — | `PaymentSplitter` | Nothing to release for the given account |

---

## Testing

Every error listed above is covered by at least one `revertedWithCustomError` assertion in the Hardhat test suite (`test/contracts/`) and, where applicable, by Foundry fuzz tests (`test/fuzz/`).

To run all tests:

```bash
npm test          # Hardhat unit tests
npm run test:fuzz # Foundry fuzz + invariant tests
```
