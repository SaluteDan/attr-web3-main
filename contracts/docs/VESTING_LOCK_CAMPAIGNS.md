# Vesting Lock Campaigns

`VestingLockCampaign` is a reusable on-chain campaign contract for ATTR vesting incentives. Users lock ATTR in the campaign contract, wait the configured period, then claim a prefunded reward directly from the same campaign.

## Contracts

- `VestingLockCampaign`: one isolated lock-and-reward campaign.
- `VestingLockCampaignFactory`: owner-controlled factory that deploys campaigns with different parameters.

Each campaign has immutable parameters:

| Parameter | Purpose |
| --- | --- |
| `stakingToken` | ERC20 users lock, normally ATTR |
| `rewardToken` | ERC20 paid as reward, normally ATTR |
| `minLockAmount` | Minimum lock amount required to enter |
| `lockPeriod` | Required lock duration in seconds |
| `rewardAmount` | Reward paid per eligible wallet |
| `campaignStart` | Timestamp when locking opens |
| `campaignEnd` | Timestamp when locking closes |
| `maxParticipants` | Optional participant cap; `0` means uncapped |
| `allowEarlyWithdraw` | If true, users can withdraw principal early and forfeit rewards |

## Recommended Flow

1. Deploy `VestingLockCampaignFactory`.
2. Use the factory owner/multisig to create a campaign.
3. Treasury approves the campaign for the reward pool.
4. Treasury calls `fundRewards(amount)`.
5. Frontend points `NEXT_PUBLIC_VESTING_LOCK_CAMPAIGN_ADDRESS` at the campaign.
6. User approves ATTR directly to the campaign contract.
7. User calls `lock(minLockAmount)`.
8. After `lockPeriod`, user calls `claimRewardAndWithdraw()` to claim the reward and recover locked ATTR in one transaction.
9. After `campaignEnd + lockPeriod`, owner calls `sweepUnallocatedRewards(recipient)`.

## Deployment

Deploy the factory:

```bash
npm run deploy:vesting-factory -- --network baseSepolia
```

The deploy script resolves the factory owner in this order:

1. `VESTING_FACTORY_OWNER`
2. `DAO_MULTISIG_ADDRESS`
3. `PLATFORM_TREASURY_ADDRESS`
4. deployer address

Set the resulting address in ops records:

```bash
VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS=0x...
```

## Creating A Campaign

Campaigns are created through:

```solidity
createCampaign(VestingLockCampaign.CampaignConfig calldata config)
```

Example parameters for a 30-day ATTR campaign:

```text
stakingToken: ATTR token address
rewardToken: ATTR token address
minLockAmount: 2,500 ATTR
lockPeriod: 30 days
rewardAmount: 5,000 ATTR
campaignStart: launch timestamp
campaignEnd: final timestamp users may start locks
maxParticipants: 0 for uncapped, or a fixed cap
allowEarlyWithdraw: false for strict vesting
```

After deployment, fund the campaign with enough reward tokens:

```text
requiredRewardPool = expectedParticipants * rewardAmount
```

If ATTR is both the staking token and reward token, the contract reserves user principal during reward sweeps so locked ATTR cannot be swept by the owner.

## Frontend Configuration

Set the active campaign address:

```bash
NEXT_PUBLIC_VESTING_LOCK_CAMPAIGN_ADDRESS=0x...
```

The frontend uses:

- `NEXT_PUBLIC_ATTR_POINT_ADDRESS` for ATTR reads and approvals.
- `NEXT_PUBLIC_VESTING_LOCK_CAMPAIGN_ADDRESS` for campaign reads/writes.

Milestone 2 is shown inside the existing profile `VestingStatusCard`. No separate card is required.

## ATTRSpender Consideration

`ATTRSpender` is currently scoped to NFT payment routing. It authorizes collection contracts to call `collectPayment(...)` and route base/tip amounts to mint receivers.

For vesting campaigns, the recommended launch flow is direct approval:

```text
user -> approve(VestingLockCampaign, amount)
user -> VestingLockCampaign.lock(amount)
```

This keeps custody and approval scope explicit. If we later want a single protocol-wide approval UX, introduce a dedicated generic spender or extend `ATTRSpender` deliberately with campaign-specific authorization and transfer semantics.

## Safety Notes

- Campaign parameters are immutable. Deploy a new campaign for new terms.
- Fund rewards before opening the campaign.
- Use a multisig as factory/campaign owner.
- Prefer `allowEarlyWithdraw = false` for strict “held for 30 days” vesting.
- If `allowEarlyWithdraw = true`, early withdrawal returns principal but permanently forfeits the reward.
- `claimReward()` and `withdrawLocked()` remain available as separate recovery/fallback actions, but the preferred user path is `claimRewardAndWithdraw()`.
- `sweepUnallocatedRewards` is only available after `campaignEnd + lockPeriod`.
