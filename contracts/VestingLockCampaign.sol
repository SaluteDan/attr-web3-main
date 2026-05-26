// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Errors.sol";

/**
 * @title VestingLockCampaign
 * @author Attributes Platform
 * @notice Reusable lock-to-earn campaign for ATTR vesting and retention incentives.
 * @dev Users lock `stakingToken` for `lockPeriod`; rewards are paid from this
 *      contract's prefunded `rewardToken` balance.
 */
contract VestingLockCampaign is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct CampaignConfig {
        address stakingToken;
        bool allowEarlyWithdraw;
        address rewardToken;
        uint256 minLockAmount;
        uint256 lockPeriod;
        uint256 rewardAmount;
        uint256 campaignStart;
        uint256 campaignEnd;
        uint256 maxParticipants;
    }

    struct Position {
        uint256 amount;
        uint256 lockedAt;
        bool exists;
        bool rewardClaimed;
        bool withdrawn;
        bool forfeited;
    }

    /// @notice ERC20 token users lock into this campaign.
    IERC20 public immutable STAKING_TOKEN;
    /// @notice ERC20 token paid to eligible users as the campaign reward.
    IERC20 public immutable REWARD_TOKEN;
    /// @notice Minimum token amount a wallet must lock to enter the campaign.
    uint256 public immutable MIN_LOCK_AMOUNT;
    /// @notice Required lock duration before rewards can be claimed.
    uint256 public immutable LOCK_PERIOD;
    /// @notice Reward amount paid per eligible wallet.
    uint256 public immutable REWARD_AMOUNT;
    /// @notice Timestamp when campaign locking opens.
    uint256 public immutable CAMPAIGN_START;
    /// @notice Timestamp when campaign locking closes.
    uint256 public immutable CAMPAIGN_END;
    /// @notice Maximum number of participants; zero means uncapped.
    uint256 public immutable MAX_PARTICIPANTS;
    /// @notice Whether users may withdraw principal early and forfeit rewards.
    bool public immutable ALLOW_EARLY_WITHDRAW;

    /// @notice Number of wallets that have opened a position.
    uint256 public participantCount;
    /// @notice Total staking tokens locked by users.
    uint256 public totalLocked;
    /// @notice Total staking tokens withdrawn by users.
    uint256 public totalWithdrawn;
    /// @notice Total reward tokens claimed by users.
    uint256 public totalRewardsClaimed;
    /// @notice Number of wallets that have claimed rewards.
    uint256 public rewardsClaimedCount;
    /// @notice Number of wallets that forfeited rewards by withdrawing early.
    uint256 public rewardsForfeitedCount;

    mapping(address => Position) private positions;

    /// @notice Emitted when a wallet locks tokens into the campaign.
    /// @param account Wallet that opened the position.
    /// @param amount Amount of staking tokens locked.
    /// @param lockedAt Timestamp when the lock started.
    event Locked(address indexed account, uint256 indexed amount, uint256 indexed lockedAt);
    /// @notice Emitted when a wallet claims its campaign reward.
    /// @param account Wallet that claimed the reward.
    /// @param amount Amount of reward tokens paid.
    event RewardClaimed(address indexed account, uint256 indexed amount);
    /// @notice Emitted when a wallet withdraws locked staking tokens.
    /// @param account Wallet that withdrew locked tokens.
    /// @param amount Amount of staking tokens withdrawn.
    /// @param forfeited Whether the withdrawal forfeited reward eligibility.
    event LockedTokensWithdrawn(address indexed account, uint256 indexed amount, bool indexed forfeited);
    /// @notice Emitted when reward tokens are funded into the campaign.
    /// @param funder Wallet that supplied reward tokens.
    /// @param amount Amount of reward tokens funded.
    event RewardFunded(address indexed funder, uint256 indexed amount);
    /// @notice Emitted when the owner sweeps unallocated reward tokens.
    /// @param recipient Wallet receiving swept reward tokens.
    /// @param amount Amount of reward tokens swept.
    event RewardSwept(address indexed recipient, uint256 indexed amount);

    constructor(address initialOwner, CampaignConfig memory config) Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            config.stakingToken == address(0) ||
            config.rewardToken == address(0)
        ) {
            revert ZeroAddress();
        }
        if (
            config.minLockAmount == 0 ||
            config.lockPeriod == 0 ||
            config.rewardAmount == 0 ||
            config.campaignEnd <= config.campaignStart
        ) {
            revert InvalidCampaignConfig();
        }

        STAKING_TOKEN = IERC20(config.stakingToken);
        REWARD_TOKEN = IERC20(config.rewardToken);
        MIN_LOCK_AMOUNT = config.minLockAmount;
        LOCK_PERIOD = config.lockPeriod;
        REWARD_AMOUNT = config.rewardAmount;
        CAMPAIGN_START = config.campaignStart;
        CAMPAIGN_END = config.campaignEnd;
        MAX_PARTICIPANTS = config.maxParticipants;
        ALLOW_EARLY_WITHDRAW = config.allowEarlyWithdraw;
    }

    /**
     * @notice Lock staking tokens into the campaign.
     * @dev One position per wallet; deploy another campaign for different terms.
     * @param amount Amount of staking tokens to lock.
     */
    function lock(uint256 amount) external nonReentrant {
        if (block.timestamp < CAMPAIGN_START || block.timestamp > CAMPAIGN_END) revert CampaignInactive();
        if (amount < MIN_LOCK_AMOUNT) revert InsufficientLockAmount(MIN_LOCK_AMOUNT, amount);
        if (positions[msg.sender].exists) revert PositionAlreadyExists();
        if (MAX_PARTICIPANTS != 0 && participantCount >= MAX_PARTICIPANTS) revert ParticipantCapReached();

        positions[msg.sender] = Position({
            amount: amount,
            lockedAt: block.timestamp,
            exists: true,
            rewardClaimed: false,
            withdrawn: false,
            forfeited: false
        });

        ++participantCount;
        totalLocked += amount;

        STAKING_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit Locked(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Claim the campaign reward after satisfying the lock period.
     */
    function claimReward() external nonReentrant {
        if (!isRewardClaimable(msg.sender)) revert RewardNotClaimable();

        Position storage position = positions[msg.sender];
        position.rewardClaimed = true;
        totalRewardsClaimed += REWARD_AMOUNT;
        ++rewardsClaimedCount;

        REWARD_TOKEN.safeTransfer(msg.sender, REWARD_AMOUNT);

        emit RewardClaimed(msg.sender, REWARD_AMOUNT);
    }

    /**
     * @notice Claim the campaign reward and withdraw locked staking tokens in one transaction.
     * @dev Amounts are derived from contract state: `REWARD_AMOUNT` and the caller's position.
     */
    function claimRewardAndWithdraw() external nonReentrant {
        if (!isRewardClaimable(msg.sender)) revert RewardNotClaimable();

        Position storage position = positions[msg.sender];
        if (position.withdrawn) revert WithdrawUnavailable();

        uint256 lockedAmount = position.amount;
        position.rewardClaimed = true;
        position.withdrawn = true;
        totalRewardsClaimed += REWARD_AMOUNT;
        totalWithdrawn += lockedAmount;
        ++rewardsClaimedCount;

        REWARD_TOKEN.safeTransfer(msg.sender, REWARD_AMOUNT);
        STAKING_TOKEN.safeTransfer(msg.sender, lockedAmount);

        emit RewardClaimed(msg.sender, REWARD_AMOUNT);
        emit LockedTokensWithdrawn(msg.sender, lockedAmount, false);
    }

    /**
     * @notice Withdraw locked staking tokens.
     * @dev Withdrawing before the lock period is only possible when configured,
     *      and permanently forfeits the reward.
     */
    function withdrawLocked() external nonReentrant {
        Position storage position = positions[msg.sender];
        if (!position.exists) revert PositionNotFound();
        if (position.withdrawn) revert WithdrawUnavailable();

        bool lockComplete = block.timestamp >= position.lockedAt + LOCK_PERIOD;
        bool forfeited = false;

        if (!lockComplete) {
            if (!ALLOW_EARLY_WITHDRAW) revert LockPeriodNotMet();
            if (position.rewardClaimed || position.forfeited) revert RewardAlreadyFinalized();
            position.forfeited = true;
            ++rewardsForfeitedCount;
            forfeited = true;
        }

        position.withdrawn = true;
        totalWithdrawn += position.amount;

        STAKING_TOKEN.safeTransfer(msg.sender, position.amount);

        emit LockedTokensWithdrawn(msg.sender, position.amount, forfeited);
    }

    /**
     * @notice Fund rewards from any wallet. The treasury is expected to call this
     *         before users claim.
     * @param amount Amount of reward tokens to fund.
     */
    function fundRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroDeposit();

        REWARD_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit RewardFunded(msg.sender, amount);
    }

    /**
     * @notice Sweep unallocated reward tokens after all possible locks have matured.
     * @dev The grace window keeps rewards available for users who locked near campaign end.
     * @param recipient Wallet that receives unallocated reward tokens.
     */
    function sweepUnallocatedRewards(address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.timestamp <= CAMPAIGN_END + LOCK_PERIOD) revert CampaignInactive();

        uint256 reservedRewards = (
            participantCount - rewardsClaimedCount - rewardsForfeitedCount
        ) * REWARD_AMOUNT;
        uint256 reservedPrincipal = address(STAKING_TOKEN) == address(REWARD_TOKEN)
            ? totalLocked - totalWithdrawn
            : 0;
        uint256 reservedBalance = reservedPrincipal + reservedRewards;
        uint256 balance = REWARD_TOKEN.balanceOf(address(this));
        if (balance <= reservedBalance) revert NothingToClaim();

        uint256 sweepAmount = balance - reservedBalance;
        REWARD_TOKEN.safeTransfer(recipient, sweepAmount);

        emit RewardSwept(recipient, sweepAmount);
    }

    /// @notice Return a wallet's campaign position.
    /// @param account Wallet to inspect.
    /// @return The wallet's current campaign position.
    function getPosition(address account) external view returns (Position memory) {
        return positions[account];
    }

    /// @notice Check whether a wallet can claim its campaign reward now.
    /// @param account Wallet to inspect.
    /// @return True when the wallet has completed the lock period and has not claimed or forfeited.
    function isRewardClaimable(address account) public view returns (bool) {
        Position memory position = positions[account];
        if (!position.exists || position.rewardClaimed || position.forfeited) return false;

        return block.timestamp >= position.lockedAt + LOCK_PERIOD;
    }
}
