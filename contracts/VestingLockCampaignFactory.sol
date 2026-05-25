// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Errors.sol";
import "./VestingLockCampaign.sol";

/**
 * @title VestingLockCampaignFactory
 * @author Attributes Platform
 * @notice Deploys reusable ATTR lock incentive campaigns with isolated funding and state.
 */
contract VestingLockCampaignFactory is Ownable {
    address[] private campaigns;

    /// @notice Emitted when the factory deploys a new vesting lock campaign.
    /// @param campaign Newly deployed campaign address.
    /// @param owner Owner assigned to the new campaign.
    /// @param stakingToken ERC20 token users lock.
    /// @param rewardToken ERC20 token paid as the campaign reward.
    /// @param minLockAmount Minimum token amount a user must lock.
    /// @param lockPeriod Required lock duration in seconds.
    /// @param rewardAmount Reward paid per eligible wallet.
    /// @param campaignStart Timestamp when locking opens.
    /// @param campaignEnd Timestamp when locking closes.
    /// @param maxParticipants Maximum participants; zero means uncapped.
    /// @param allowEarlyWithdraw Whether early withdrawals are allowed with reward forfeiture.
    event CampaignDeployed(
        address indexed campaign,
        address indexed owner,
        address indexed stakingToken,
        address rewardToken,
        uint256 minLockAmount,
        uint256 lockPeriod,
        uint256 rewardAmount,
        uint256 campaignStart,
        uint256 campaignEnd,
        uint256 maxParticipants,
        bool allowEarlyWithdraw
    );

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    /// @notice Deploy a new isolated vesting lock campaign.
    /// @param config Campaign parameters passed to the new campaign constructor.
    /// @return Address of the deployed campaign.
    function createCampaign(VestingLockCampaign.CampaignConfig calldata config)
        external
        onlyOwner
        returns (address)
    {
        VestingLockCampaign campaign = new VestingLockCampaign(msg.sender, config);
        address campaignAddress = address(campaign);
        campaigns.push(campaignAddress);

        emit CampaignDeployed(
            campaignAddress,
            msg.sender,
            config.stakingToken,
            config.rewardToken,
            config.minLockAmount,
            config.lockPeriod,
            config.rewardAmount,
            config.campaignStart,
            config.campaignEnd,
            config.maxParticipants,
            config.allowEarlyWithdraw
        );

        return campaignAddress;
    }

    /// @notice Return all campaigns deployed by this factory.
    /// @return Array of deployed campaign addresses.
    function getCampaigns() external view returns (address[] memory) {
        return campaigns;
    }

    /// @notice Return the number of campaigns deployed by this factory.
    /// @return Number of deployed campaigns.
    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @notice Return a deployed campaign address by index.
    /// @param index Campaign array index.
    /// @return Deployed campaign address.
    function getCampaignAt(uint256 index) external view returns (address) {
        if (index >= campaigns.length) revert IndexOutOfBounds();
        return campaigns[index];
    }
}
