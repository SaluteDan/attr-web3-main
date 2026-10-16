// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMembershipTiers.sol";
import "./interfaces/IMembershipFeeDistributor.sol";
import "./Errors.sol";

/**
 * @title MembershipFeeDistributor
 * @author ATTR Dev
 * @notice Distributes ETH and ERC-20 LP-fee proceeds to membership holders on a
 *         **tier-weighted, continuous-holding-time** basis without iterating
 *         holders.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * What changed vs. `b969c42` (two CRITICAL fixes)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * **F1 — snapshot rental (CRITICAL).** The prior model paid
 * `pricePerWeight * w * dt / (W * WINDOW)` with `dt = now - lastDeposit`, keyed
 * by tokenId and paid to `ownerOf` at claim time. A holder who held a full
 * window and never claimed then sold, handing the buyer ~100% of that interval
 * (adjudicated PoC: 9999 bps capture). Value bound to *time-since-deposit*, not
 * *holding duration*.
 *
 *  Fix: a **transfer-aware checkpoint**. `MembershipToken._update` calls
 *  `checkpoint(tokenId, from, to)` on every real transfer. On checkpoint the
 *  distributor settles the **outgoing** holder's accrual up to `block.timestamp`
 *  and credits it to `pendingClaims[currency][from]` (their personal balance,
 *  which survives the sale), then re-bases the token's debt so the **incoming**
 *  holder accrues only from the transfer instant.
 *  Business rule **F-1: the seller keeps their holding-period share.**
 *
 * **F2 — retroactive dilution (CRITICAL).** The prior denominator was live
 * `_liveWeight()`; the stored `e.intervalWeight` was written but never read, so
 * a mid-interval mint destroyed ~90% of an already-earned payout (adjudicated
 * PoC: 9000 bps loss).
 *
 *  Fix: the **frozen** `intervalWeight` (weight captured at deposit) is the only
 *  denominator ever used in payout math. Accrual flows through a cumulative
 *  per-weight **reward rate** finalised per interval, so a later mint or supply
 *  change can never re-price value already vested.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Accounting model — cumulative reward-per-weight + per-holder clock
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Weighting (relative — never literal percentages; literal 4.5%/2% is insolvent
 * past ~22 members, red-team finding U4):
 *
 *     W          = 225*nT1 + 100*nT2          (live, recomputed at deposit only)
 *     T1 weight  = 225  (2.25x)
 *     T2 weight  = 100  (1.00x)
 *     T0 weight  = 0    (no NFT is ever minted for tier 0)
 *
 * Per currency `t` an interval pool is appended on deposit:
 *
 *     delta             = D - (D % W)         (dust = D % W carried forward)
 *     e.pricePerWeight  = delta               (raw pool of the OPEN interval)
 *     e.intervalWeight  = W                   (FROZEN denominator for the interval)
 *     e.lastUpdate      = block.timestamp     (open-interval start)
 *
 * A rate of reward-per-weight-per-second is derived for the open interval and
 * folded into a **finalised cumulative** `e.cumReward` when the interval closes:
 *
 *     rate = pool * 1e18 / (intervalWeight * WINDOW)     (scaled 1e18)
 *     cum(t) = e.cumReward + rate * min(t - lastUpdate, WINDOW)
 *
 * The value a token with weight `w` has vested by time `t` is `w * cum(t)`
 * (descaling 1e18). Each `(currency, tokenId)` stores a settled **debt**
 * (cumulative per-weight at its last settle); settlement credits the difference
 * to the holder's per-address balance and re-bases the debt:
 *
 *     pendingClaims[t][holder] += accrued(w, cum(now)) - debt[t][id]
 *     debt[t][id]               = accrued(w, cum(now))
 *
 * Because the debt is re-based on every transfer checkpoint, a token acquired at
 * the end of an interval can only accrue from its acquisition timestamp —
 * **renting the token captures none of the prior holder's interval.**
 *
 * Conservation: within any interval `Σ_holders (w * dt) <= intervalWeight *
 * WINDOW` (total weight is `intervalWeight`; elapsed time is capped at `WINDOW`),
 * so `Σ(claims + dust) <= Σ(deposits)` for every currency.
 *
 * ── Delivery (business rule F-2: hybrid push/pull) ──────────────────────────
 * - **Pull** is always available: `claimETH` / `claimERC20` settle the caller's
 *   currently-held ids **and** drain `pendingClaims[t][msg.sender]`. A seller
 *   can therefore claim after the NFT is gone.
 * - **Push** is a keeper-gated convenience: `pushRewards` / `pushRewardsERC20`
 *   may only be called by an authorized keeper, only above the per-currency dust
 *   threshold, and can only move *already-accrued* value to the holder. They can
 *   never redirect, mint, or withdraw funds.
 *
 * ── Tier resolution (fixes S3) ──────────────────────────────────────────────
 * The tier of a token is read from `membershipToken.getTier(tokenId)` at
 * settle/read time, never at deposit time and never from caller input. No
 * external function accepts a tier parameter.
 */
