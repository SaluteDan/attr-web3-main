# Royalty Configuration Guide

## Overview

The enhanced PaymentSplitter system automatically handles royalty distribution between artists and the platform based on configuration.

## Environment Variables

Add these to your `.env` file:

```bash
# Factory contract address (deployed ATTRDeployer)
FACTORY_CONTRACT_ADDRESS=0x...

# Platform treasury address (receives platform fees)
PLATFORM_TREASURY_ADDRESS=0x...

# Default platform fee in basis points (optional, defaults to 0)
DEFAULT_PLATFORM_FEE_BPS=1000  # 10%
```

## Royalty Flow

### Scenario 1: With Platform Fee

```json
{
  "mint": {
    "sellerFee": 500, // 5% artist royalty
    "platformFee": 1000 // 10% additional platform fee
  }
}
```

**Result:**

- PaymentSplitter deployed automatically
- Artist gets: 5% of sale price (500 bps)
- Platform gets: 10% of sale price (1000 bps)
- **Total royalty: 15% of sale price (1500 bps)**
- Royalties accumulate in PaymentSplitter
- Must be claimed via `releaseAll()` or individual `release()`

### Scenario 2: No Platform Fee

```json
{
  "mint": {
    "sellerFee": 500, // 5% total royalty
    "platformFee": 0 // No platform fee
  }
}
```

**Result:**

- No PaymentSplitter deployed
- Artist receives royalties directly
- 100% of royalties go to artist (5% of sale price)

## API Response

The `deployCollection` response now includes PaymentSplitter information:

```json
{
  "contractAddress": "0x...",
  "collectionId": "...",
  "txHash": "0x...",
  "paymentSplitter": "0x..." // null if no platform fee
}
```

## Database Storage

Collections now store:

- `royaltyReceiver`: Address that receives royalties (artist or PaymentSplitter)
- `paymentSplitter`: PaymentSplitter contract address (if deployed)
- `platformFeeBps`: Platform fee in basis points
- `platformTreasury`: Platform treasury address

## CRON Automation

Use the factory service to automate royalty distribution:

```typescript
import factoryService from "./services/factory.service";

// Get all PaymentSplitters
const splitters = await factoryService.getDeployedSplitters();

// Distribute royalties for each splitter
for (const splitterAddress of splitters) {
  // Use your PaymentSplitter contract instance
  await paymentSplitter.releaseAll();
}
```

## Troubleshooting

1. **PaymentSplitter not deployed**: Check that `platformFeeBps > 0` and `PLATFORM_TREASURY_ADDRESS` is set
2. **Royalties not received**: Check if PaymentSplitter exists - royalties may need to be claimed
3. **Platform fee ignored**: Ensure `PLATFORM_TREASURY_ADDRESS` is not zero address

## Testing

Run the enhanced tests:

```bash
npx hardhat test test/PaymentSplitter.test.ts
npx hardhat test test/ATTRDeployer.test.ts
```
