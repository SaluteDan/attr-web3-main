# Membership Token Deployment Guide

## Overview

The `MembershipToken` contract is an ERC721 token used for membership management with tier-based access control. Each token has a tier level that determines mint quotas in different collection stages.

## Contract Features

- **Tier-Based Membership**: Each token has a tier (1, 2, 3, etc.)
- **Metadata Storage**: Token metadata stored on IPFS with tier information
- **Batch Minting**: Mint multiple tokens in a single transaction
- **Tier Updates**: Update tier levels for existing tokens
- **Owner-Controlled**: Only contract owner can mint and manage tiers

## Deployment Steps

### 1. Compile the Contract

```bash
cd /Users/daniel/Documents/ATTR/Developmemt/backend
npx hardhat compile
```

This generates the contract ABI and bytecode needed for deployment.

### 2. Deploy Using Hardhat

Run the deployment script:

```bash
npx hardhat run scripts/deployMembershipToken.ts --network base
```

The script will:

- Deploy with name "ATTR Membership" and symbol "ATTR-MEMBER"
- Set the deployer as the initial owner
- Set the payment receiver (from `PAYMENT_RECEIVER` env var or deployer address)
- Output the deployed contract address

### 3. Update Environment Variables

After deployment, add the contract address to your `.env`:

```env
MEMBERSHIP_TOKEN_CONTRACT=0x<deployed_contract_address>
```

## Minting Membership Tokens

### Public Minting (Anyone Can Mint)

Users can mint membership tokens by paying the tier price:

```bash
# Single mint via script (admin only)
npx hardhat run scripts/mintMembershipToken.ts --network base -- <contractAddress> <recipient> <tier> <metadataURI>

# Example:
npx hardhat run scripts/mintMembershipToken.ts --network base -- 0x123... 0xAbc... 1 ipfs://QmXxx
```

**Contract Function:**

```solidity
function mintMembership(
    uint256 tier,
    string memory metadataURI
) public payable returns (uint256)
```

### Admin Minting (Owner Only)

Owner can mint without payment (for giveaways, etc.):

```bash
# Batch mint from JSON file
npx hardhat run scripts/mintMembershipToken.ts --network base -- <contractAddress> --batch memberships.json
```

**Contract Functions:**

```solidity
function adminMintMembership(
    address to,
    uint256 tier,
    string memory metadataURI
) public onlyOwner returns (uint256)

function adminBatchMintMemberships(
    address[] calldata recipients,
    uint256[] calldata tiers,
    string[] calldata metadataURIs
) public onlyOwner
```

### Batch Mint JSON Format

Create `memberships.json`:

```json
{
  "recipients": ["0x...", "0x..."],
  "tiers": [1, 2],
  "metadataURIs": ["ipfs://QmXxx1", "ipfs://QmXxx2"]
}
```

## Contract Functions

### Querying

**Get Token Tier:**

```solidity
function getTier(uint256 tokenId) public view returns (uint256)
```

**Get Next Token ID:**

```solidity
function getNextTokenId() public view returns (uint256)
```

**Get Token URI:**

```solidity
function tokenURI(uint256 tokenId) public view returns (string memory)
```

### Management

**Update Tier:**

```solidity
function updateTier(uint256 tokenId, uint256 newTier) public onlyOwner
```

## Token Metadata Format

Each token's metadata should include a `tier` field:

```json
{
  "name": "ATTR Membership #1",
  "description": "Tier 1 membership token",
  "image": "ipfs://...",
  "tier": 1,
  "attributes": [
    {
      "trait_type": "Tier",
      "value": "1"
    }
  ]
}
```

The backend will read the `tier` field from this metadata when validating mint access.

## Integration with Minting System

When a user calls `POST /mint/voucher` with a `membershipTokenId`:

1. Backend queries `MembershipToken.getTier(tokenId)`
2. Fetches token metadata via `tokenURI(tokenId)`
3. Extracts tier from metadata
4. Validates tier against stage `tierAllowances`
5. Checks global quota for that tier

## Example: Minting Membership Tokens

```typescript
// Mint single token with tier 1
await membership.mintMembership(
  "0x...", // recipient address
  1, // tier
  "ipfs://QmXxxx" // metadata URI
);

// Batch mint multiple tokens
await membership.batchMintMemberships(
  ["0xAddr1", "0xAddr2", "0xAddr3"],
  [1, 2, 1],
  ["ipfs://QmXxx1", "ipfs://QmXxx2", "ipfs://QmXxx3"]
);
```

## Testing

After deployment, verify the contract works:

```bash
# Get next token ID
cast call <CONTRACT_ADDRESS> "getNextTokenId()" --rpc-url <RPC_URL>

# Get token tier
cast call <CONTRACT_ADDRESS> "getTier(uint256)" 0 --rpc-url <RPC_URL>
```

## Security Notes

- Only the contract owner can mint and update tiers
- Tier values are stored on-chain for quick access
- Metadata is stored on IPFS for decentralization
- Token transfers are standard ERC721 (no restrictions)
