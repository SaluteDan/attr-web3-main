// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./Errors.sol";

/**
 * @title MembershipFeeDistributor
 * @dev Distributes ETH and ERC20 LP fee proceeds equally to MembershipToken holders
 *      on a per-token-ID basis, without iterating all holders on-chain.
 *
 *      Accounting model (Synthetix-style index):
 *      ─────────────────────────────────────────
 *      A global cumulative "reward index" is maintained for ETH and for each ERC20.
 *      On every deposit the index increases by (amount / totalMinted).
 *      Each token ID records the index value at the time of its last claim.
 *      Claimable amount for a token = (currentIndex - tokenLastIndex).
 *
 *      Dust from integer division accumulates implicitly and is swept into the
 *      next deposit's index increase, ensuring no ETH/tokens are permanently lost.
 *
 *      Owner is the DAO multisig; only the DAO can deposit and set the snapshot.
 */
contract MembershipFeeDistributor is Ownable {
    using SafeERC20 for IERC20;

    // ── Immutables ─────────────────────────────────────────────────────────────

    /// @notice The MembershipToken ERC721 contract.
    IERC721 public immutable membershipToken;

    // ── Storage ────────────────────────────────────────────────────────────────

    /// @notice Total minted membership tokens used as the divisor for reward distribution.
    ///         Set by the owner once public minting is complete (or updated as supply grows).
    uint256 public totalMintedSnapshot;

    // ETH reward index (scaled by 1e18 to preserve precision on small amounts)
    uint256 private _ethRewardIndex;
    mapping(uint256 => uint256) private _ethLastClaimedIndex; // tokenId => index

    // ERC20 reward indices
    mapping(IERC20 => uint256) private _erc20RewardIndex;
    mapping(IERC20 => mapping(uint256 => uint256)) private _erc20LastClaimedIndex;

    // Accumulated dust (rounding residue) — informational only, swept automatically
    uint256 public ethDust;
    mapping(IERC20 => uint256) public erc20Dust;

    // ── Events ─────────────────────────────────────────────────────────────────

    event TotalMintedSnapshotUpdated(uint256 oldValue, uint256 newValue);
    event ETHDeposited(uint256 amount, uint256 newIndex, uint256 dust);
    event ERC20Deposited(address indexed token, uint256 amount, uint256 newIndex, uint256 dust);
    event ETHClaimed(address indexed claimer, uint256[] tokenIds, uint256 amount);
    event ERC20Claimed(address indexed claimer, address indexed token, uint256[] tokenIds, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param membershipToken_  Address of the MembershipToken ERC721 contract.
     * @param daoOwner          DAO multisig that controls deposits and snapshot updates.
     */
    constructor(address membershipToken_, address daoOwner) Ownable(daoOwner) {
        if (membershipToken_ == address(0)) revert ZeroAddress();
        if (daoOwner == address(0)) revert ZeroAddress();
        membershipToken = IERC721(membershipToken_);
    }

    // ── Owner (DAO) Functions ──────────────────────────────────────────────────

    /**
     * @notice Update the total-minted snapshot used as the reward divisor.
     * @dev Should be called after significant supply events (e.g. public sale end).
     *      A value of 0 blocks deposits until set.
     * @param count New total minted count.
     */
    function setTotalMintedSnapshot(uint256 count) external onlyOwner {
        uint256 old = totalMintedSnapshot;
        totalMintedSnapshot = count;
        emit TotalMintedSnapshotUpdated(old, count);
    }

    /**
     * @notice Deposit ETH for distribution to token holders.
     * @dev msg.value is split equally across `totalMintedSnapshot` tokens.
     *      Integer-division dust accumulates and is swept into the next deposit.
     */
    function depositETH() external payable onlyOwner {
        if (msg.value == 0) revert ZeroDeposit();
        uint256 total = totalMintedSnapshot;
        if (total == 0) revert InvalidMaxSupply();

        // Carry forward unswept dust from previous round
        uint256 distributable = msg.value + ethDust;
        uint256 perToken = distributable / total;           // scaled: raw wei per token
        // slither-disable-next-line divide-before-multiply
        uint256 newDust = distributable - (perToken * total);

        ethDust = newDust;
        _ethRewardIndex += perToken;

        emit ETHDeposited(msg.value, _ethRewardIndex, newDust);
    }

    /**
     * @notice Deposit ERC20 tokens for distribution to token holders.
     * @dev Caller must have approved this contract for `amount` of `token`.
     * @param token  ERC20 token address.
     * @param amount Amount to deposit (in token's smallest unit).
     */
    function depositERC20(IERC20 token, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroDeposit();
        uint256 total = totalMintedSnapshot;
        if (total == 0) revert InvalidMaxSupply();

        token.safeTransferFrom(msg.sender, address(this), amount);

        uint256 distributable = amount + erc20Dust[token];
        uint256 perToken = distributable / total;
        // slither-disable-next-line divide-before-multiply
        uint256 newDust = distributable - (perToken * total);

        erc20Dust[token] = newDust;
        _erc20RewardIndex[token] += perToken;

        emit ERC20Deposited(address(token), amount, _erc20RewardIndex[token], newDust);
    }

    // ── Claim Functions ────────────────────────────────────────────────────────

    /**
     * @notice Claim accumulated ETH rewards for a set of token IDs.
     * @dev Caller must own every token ID supplied, otherwise reverts.
     * @param tokenIds Array of token IDs to claim for.
     */
    function claimETH(uint256[] calldata tokenIds) external {
        if (tokenIds.length == 0) revert NoTokenIds();
        uint256 total = 0;
        uint256 currentIndex = _ethRewardIndex;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (membershipToken.ownerOf(id) != msg.sender) revert NotTokenOwner(id);

            uint256 pending = currentIndex - _ethLastClaimedIndex[id];
            _ethLastClaimedIndex[id] = currentIndex;
            total += pending;
        }

        if (total == 0) revert NothingToClaim();

        (bool success, ) = msg.sender.call{value: total}("");
        if (!success) revert TransferFailed();

        emit ETHClaimed(msg.sender, tokenIds, total);
    }

    /**
     * @notice Claim accumulated ERC20 rewards for a set of token IDs.
     * @param token    ERC20 token to claim.
     * @param tokenIds Array of token IDs to claim for.
     */
    function claimERC20(IERC20 token, uint256[] calldata tokenIds) external {
        if (tokenIds.length == 0) revert NoTokenIds();
        uint256 total = 0;
        uint256 currentIndex = _erc20RewardIndex[token];

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (membershipToken.ownerOf(id) != msg.sender) revert NotTokenOwner(id);

            uint256 pending = currentIndex - _erc20LastClaimedIndex[token][id];
            _erc20LastClaimedIndex[token][id] = currentIndex;
            total += pending;
        }

        if (total == 0) revert NothingToClaim();

        token.safeTransfer(msg.sender, total);

        emit ERC20Claimed(msg.sender, address(token), tokenIds, total);
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /**
     * @notice Returns total claimable ETH for the supplied token IDs (read-only).
     * @dev Does not verify ownership — use for UI/off-chain queries only.
     */
    function claimableETH(uint256[] calldata tokenIds) external view returns (uint256 total) {
        uint256 currentIndex = _ethRewardIndex;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            total += currentIndex - _ethLastClaimedIndex[tokenIds[i]];
        }
    }

    /**
     * @notice Returns total claimable ERC20 for the supplied token IDs (read-only).
     */
    function claimableERC20(IERC20 token, uint256[] calldata tokenIds) external view returns (uint256 total) {
        uint256 currentIndex = _erc20RewardIndex[token];
        for (uint256 i = 0; i < tokenIds.length; i++) {
            total += currentIndex - _erc20LastClaimedIndex[token][tokenIds[i]];
        }
    }

    // ── Fallback ───────────────────────────────────────────────────────────────

    /// @dev Reject accidental direct ETH sends; use depositETH() instead.
    receive() external payable {
        revert ZeroDeposit();
    }
}
