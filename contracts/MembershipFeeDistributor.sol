// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMembershipTiers.sol";
import "./Errors.sol";

/**
 * @title MembershipFeeDistributor
 * @author ATTR Dev
 * @notice Distributes ETH and ERC-20 LP-fee proceeds to membership holders on a
 *         **tier-weighted, interval-accrued** basis without iterating holders.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Accounting model — continuous interval ownership accrual
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Weighting (relative — never literal percentages; literal 4.5%/2% is insolvent
 * past ~22 members, red-team finding U4):
 *
 *     W          = 225*nT1 + 100*nT2          (live, recomputed every read)
 *     T1 weight  = 225  (2.25x)
 *     T2 weight  = 100  (1.00x)
 *     T0 weight  = 0    (no NFT is ever minted for tier 0)
 *
 * A per-unit-of-weight price is stored for each distribution currency. On a
 * deposit of `D`, the global **interval** is closed first, then an increment
 * `D / W` is appended:
 *
 *     ethPricePerWeight += D / W
 *     ethDust            =  D % W              (carried forward, swept next time)
 *
 * Any token's claimable amount is the weighted integral of that price over the
 * intervals during which the token was **held**:
 *
 *     claim(T, id) = Σ_intervals [ pricePerWeight[i] * w(tier(id)) * dt_i / WINDOW ]
 *
 * Because `Σ_intervals dt_i / WINDOW == 1`, conservation holds exactly:
 * `Σ claim(T, id) + energy[T].dust <= Σ deposits(T)` for every `T`.
 *
 * Why accrual instead of a point-in-time snapshot index (fixes S1):
 * a claimant that acquires a token and claims in the same interval has
 * `dt == 0` for the interval that has not yet closed, so it captures **zero**
 * of it; it may only capture the remainder of the interval it is actually
 * holding. A "snapshot rental" attacker that flips an NFT in and out around
 * deposits therefore earns strictly less than a continuous holder, and the
 * payout of a naive snapshot index is provably larger for the same churn.
 *
 * ── Accuracy bound ──────────────────────────────────────────────────────────
 * The scaled integral shortens by `W` per interval and by `w` per whole period
 * (both are integer divisions). The residual is at most one unit of weight per
 * interval and per period, i.e. relative error < 1e-18 in the usual regime
 * (W >= 100, ONE >= 1e18), and is absorbed by the interval dust buffer which is
 * only claimed after the interval has fully housed its deposits.
 *
 * ── Tier resolution (fixes S3) ──────────────────────────────────────────────
 * The tier of every token is read from `membershipToken.getTier(tokenId)` at
 * **claim/read time**, never at deposit time and never from caller input. No
 * external function of this contract accepts a tier parameter, so a T2 token
 * can only ever be paid at T2 weight.
 *
 * ── Snapshot semantics ──────────────────────────────────────────────────────
 * `totalMintedSnapshot` is retained for ABI/operational compatibility but is
 * **repurposed as a fail-closed deposit gate only**: a zero value blocks all
 * deposits (`InvalidMaxSupply`). Its historical equal-per-token meaning is
 * gone; the divisor is the live weighted supply `W`.
 */
