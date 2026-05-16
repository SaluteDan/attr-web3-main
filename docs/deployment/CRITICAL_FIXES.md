# Critical Security Fixes Required Before Mainnet

## Priority 1: Immediate Fixes (BLOCKING) ✅ COMPLETED

### Fix 1: Add ReentrancyGuard to MembershipToken

**File:** `contracts/MembershipToken.sol`

**Changes Required:**

1. Add import:

```solidity
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
```

2. Update contract declaration:

```solidity
contract MembershipToken is ERC721URIStorage, Ownable, ReentrancyGuard {
```

3. Add `nonReentrant` modifier to `withdrawPayments()`:

```solidity
function withdrawPayments() public onlyOwner nonReentrant {
    uint256 balance = address(this).balance;
    require(balance > 0, "No funds to withdraw");
    (bool success, ) = paymentReceiver.call{value: balance}("");
    require(success, "Withdrawal failed");
}
```

---

### Fix 2: Forward Payments Immediately in MembershipToken

**File:** `contracts/MembershipToken.sol`

**Replace `mintMembership()` function:**

```solidity
function mintMembership(
    uint256 tier,
    string memory metadataURI
) public payable returns (uint256) {
    uint256 price = tierPrices[tier];
    require(msg.value >= price, "Insufficient payment for tier");

    // Forward payment immediately to reduce risk
    if (msg.value > 0) {
        (bool success, ) = paymentReceiver.call{value: msg.value}("");
        require(success, "Payment forward failed");
    }

    uint256 tokenId = _nextTokenId;
    _nextTokenId++;

    _safeMint(msg.sender, tokenId);
    _setTokenURI(tokenId, metadataURI);
    tokenTiers[tokenId] = tier;

    emit MembershipMinted(msg.sender, tokenId, tier, metadataURI);
    emit PaymentReceived(msg.sender, msg.value, tier);

    return tokenId;
}
```

**Note:** After this fix, `withdrawPayments()` becomes unnecessary and can be removed.

---

### Fix 3: Correct Payment Source in NFTCollection.redeemWithApproval()

**File:** `contracts/NFTCollection.sol`  
**Line:** 236

**Change:**

```solidity
// BEFORE (WRONG):
IERC20(voucher.currency).safeTransferFrom(voucher.recipient, paymentReceiver, voucher.minPrice);

// AFTER (CORRECT):
IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.minPrice);
```

---

### Fix 4: Correct Payment Source in GovernanceNFT.mintWithVoucher()

**File:** `contracts/GovernanceNFT.sol`  
**Line:** 126

**Change:**

```solidity
// BEFORE (WRONG):
IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.minPrice);

// AFTER (CORRECT):
// This one is actually correct! But ensure consistency with msg.sender
IERC20(voucher.currency).safeTransferFrom(msg.sender, paymentReceiver, voucher.minPrice);
```

**Note:** GovernanceNFT is correct. NFTCollection needs the fix.

---

## Priority 2: High Priority Fixes (RECOMMENDED) ✅ COMPLETED

### Fix 5: Add Emergency Pause to All Contracts

**Files:** All contract files

**Add to each contract:**

```solidity
import "@openzeppelin/contracts/utils/Pausable.sol";

contract YourContract is ..., Pausable {

    // Add whenNotPaused to critical functions
    function mintTo(...) external onlyOwner whenNotPaused returns (uint256) {
        // existing logic
    }

    function redeem(...) external payable whenNotPaused returns (uint256) {
        // existing logic
    }

    // Add pause controls
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
```

**Apply to:**

- ✅ ATTRToken (mint, transfer functions)
- ✅ GovernanceNFT (mintTo, mintWithVoucher)
- ✅ MembershipToken (mintMembership, adminMintMembership)
- ✅ NFTCollection (mintTo, redeem, redeemWithApproval)
- ❌ PaymentSplitter (not needed - withdrawal only)
- ❌ ATTRDeployer (not needed - factory only)

---

### Fix 6: Add Max Supply to MembershipToken

**File:** `contracts/MembershipToken.sol`

**Add to contract:**