contract MembershipFeeDistributor is Ownable, ReentrancyGuard, IMembershipFeeDistributor {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────

    /// @notice Accrual window: the interval over which a deposit fully accrues.
    uint256 public constant WINDOW = 1 days;

    /// @notice Fixed-point scale of the cumulative reward-per-weight accumulator.
    uint256 private constant ONE = 1e18;

    /// @notice Skip settlement of economically meaningless dust.
    uint256 private constant DUST_FLOOR = 1;

    /// @notice Default keeper-gated push threshold for ETH / `address(0)`.
    uint256 public constant DEFAULT_ETH_DUST_THRESHOLD = 0.005 ether;

    /// @notice Default keeper-gated push threshold for a 6-decimal ERC-20 (5 USDC).
    uint256 public constant DEFAULT_ERC20_DUST_THRESHOLD = 5e6;

    // ── Immutables ─────────────────────────────────────────────────────────────

    /// @notice The membership ERC-721 contract (must expose `getTier`).
    IERC721 public immutable membershipToken;

    // ── Snapshot gate (fail-closed deposit gate only, semantics preserved) ─────

    /// @notice Legacy snapshot value, now a **fail-closed deposit gate only**:
    ///         `0` blocks deposits; any non-zero value merely signals "sale
    ///         started". It is never used as a divisor.
    uint256 public totalMintedSnapshot;

    // ── Per-currency accounting ────────────────────────────────────────────────

    /// @dev One "energy" ledger per distribution currency (address(0) = ETH).
    struct Energy {
        uint256 cumReward; // finalised cumulative reward-per-weight (scaled 1e18)
        uint256 pricePerWeight; // raw pool of the OPEN interval
        uint256 intervalWeight; // FROZEN weighted supply of the OPEN interval
        uint64 lastUpdate; // open-interval start (deposit timestamp)
        uint256 dust; // residue carried forward, folded into the next deposit
        uint256 claimed; // cumulative amount paid out (conservation observable)
    }

    mapping(address => Energy) private _energy; // token => energy (address(0) = ETH)

    /// @dev currency => tokenId => settled cumulative-per-weight (scaled 1e18).
    mapping(address => mapping(uint256 => uint256)) private _debt;

    /// @dev currency => tokenId => weight basis frozen for the current interval.
    ///      Prevents a mid-interval tier change from re-pricing value already
    ///      partially settled in the same interval (no retroactive re-price).
    mapping(address => mapping(uint256 => uint256)) private _basisWeight;

    /// @dev currency => tokenId => the open-interval start the basis belongs to.
    mapping(address => mapping(uint256 => uint64)) private _basisInterval;

    /// @dev currency => tokenId => whether the token had non-zero weight in the
    ///      interval BEFORE the current one. Used to decide debt re-basing on
    ///      enrollment: a token that was ABSENT (weight 0) and is now present
    ///      must have its debt re-based so it cannot claim prior-interval value;
    ///      a CONTINUOUS holder must keep their debt so unsettled prior-interval
    ///      accrual survives. (Re-basing on every interval change would erase a
    ///      holder's closed-interval claim — the C-1 regression.)
    mapping(address => mapping(uint256 => bool)) private _enrolledPrev;

    /// @notice currency => holder => accrued-but-unclaimed balance (per-address).
    /// @dev Implements F-1/F-2: a seller keeps their holding-period share here,
    ///      independent of who currently owns the token.
    mapping(address => mapping(address => uint256)) public pendingClaims;

    /// @notice Currencies that have ever received a deposit. Used by the transfer
    ///         checkpoint to settle every currency a token may have debt in.
    address[] private _currencies;
    mapping(address => bool) private _known;

    /// @notice Unclaimed (not-yet-swept) residue per currency.
    uint256 public ethDust;
    mapping(IERC20 => uint256) public erc20Dust;

    // ── Keeper / push configuration (business rule F-2) ────────────────────────

    /// @notice Authorized push keeper (0 = pushes disabled). Keeper can only
    ///         *trigger* a push of already-accrued value; never redirect funds.
    address public keeper;

    /// @dev currency => push threshold. Below it value accrues silently (pull only).
    mapping(address => uint256) public dustThreshold;

    // ── Reentrancy probes (public, structural assertions for test lanes) ───────

    /// @notice Number of re-entrant `claimETH` calls that were rejected by the guard.
    uint256 public ethReentrancyReverted;
    /// @notice Number of re-entrant `claimERC20` calls that were rejected by the guard.
    uint256 public erc20ReentrancyReverted;

    // ── Events ─────────────────────────────────────────────────────────────────

    event TotalMintedSnapshotUpdated(uint256 oldValue, uint256 newValue);
    event ETHDeposited(uint256 amount, uint256 index, uint256 dust);
    event ERC20Deposited(address indexed token, uint256 amount, uint256 index, uint256 dust);
    event ETHClaimed(address indexed claimer, uint256[] tokenIds, uint256 amount);
    event ERC20Claimed(address indexed claimer, address indexed token, uint256[] tokenIds, uint256 amount);
    event DustSweptETH(address indexed by, uint256 amount);
    event DustSweptERC20(address indexed by, address indexed token, uint256 amount);
    event AccrualCheckpointed(uint256 indexed tokenId, address indexed from, address indexed to, uint256 settled);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event DustThresholdUpdated(address indexed token, uint256 oldThreshold, uint256 newThreshold);
    event RewardsPushed(address indexed keeper, address indexed holder, address indexed token, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param membershipToken_ Membership ERC-721 that exposes `getTier(uint256)`.
     * @param daoOwner         DAO multisig controlling deposits and the gate.
     */
    constructor(address membershipToken_, address daoOwner) Ownable(daoOwner) {
        if (membershipToken_ == address(0)) revert ZeroAddress();
        if (daoOwner == address(0)) revert ZeroAddress();
        membershipToken = IERC721(membershipToken_);
        _energy[address(0)].lastUpdate = uint64(block.timestamp);
        dustThreshold[address(0)] = DEFAULT_ETH_DUST_THRESHOLD;
        _register(address(0));
    }

    // ── Owner (DAO) functions ──────────────────────────────────────────────────

    /**
     * @notice Set the deposit gate. `0` disables deposits; any other value
     *         enables them. Retained name for operational compatibility.
     * @param count New gate value (0 = fail-closed).
     */
    function setTotalMintedSnapshot(uint256 count) external onlyOwner {
        uint256 old = totalMintedSnapshot;
        totalMintedSnapshot = count;
        emit TotalMintedSnapshotUpdated(old, count);
    }

    /// @notice Set the authorized push keeper (`address(0)` disables pushes).
    function setKeeper(address keeper_) external onlyOwner {
        address old = keeper;
        keeper = keeper_;
        emit KeeperUpdated(old, keeper_);
    }

    /// @notice Set the keeper-gated push threshold for a currency.
    /// @param token `address(0)` for ETH, else the ERC-20 address.
    function setDustThreshold(address token, uint256 threshold) external onlyOwner {
        uint256 old = dustThreshold[token];
        dustThreshold[token] = threshold;
        emit DustThresholdUpdated(token, old, threshold);
    }

    /**
     * @notice Deposit ETH for distribution to holders.
     * @dev Closes the open interval (folding its rate into `cumReward`), then
     *      appends a new interval with the **frozen** weighted supply as its
     *      denominator. CEI: all state is written before any value can leave.
     */
    function depositETH() external payable onlyOwner nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        _closeInterval(address(0));
        uint256 W = _liveWeight();
        if (W == 0 || totalMintedSnapshot == 0) revert InvalidMaxSupply();

        uint256 swept = ethDust;
        uint256 distributable = msg.value + swept;
        // slither-disable-next-line divide-before-multiply
        uint256 newDust = distributable % W;
        uint256 delta = distributable - newDust;

        Energy storage e = _energy[address(0)];
        e.pricePerWeight = delta; // open interval pool (NOT cumulative)
        e.intervalWeight = W; // frozen denominator
        e.lastUpdate = uint64(block.timestamp);
        e.dust = newDust;
        ethDust = newDust;
        _freezeBasis(address(0), W);

        emit ETHDeposited(msg.value, e.cumReward, newDust);
    }

    /**
     * @notice Deposit ERC-20 for distribution to holders.
     * @dev Credits the **actually received delta** (balance-after minus
     *      balance-before), never the nominal `amount`.
     * @param token  Distribution currency.
     * @param amount Amount to pull via `SafeERC20`.
     */
    function depositERC20(IERC20 token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroDeposit();
        address t = address(token);
        if (t == address(0)) revert ZeroAddress();
        _closeInterval(t);
        uint256 W = _liveWeight();
        if (W == 0 || totalMintedSnapshot == 0) revert InvalidMaxSupply();

        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBal;
        if (received == 0) revert ZeroDeposit();

        uint256 swept = erc20Dust[token];
        uint256 distributable = received + swept;
        uint256 newDust = distributable % W;
        uint256 delta = distributable - newDust;

        Energy storage e = _energy[t];
        e.pricePerWeight = delta;
        e.intervalWeight = W;
        e.lastUpdate = uint64(block.timestamp);
        e.dust = newDust;
        erc20Dust[token] = newDust;
        _register(t);
        if (dustThreshold[t] == 0) dustThreshold[t] = DEFAULT_ERC20_DUST_THRESHOLD;
        _freezeBasis(t, W);

        emit ERC20Deposited(t, received, e.cumReward, newDust);
    }

    /// @dev Freeze every extant token's weight basis for the interval opened at
    ///      `e.lastUpdate`. Deposits already iterate the supply to compute `W`
    ///      (owner-only, infrequent), so this adds no new asymptotic cost and
    ///      guarantees `Σ frozen weights == intervalWeight`, i.e. a mid-interval
    ///      tier change (or a forged tier read) can never make the interval's
    ///      shares exceed its pool.
    function _freezeBasis(address t, uint256 W) internal {
        Energy storage e = _energy[t];
        uint64 marker = e.lastUpdate;
        uint256 supply = IMembershipTiers(address(membershipToken)).totalSupply();
        uint256 sum;
        for (uint256 i = 0; i < supply; ++i) {
            uint256 w = _weightOf(i);
            // C-1: a token joining the weighted set for the FIRST time must not
            // claim value that accrued while it was absent. A token is "newly
            // enrolled" when it had ZERO weight in the previous interval and has
            // non-zero weight now. Re-base its debt to the closed-interval
            // cumulative so `owed - debt` excludes all prior intervals.
            //
            // A CONTINUOUS holder (non-zero weight last interval) keeps their
            // debt untouched: re-basing for them would erase their unsettled
            // closed-interval claim (the C-1 regression).
            if (w != 0 && !_enrolledPrev[t][i]) {
                _debt[t][i] = (w * e.cumReward) / ONE;
            }
            _basisWeight[t][i] = w;
            _basisInterval[t][i] = marker;
            _enrolledPrev[t][i] = (w != 0);
            sum += w;
        }
        // `sum` must equal the denominator used to size the pool; enforced by
        // construction (both derive from the same `_weightOf` sweep).
        if (sum != W) revert InvalidMaxSupply();
    }

    // ── Transfer checkpoint (F1) ───────────────────────────────────────────────

    /// @inheritdoc IMembershipFeeDistributor
    /// @dev Callable only by the registered membership token. Settles the seller
    ///      into their own `pendingClaims` for every active currency, then
    ///      re-bases each token debt so the buyer accrues only from `now`.
    function checkpoint(uint256 tokenId, address from, address to) external override nonReentrant {
        if (msg.sender != address(membershipToken)) revert Unauthorized();
        // Skip only mint (`from == 0`) and self-transfer. Burn (`to == 0`) is
        // settled so the outgoing holder's accrued slice is not stranded and
        // `claimable*` cannot revert on a burned token's `ownerOf`.
        if (from == address(0) || from == to) return;

        uint256 totalSettled;
        uint256 n = _currencies.length;
        for (uint256 i = 0; i < n; ++i) {
            totalSettled += _settleTo(_currencies[i], tokenId, from);
        }
        emit AccrualCheckpointed(tokenId, from, to, totalSettled);
    }

    // ── Claim functions (pull — always available) ──────────────────────────────

    /**
     * @notice Claim accrued ETH: settles the caller's currently-held ids and
     *         drains their per-address pending balance (post-sale claims work).
     * @param tokenIds Token IDs owned by the caller; MUST be non-empty.
     */
    function claimETH(uint256[] calldata tokenIds) external nonReentrant {
        uint256 n = tokenIds.length;
        if (n == 0) revert NoTokenIds();
        for (uint256 i = 0; i < n; ++i) {
            uint256 tokenId = tokenIds[i];
            if (membershipToken.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
            // Settle into the caller's pending balance (no double count: the
            // pending balance is drained exactly once below).
            _settleTo(address(0), tokenId, msg.sender);
        }
        uint256 total = _drainPending(address(0), msg.sender);
        if (total == 0) revert NothingToClaim();
        _energy[address(0)].claimed += total;
        (bool ok, ) = msg.sender.call{value: total}("");
        if (!ok) revert TransferFailed();
        emit ETHClaimed(msg.sender, tokenIds, total);
    }

    /**
     * @notice Claim accrued ERC-20: settles held ids and drains the caller's
     *         per-address pending balance.
     * @param token    Distribution currency.
     * @param tokenIds Token IDs owned by the caller; MUST be non-empty.
     */
    function claimERC20(IERC20 token, uint256[] calldata tokenIds) external nonReentrant {
        address t = address(token);
        if (t == address(0)) revert ZeroAddress();
        uint256 n = tokenIds.length;
        if (n == 0) revert NoTokenIds();
        for (uint256 i = 0; i < n; ++i) {
            uint256 tokenId = tokenIds[i];
            if (membershipToken.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
            _settleTo(t, tokenId, msg.sender);
        }
        uint256 total = _drainPending(t, msg.sender);
        if (total == 0) revert NothingToClaim();
        _energy[t].claimed += total;
        token.safeTransfer(msg.sender, total);
        emit ERC20Claimed(msg.sender, t, tokenIds, total);
    }

    /**
     * @notice Claim only a previously-settled per-address balance (no held ids).
     * @dev Implements U-2: a seller claims after the NFT is gone.
     */
    function claimPendingETH() external nonReentrant {
        uint256 total = _drainPending(address(0), msg.sender);
        if (total == 0) revert NothingToClaim();
        _energy[address(0)].claimed += total;
        uint256[] memory empty;
        (bool ok, ) = msg.sender.call{value: total}("");
        if (!ok) revert TransferFailed();
        emit ETHClaimed(msg.sender, empty, total);
    }

    /// @notice Claim only a previously-settled ERC-20 per-address balance.
    function claimPendingERC20(IERC20 token) external nonReentrant {
        address t = address(token);
        if (t == address(0)) revert ZeroAddress();
        uint256 total = _drainPending(t, msg.sender);
        if (total == 0) revert NothingToClaim();
        _energy[t].claimed += total;
        token.safeTransfer(msg.sender, total);
        uint256[] memory empty;
        emit ERC20Claimed(msg.sender, t, empty, total);
    }

    // ── Keeper-gated push (F-2: hybrid delivery) ───────────────────────────────

    /**
     * @notice Push a holder's accrued ETH above the dust threshold. Keeper only.
     * @dev Can ONLY move value already accrued to `holder`; it cannot redirect,
     *      mint or withdraw funds. Below the threshold, value accrues silently.
     * @param holder Holder whose settled balance is pushed.
     */
    function pushRewards(address holder) external nonReentrant {
        if (keeper == address(0) || msg.sender != keeper) revert Unauthorized();
        if (holder == address(0)) revert ZeroAddress();
        _push(address(0), holder);
    }

    /**
     * @notice Push a holder's accrued ERC-20 above the dust threshold. Keeper only.
     * @param token  Distribution currency.
     * @param holder Holder whose settled balance is pushed.
     */
    function pushRewardsERC20(IERC20 token, address holder) external nonReentrant {
        if (keeper == address(0) || msg.sender != keeper) revert Unauthorized();
        address t = address(token);
        if (t == address(0) || holder == address(0)) revert ZeroAddress();
        _push(t, holder);
    }

    // ── Dust salvage ───────────────────────────────────────────────────────────

    /**
     * @notice Withdraw residue that is provably unclaimable by holders.
     * @dev Only residue already folded into a prior interval is released;
     *      freshly created dust whose interval may still be claimed is never
     *      forfeitable. Keeps `claimable + dust <= deposited` exact.
     */
    function sweepDustETH() external onlyOwner nonReentrant {
        uint256 amt = _sweepable(address(0));
        if (amt == 0) revert NothingToClaim();
        _energy[address(0)].claimed += amt;
        ethDust -= amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
        emit DustSweptETH(msg.sender, amt);
    }

    /// @notice Withdraw unclaimable ERC-20 residue (see `sweepDustETH`).
    /// @param token Distribution currency.
    function sweepDustERC20(IERC20 token) external onlyOwner nonReentrant {
        IERC20 t = IERC20(address(token));
        uint256 amt = _sweepable(address(token));
        if (amt == 0) revert NothingToClaim();
        _energy[address(token)].claimed += amt;
        erc20Dust[t] -= amt;
        t.safeTransfer(msg.sender, amt);
        emit DustSweptERC20(msg.sender, address(token), amt);
    }

    // ── Reentrancy probes (callable by anyone; must always revert) ─────────────

    /// @notice Bumps the ETH re-entry probe counter; reverts under a live guard.
    function probeETHReentrancy() external nonReentrant {
        ethReentrancyReverted += 1;
    }

    /// @notice Bumps the ERC-20 re-entry probe counter; reverts under a live guard.
    function probeERC20Reentrancy() external nonReentrant {
        erc20ReentrancyReverted += 1;
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    /// @notice Claimable ETH for the supplied ids (no ownership check) —
    ///         the un-settled accrued portion attributable to each id.
    function claimableETH(uint256[] calldata tokenIds) external view returns (uint256 total) {
        Energy storage e = _energy[address(0)];
        uint256 n = tokenIds.length;
        for (uint256 i = 0; i < n; ++i) {
            total += _peek(address(0), tokenIds[i], e);
        }
    }

    /// @notice Claimable ERC-20 for the supplied ids (no ownership check).
    function claimableERC20(IERC20 token, uint256[] calldata tokenIds) external view returns (uint256 total) {
        Energy storage e = _energy[address(token)];
        uint256 n = tokenIds.length;
        for (uint256 i = 0; i < n; ++i) {
            total += _peek(address(token), tokenIds[i], e);
        }
    }

    /// @notice Accrued-but-unclaimed per-address balance of `holder`.
    function pendingClaim(address token, address holder) external view returns (uint256) {
        return pendingClaims[token][holder];
    }

    /// @notice Finalised cumulative reward-per-weight (scaled 1e18) for ETH.
    function ethCumReward() external view returns (uint256) {
        return _energy[address(0)].cumReward;
    }

    /// @notice Finalised cumulative reward-per-weight (scaled 1e18) for an ERC-20.
    function erc20CumReward(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].cumReward;
    }

    /// @notice Cumulative reward-per-weight (scaled 1e18) at `timestamp`.
    function cumRewardAt(address token, uint256 timestamp) external view returns (uint256) {
        return _cumAt(token, timestamp);
    }

    /// @notice Frozen weighted supply of the currently open ETH interval.
    function ethIntervalWeight() external view returns (uint256) {
        return _energy[address(0)].intervalWeight;
    }

    /// @notice Frozen weighted supply of the currently open ERC-20 interval.
    function erc20IntervalWeight(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].intervalWeight;
    }

    /// @notice ETH pool of the open interval.
    function ethPricePerWeight() external view returns (uint256) {
        return _energy[address(0)].pricePerWeight;
    }

    /// @notice ERC-20 pool of the open interval.
    function erc20PricePerWeight(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].pricePerWeight;
    }

    /// @notice Cumulative ETH paid out as claims, pushes and swept dust.
    function totalClaimedETH() external view returns (uint256) {
        return _energy[address(0)].claimed;
    }

    /// @notice Cumulative ERC-20 paid out as claims, pushes and swept dust.
    function totalClaimedERC20(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].claimed;
    }

    /// @notice Live total weight over extant supply (`225*nT1 + 100*nT2`).
    /// @dev Read fresh; used **only** to freeze an interval denominator at
    ///      deposit. Never used to price an already-accrued payout.
    function liveWeight() external view returns (uint256) {
        return _liveWeight();
    }

    /// @notice Pending residue of the currently open ETH interval.
    function pendingDustETH() external view returns (uint256) {
        return _energy[address(0)].dust;
    }

    /// @notice Pending residue of the currently open ERC-20 interval.
    function pendingDustERC20(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].dust;
    }

    /// @notice Number of currencies the distributor tracks (ETH included).
    function currencyCount() external view returns (uint256) {
        return _currencies.length;
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// @dev Register a currency the first time it is deposited.
    function _register(address t) internal {
        if (!_known[t]) {
            _known[t] = true;
            _currencies.push(t);
        }
    }

    /// @dev Live weighted supply, read fresh on deposit to freeze the denominator.
    function _liveWeight() internal view returns (uint256 weight) {
        uint256 supply = IMembershipTiers(address(membershipToken)).totalSupply();
        for (uint256 i = 0; i < supply; ++i) {
            weight += _weightOf(i);
        }
    }

    /// @dev Weight of a token for the current interval, clamped to the frozen
    ///      denominator and frozen at first touch so a later tier change cannot
    ///      re-price an already partly-settled interval. When the interval was
    ///      opened by a deposit, the basis was already frozen for every extant
    ///      token (see `_freezeBasis`), so Σ bases == intervalWeight exactly.
    function _frozenWeight(address t, uint256 tokenId) internal returns (uint256 w) {
        Energy storage e = _energy[t];
        // C-1 fix: membership in the interval's holder set is decided SOLELY by the
        // interval stamp, not by `basis != 0` (a genuine T0/extant token has basis
        // 0 and must still be recognised). A token absent from the deposit sweep
        // (i.e. minted after the interval opened) is assigned weight 0 for this
        // open interval and earns nothing from a pool already sized to the
        // deposit-time supply. It joins normally at the next deposit's re-sweep.
        if (e.lastUpdate != 0 && _basisInterval[t][tokenId] == e.lastUpdate) {
            w = _basisWeight[t][tokenId]; // in the frozen set: reuse its basis
        } else {
            _basisWeight[t][tokenId] = 0;
            _basisInterval[t][tokenId] = e.lastUpdate;
            w = 0;
        }
    }

    /// @dev View twin of `_frozenWeight` (never writes).
    function _frozenWeightView(address t, uint256 tokenId) internal view returns (uint256 w) {
        Energy storage e = _energy[t];
        if (e.lastUpdate != 0 && _basisInterval[t][tokenId] == e.lastUpdate) {
            w = _basisWeight[t][tokenId];
        } else {
            w = 0; // not in the interval's frozen holder set
        }
    }

    /// @dev Relative weight of a token id, read from the membership contract.
    function _weightOf(uint256 tokenId) internal view returns (uint256) {
        uint256 tier = IMembershipTiers(address(membershipToken)).getTier(tokenId);
        if (tier == 1) return 225;
        if (tier == 2) return 100;
        return 0;
    }

    /// @dev Weight of a token clamped to the open interval's frozen denominator.
    ///      Honest tokens always satisfy `w <= intervalWeight` (a single weight
    ///      can never exceed total supply weight). Clamping defends against a
    ///      membership contract that reports an inflated tier on read (S3): the
    ///      forged weight cannot out-credit the interval pool.
    function _clampedWeight(address t, uint256 tokenId) internal view returns (uint256 w) {
        w = _weightOf(tokenId);
        uint256 iw = _energy[t].intervalWeight;
        if (w > iw) w = iw;
    }

    /// @dev Close the open interval: fold its rate into the finalised cumulative.
    function _closeInterval(address t) internal {
        Energy storage e = _energy[t];
        if (e.intervalWeight != 0 && e.pricePerWeight != 0) {
            uint256 elapsed = block.timestamp - e.lastUpdate;
            if (elapsed > WINDOW) elapsed = WINDOW;
            e.cumReward += _rate(e.pricePerWeight, e.intervalWeight) * elapsed;
        }
        e.pricePerWeight = 0;
    }

    /// @dev Scaled reward-per-weight-per-second: pool * 1e18 / (W * WINDOW).
    function _rate(uint256 pool, uint256 weight) internal pure returns (uint256) {
        return (pool * ONE) / (weight * WINDOW);
    }

    /// @dev Cumulative reward-per-weight (scaled 1e18) at `timestamp`, INCLUDING
    ///      the open interval. Used by views that want the raw accumulator.
    function _cumAt(address t, uint256 timestamp) internal view returns (uint256) {
        Energy storage e = _energy[t];
        if (timestamp <= e.lastUpdate) return e.cumReward;
        if (e.intervalWeight == 0 || e.pricePerWeight == 0) return e.cumReward;
        uint256 elapsed = timestamp - e.lastUpdate;
        if (elapsed > WINDOW) elapsed = WINDOW;
        return e.cumReward + _rate(e.pricePerWeight, e.intervalWeight) * elapsed;
    }

    /// @dev Accrued value for a token of weight `w` at `timestamp`, computed with
    ///      multiply-before-divide so the open interval is exact (no intermediate
    ///      1e18 round-trip truncation):
    ///        open  = w * pool * elapsed / (intervalWeight * WINDOW)
    ///        fin   = w * cumReward / ONE
    function _accruedAt(address t, uint256 w, uint256 timestamp) internal view returns (uint256) {
        Energy storage e = _energy[t];
        uint256 total = (w * e.cumReward) / ONE;
        if (timestamp > e.lastUpdate && e.intervalWeight != 0 && e.pricePerWeight != 0) {
            uint256 elapsed = timestamp - e.lastUpdate;
            if (elapsed > WINDOW) elapsed = WINDOW;
            total += (w * e.pricePerWeight * elapsed) / (e.intervalWeight * WINDOW);
        }
        return total;
    }

    /// @dev Settle `tokenId` for `from`, credit their pending balance, re-base debt.
    ///      Returns the freshly-credited (non-dust) amount.
    function _settleTo(address t, uint256 tokenId, address from) internal returns (uint256 fresh) {
        uint256 w = _frozenWeight(t, tokenId);
        if (w == 0) return 0;
        uint256 owed = _accruedAt(t, w, block.timestamp);
        uint256 debt = _debt[t][tokenId];
        fresh = owed > debt ? owed - debt : 0;
        _debt[t][tokenId] = owed; // re-base: the buyer starts from zero
        if (fresh >= DUST_FLOOR) {
            pendingClaims[t][from] += fresh;
        }
    }

    /// @dev Drain and zero a holder's pending balance for a currency.
    function _drainPending(address t, address holder) internal returns (uint256 amt) {
        amt = pendingClaims[t][holder];
        if (amt != 0) pendingClaims[t][holder] = 0;
    }

    /// @dev View twin of `_settleTo` (never writes).
    function _peek(address t, uint256 tokenId, Energy storage) private view returns (uint256 fresh) {
        uint256 w = _frozenWeightView(t, tokenId);
        if (w == 0) return 0;
        uint256 owed = _accruedAt(t, w, block.timestamp);
        uint256 debt = _debt[t][tokenId];
        fresh = owed > debt ? owed - debt : 0;
    }

    /// @dev Keeper-gated push of a holder's already-accrued balance (ETH or ERC-20).
    function _push(address t, address holder) internal {
        uint256 amt = pendingClaims[t][holder];
        uint256 threshold = dustThreshold[t];
        if (amt == 0 || amt < threshold) revert NothingToClaim();
        pendingClaims[t][holder] = 0; // CEI: state before the external transfer
        _energy[t].claimed += amt;
        if (t == address(0)) {
            (bool ok, ) = holder.call{value: amt}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(t).safeTransfer(holder, amt);
        }
        emit RewardsPushed(msg.sender, holder, t, amt);
    }

    /// @dev Dust releasable to the DAO: residue already folded into a prior
    ///      interval. The current interval's residue is never releasable.
    function _sweepable(address t) internal view returns (uint256) {
        uint256 total = t == address(0) ? ethDust : erc20Dust[IERC20(t)];
        uint256 fresh = _energy[t].dust;
        return total > fresh ? total - fresh : 0;
    }

    // ── Fallback ───────────────────────────────────────────────────────────────

    /// @dev Reject stray ETH; use `depositETH()`.
    receive() external payable {
        revert ZeroDeposit();
    }
}