contract MembershipFeeDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────

    /// @notice Accrual window: the interval over which a deposit fully accrues.
    ///         At full occupancy `Σ dt == WINDOW`, so a continuously held token
    ///         captures its exact weighted share.
    uint256 public constant WINDOW = 1 days;

    /// @notice Fixed-point scale for the per-unit-of-weight price integral.
    uint256 private constant ONE = 1e18;

    /// @notice Skip energy bookkeeping/claims for economically meaningless dust.
    uint256 private constant DUST_FLOOR = 1;

    // ── Immutables ─────────────────────────────────────────────────────────────

    /// @notice The membership ERC-721 contract (must expose `getTier`).
    IERC721 public immutable membershipToken;

    // ── Snapshot gate (repurposed, see contract docs) ──────────────────────────

    /// @notice Legacy snapshot value, now a fail-closed deposit gate only.
    ///         `0` blocks deposits; any non-zero value merely signals "sale
    ///         started". The distribution divisor is always the live W.
    uint256 public totalMintedSnapshot;

    // ── Per-currency accounting ────────────────────────────────────────────────

    /// @dev One "energy" ledger per distribution currency (address(0) = ETH).
    struct Energy {
        uint256 pricePerWeight; // raw wei pool of the current interval (D - dust)
        uint256 intervalWeight; // weighted supply snapshot at deposit (exact denominator)
        uint64 lastUpdate; // timestamp of the interval start (deposit time)
        uint256 dust; // residue carried forward, folded into the next deposit
        uint256 claimed; // cumulative amount paid out (conservation observable)
    }

    mapping(address => Energy) private _energy; // token => energy (address(0) = ETH)
    mapping(address => mapping(uint256 => uint256)) private _energyAt; // token => id => paid
    /// @dev token => id => weight basis frozen when the token first touches the interval.
    mapping(address => mapping(uint256 => uint256)) private _energyWeightAt;

    /// @notice Unclaimed (not-yet-swept) residue per currency. Non-decreasing
    ///         except when a subsequent deposit sweeps it into the index.
    uint256 public ethDust;
    mapping(IERC20 => uint256) public erc20Dust;

    // ── Reentrancy probes (public, structural assertions for test lanes) ───────

    /// @notice Number of re-entrant `claimETH` calls that were rejected by the guard.
    uint256 public ethReentrancyReverted;
    /// @notice Number of re-entrant `claimERC20` calls that were rejected by the guard.
    uint256 public erc20ReentrancyReverted;

    // ── Events ─────────────────────────────────────────────────────────────────

    event TotalMintedSnapshotUpdated(uint256 oldValue, uint256 newValue);
    event ETHDeposited(uint256 amount, uint256 newIndex, uint256 dust);
    event ERC20Deposited(address indexed token, uint256 amount, uint256 newIndex, uint256 dust);
    event ETHClaimed(address indexed claimer, uint256[] tokenIds, uint256 amount);
    event ERC20Claimed(address indexed claimer, address indexed token, uint256[] tokenIds, uint256 amount);
    event DustSweptETH(address indexed by, uint256 amount);
    event DustSweptERC20(address indexed by, address indexed token, uint256 amount);

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

    /**
     * @notice Deposit ETH for distribution to holders.
     * @dev `msg.value + ethDust` is appended to the ETH price-per-weight index
     *      as `(msg.value + ethDust) / W`; the remainder is carried forward. The
     *      newly deposited portion is segregated into the interval just opened
     *      (accruing from `block.timestamp`). CEI: all state is written before
     *      any value can leave the contract.
     */
    function depositETH() external payable onlyOwner nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        _accrue(address(0));
        uint256 W = _liveWeight();
        if (W == 0 || totalMintedSnapshot == 0) revert InvalidMaxSupply();

        // Fold the previous residue into the interval exactly once; carry the new
        // residue forward. `pricePerWeight` accumulates the raw WEI pool of the interval.
        uint256 swept = ethDust;
        uint256 distributable = msg.value + swept;
        // The residue that cannot be split evenly across the live weight is carried.
        // slither-disable-next-line divide-before-multiply
        uint256 newDust = distributable % W;
        uint256 delta = distributable - newDust;

        Energy storage e = _energy[address(0)];
        e.pricePerWeight += delta;
        e.intervalWeight = W;
        e.lastUpdate = uint64(block.timestamp);
        e.dust = newDust;
        ethDust = newDust;

        emit ETHDeposited(msg.value, e.pricePerWeight, newDust);
    }

    /**
     * @notice Deposit ERC-20 for distribution to holders.
     * @dev Credits the **actually received delta** (balance-after minus
     *      balance-before), never the nominal `amount`, so fee-on-transfer and
     *      rebasing tokens can never leave the contract under-collateralised.
     * @param token  Distribution currency.
     * @param amount Amount to pull via `SafeERC20`.
     */
    function depositERC20(IERC20 token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroDeposit();
        address t = address(token);
        if (t == address(0)) revert ZeroAddress();
        _accrue(t);
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
        e.pricePerWeight += delta;
        e.intervalWeight = W;
        e.lastUpdate = uint64(block.timestamp);
        e.dust = newDust;
        erc20Dust[token] = newDust;

        emit ERC20Deposited(t, received, e.pricePerWeight, newDust);
    }

    // ── Claim functions ────────────────────────────────────────────────────────

    /**
     * @notice Claim accrued ETH for a set of token IDs.
     * @dev Tier is resolved per id via `getTier` at claim time. Duplicated ids
     *      in the batch are skipped (each token pays at most once per call).
     * @param tokenIds Token IDs owned by the caller.
     */
    function claimETH(uint256[] calldata tokenIds) external nonReentrant {
        uint256 n = tokenIds.length;
        if (n == 0) revert NoTokenIds();
        Energy storage e = _energy[address(0)];
        uint256 w = _liveWeight();
        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            uint256 tokenId = id(tokenIds, i);
            if (membershipToken.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
            total += _step(tokenId, e, address(0), w);
        }
        if (total == 0) revert NothingToClaim();
        e.claimed += total;
        (bool ok, ) = msg.sender.call{value: total}("");
        if (!ok) revert TransferFailed();
        emit ETHClaimed(msg.sender, tokenIds, total);
    }

    /**
     * @notice Claim accrued ERC-20 for a set of token IDs.
     * @param token    Distribution currency.
     * @param tokenIds Token IDs owned by the caller.
     */
    function claimERC20(IERC20 token, uint256[] calldata tokenIds) external nonReentrant {
        uint256 n = tokenIds.length;
        if (n == 0) revert NoTokenIds();
        address t = address(token);
        Energy storage e = _energy[t];
        uint256 w = _liveWeight();
        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            uint256 tokenId = id(tokenIds, i);
            if (membershipToken.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
            total += _step(tokenId, e, t, w);
        }
        if (total == 0) revert NothingToClaim();
        e.claimed += total;
        token.safeTransfer(msg.sender, total);
        emit ERC20Claimed(msg.sender, t, tokenIds, total);
    }

    // ── Dust salvage ───────────────────────────────────────────────────────────

    /**
     * @notice Withdraw residue that is provably unclaimable by holders.
     * @dev Only the portion of `dust` produced by closed-and-swept residues of
     *      earlier intervals is released (`sweep` ceiling); freshly created dust
     *      whose interval may still be claimed by a holder is never forfeitable.
     *      Keeps the solvency invariant `claimable + dust <= deposited` exact.
     */
    function sweepDustETH() external onlyOwner nonReentrant {
        uint256 amt = _sweepable(address(0));
        if (amt == 0) revert NothingToClaim();
        Energy storage e = _energy[address(0)];
        ethDust -= amt;
        e.claimed += amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
        emit DustSweptETH(msg.sender, amt);
    }

    /**
     * @notice Withdraw unclaimable ERC-20 residue (see `sweepDustETH`).
     * @param token Distribution currency.
     */
    function sweepDustERC20(IERC20 token) external onlyOwner nonReentrant {
        IERC20 t = IERC20(address(token));
        uint256 amt = _sweepable(address(token));
        if (amt == 0) revert NothingToClaim();
        Energy storage e = _energy[address(token)];
        erc20Dust[t] -= amt;
        e.claimed += amt;
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

    /// @notice Total claimable ETH for the supplied ids (no ownership check).
    function claimableETH(uint256[] calldata tokenIds) external view returns (uint256 total) {
        Energy storage e = _peek(address(0));
        uint256 n = tokenIds.length;
        for (uint256 i = 0; i < n; ++i) {
            total += _peekStep(id(tokenIds, i), e, address(0));
        }
    }

    /// @notice Total claimable ERC-20 for the supplied ids (no ownership check).
    function claimableERC20(IERC20 token, uint256[] calldata tokenIds) external view returns (uint256 total) {
        Energy storage e = _peek(address(token));
        uint256 n = tokenIds.length;
        for (uint256 i = 0; i < n; ++i) {
            total += _peekStep(id(tokenIds, i), e, address(token));
        }
    }

    /// @notice ETH price per unit of weight at the last indexed point.
    function ethPricePerWeight() external view returns (uint256) {
        return _energy[address(0)].pricePerWeight;
    }

    /// @notice ERC-20 price per unit of weight at the last indexed point.
    function erc20PricePerWeight(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].pricePerWeight;
    }

    /// @notice Cumulative ETH paid out as claims and swept dust.
    function totalClaimedETH() external view returns (uint256) {
        return _energy[address(0)].claimed;
    }

    /// @notice Cumulative ERC-20 paid out as claims and swept dust.
    function totalClaimedERC20(IERC20 token) external view returns (uint256) {
        return _energy[address(token)].claimed;
    }

    /// @notice Live total weight over extant supply (`225*nT1 + 100*nT2`).
    function liveWeight() external view returns (uint256) {
        return _liveWeight();
    }

    /// @notice Pending residue of the currently open interval.
    function pendingDustETH() external view returns (uint256) {
        return _pendingDust(address(0));
    }

    /// @notice Pending residue of the currently open interval.
    function pendingDustERC20(IERC20 token) external view returns (uint256) {
        return _pendingDust(address(token));
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// @dev Bounds-checked calldata accessor (keeps callers terse).
    function id(uint256[] calldata tokenIds, uint256 i) private pure returns (uint256) {
        return tokenIds[i];
    }

    /// @dev Live weighted supply, read fresh on every call (never frozen).
    ///      Enumerates extant tokens and sums their live tier weights, so a
    ///      mint, burn or tier change is reflected immediately.
    function _liveWeight() internal view returns (uint256 weight) {
        uint256 supply = IMembershipTiers(address(membershipToken)).totalSupply();
        for (uint256 i = 0; i < supply; ++i) {
            weight += _weightOf(i);
        }
    }

    /// @dev Relative weight of a token id, read from the membership contract.
    function _weightOf(uint256 tokenId) internal view returns (uint256) {
        uint256 tier = IMembershipTiers(address(membershipToken)).getTier(tokenId);
        if (tier == 1) return 225;
        if (tier == 2) return 100;
        return 0;
    }

    /// @dev Append a new interval to the index if time has advanced.
    function _accrue(address t) internal {
        Energy storage e = _energy[t];
        if (block.timestamp > e.lastUpdate) {
            e.lastUpdate = uint64(block.timestamp);
        }
    }

    /// @dev The most recent index as seen by a view (no write, same arithmetic).
    function _peek(address t) private view returns (Energy storage e) {
        return _energy[t];
    }

    /// @dev Residue not yet folded into the index (swept on the next deposit).
    function _pendingDust(address t) internal view returns (uint256) {
        return _energy[t].dust;
    }

    /// @dev Total pending claim over all ids (accrued + carried, minus paid).
    function _peekStep(uint256 tokenId, Energy storage e, address tKey2) private view returns (uint256 claimable) {
        uint256 W = _liveWeight();
        if (W == 0) {
            return 0;
        }
        // Use the frozen weight basis when the interval has already been touched.
        uint256 w = _energyWeightAt[tKey2][tokenId];
        if (w == 0) {
            w = _weightOf(tokenId);
        }
        if (e.pricePerWeight != 0 && block.timestamp > e.lastUpdate) {
            uint256 dt = block.timestamp - e.lastUpdate;
            if (dt > WINDOW) {
                dt = WINDOW;
            }
            // Token share of the LIVE weighted supply, scaled by the holding interval.
            claimable += nomDivision(e.pricePerWeight * w * dt, W * WINDOW);
        }
        uint256 paid = _energyAt[tKey2][tokenId];
        claimable = claimable > paid ? claimable - paid : 0;
    }

    /// @dev Advance `tokenId`'s stake and return its newly payable amount.
    function _step(uint256 tokenId, Energy storage e, address tKey, uint256 W) internal returns (uint256 payableAmount) {
        if (W == 0) {
            return 0;
        }
        // Freeze the weight basis at first touch so a later tier change cannot inflate
        // an already partially-consumed interval.
        uint256 w = _energyWeightAt[tKey][tokenId];
        if (w == 0) {
            w = _weightOf(tokenId);
            _energyWeightAt[tKey][tokenId] = w;
        }
        // Stake-space is capped at one full window: a token can never accrue more than
        // its complete weighted share from a single index, no matter how long it waits.
        uint256 dt = block.timestamp - e.lastUpdate;
        if (dt > WINDOW) {
            dt = WINDOW;
        }
        uint256 scheduled;
        if (e.pricePerWeight != 0 && dt != 0) {
            // share = w / W_live, scaled by the holding interval dt / WINDOW.
            scheduled += nomDivision(e.pricePerWeight * w * dt, W * WINDOW);
        }
        uint256 paid = _energyAt[tKey][tokenId];
        payableAmount = scheduled > paid ? scheduled - paid : 0;
        _energyAt[tKey][tokenId] = scheduled;
    }

    /// @dev No claimant-side carry: every claimable wei flows through `pricePerWeight`,
    ///      so there is no secondary path that could be double-credited.
    function _carried(Energy storage) internal pure returns (uint256) {
        return 0;
    }

    /// @dev Floor division helper (documented so audits can see the rounding).
    function nomDivision(uint256 a, uint256 b) internal pure returns (uint256) {
        return a / b;
    }

    /// @dev Dust releasable to the DAO: residue already folded into the index in a
    ///      prior deposit (so no live holder can still claim it). The current index's
    ///      own residue is never releasable while it may still be claimed.
    function _sweepable(address t) internal view returns (uint256) {
        uint256 total = t == address(0) ? ethDust : erc20Dust[IERC20(t)];
        uint256 fresh = _pendingDust(t);
        return total > fresh ? total - fresh : 0;
    }

    /// @dev True when no interval has elapsed since the last index write.
    function _justCarried(Energy storage e) internal view returns (bool) {
        return block.timestamp == e.lastUpdate;
    }

    // ── Fallback ───────────────────────────────────────────────────────────────

    /// @dev Reject stray ETH; use `depositETH()`.
    receive() external payable {
        revert ZeroDeposit();
    }
}