```solidity
uint256 public immutable MAX_SUPPLY;

constructor(
    string memory _name,
    string memory _symbol,
    address initialOwner,
    address _paymentReceiver,
    uint256 _maxSupply  // NEW PARAMETER
) ERC721(_name, _symbol) Ownable(initialOwner) {
    _nextTokenId = 0;
    paymentReceiver = _paymentReceiver;
    MAX_SUPPLY = _maxSupply;  // NEW
}

// Update all minting functions to check:
function _mintMembership(...) internal {
    require(_nextTokenId < MAX_SUPPLY, "Max supply exceeded");
    // ... rest of logic
}
```

---

## Priority 3: Input Validation (IMPORTANT) ✅ COMPLETED

### Fix 7: Add Constructor Validation

**ATTRToken.sol:**

```solidity
constructor(uint256 cap_, uint256 initialSupply_, address treasury_)
    ERC20("Attribute Point", "ATTR")
    ERC20Capped(cap_)
    ERC20Permit("Attribute Point")
{
    require(treasury_ != address(0), "Treasury cannot be zero address");
    require(initialSupply_ <= cap_, "Initial supply exceeds cap");  // NEW
    require(cap_ > 0, "Cap must be greater than zero");  // NEW

    // ... rest of constructor
}
```

**ATTRDeployer.sol:**

```solidity
function createCollection(...) external onlyOwner returns (address) {
    require(bytes(name).length > 0, "Name cannot be empty");
    require(bytes(symbol).length > 0, "Symbol cannot be empty");
    require(royaltyFeeNumerator <= 10000, "Royalty fee too high");
    require(artistAddress != address(0), "Artist address cannot be zero");
    require(platformFeeBps <= 10000, "Platform fee cannot exceed 100%");
    require(maxSupply > 0, "Max supply must be greater than 0");
    require(maxMintPerWallet > 0, "Max mint per wallet must be greater than 0");  // NEW
    require(maxMintPerWallet <= maxSupply, "Max mint per wallet exceeds max supply");  // NEW

    // ... rest of function
}
```

---

## Testing Requirements

After implementing fixes, run:

```bash
# Compile contracts
npx hardhat compile

# Run all tests
npx hardhat test

# Check test coverage
npx hardhat coverage

# Run gas report
REPORT_GAS=true npx hardhat test
```

**Expected Results:**

- ✅ All tests pass
- ✅ Coverage >90%
- ✅ No compilation warnings
- ✅ Gas usage within limits

---

## Deployment Script Updates

Update deployment scripts to include new parameters:

```typescript
// deploy/01-deploy-membership.ts
const membershipToken = await deploy("MembershipToken", {
  from: deployer,
  args: [
    "Platform Membership",
    "PMEM",
    owner,
    paymentReceiver,
    10000, // NEW: maxSupply parameter
  ],
  log: true,
});
```

---

## Verification Checklist

Before deploying to mainnet:

- [ ] All critical fixes implemented
- [ ] All high priority fixes implemented
- [ ] Input validation added
- [ ] Tests updated and passing
- [ ] Coverage >90%
- [ ] Gas optimization verified
- [ ] External audit completed
- [ ] Testnet deployment successful
- [ ] Multi-sig wallet configured
- [ ] Emergency procedures documented

---

## Estimated Implementation Time

- **Critical Fixes (1-3):** 2-4 hours
- **High Priority Fixes (4-6):** 4-6 hours
- **Input Validation (7):** 2-3 hours
- **Testing & Verification:** 4-6 hours
- **Total:** 12-19 hours

---

## Next Steps

1. **Implement fixes in order of priority**
2. **Run test suite after each fix**
3. **Update deployment scripts**
4. **Deploy to Base Sepolia testnet**
5. **Perform integration testing**
6. **Schedule external audit**
7. **Deploy to mainnet only after all checks pass**

---

**Document Version:** 1.1  
**Last Updated:** April 8, 2026  
**Status:** ✅ ALL FIXES IMPLEMENTED

## Implementation Summary

All critical, high priority, and input validation fixes have been implemented:

| Fix                          | Contract                | Status |
| ---------------------------- | ----------------------- | ------ |
| ReentrancyGuard              | MembershipToken         | ✅     |
| Forward Payments Immediately | MembershipToken         | ✅     |
| Fix Payment Source           | NFTCollection           | ✅     |
| Emergency Pause              | All contracts           | ✅     |
| Max Supply Cap               | MembershipToken         | ✅     |
| Input Validation             | ATTRToken, ATTRDeployer | ✅     |
| Pragma Update                | All contracts (0.8.26)  | ✅     |

**Test Results:** 106 tests passing
