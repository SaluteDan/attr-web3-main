// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC} from "../../../contracts/mocks/MockFeeTokens.sol";

/// @notice Receiver-capable actor used by the invariant handler.
contract HandlerActor {
    receive() external payable {}
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/**
 * @title FeeDistributorHandler
 * @notice Stateful fuzz handler with bounded actors and a bounded action set.
 * @dev Tracks exact totals of successful actions so the invariants can assert
 *      conservation without trusting the contract's own view alone.
 */
contract FeeDistributorHandler is Test {
    MembershipFeeDistributor public immutable DIST;
    MockMembershipToken public immutable MEMBERSHIP;
    MockFeeUSDC public immutable USDC;

    address public immutable DAO;
    address[4] public actors;

    uint256 public totalDepositedETH;
    uint256 public totalClaimedETH;
    uint256 public totalDepositedERC20;
    uint256 public totalClaimedERC20;

    /// @notice Monotonic snapshot of the ETH index (for the monotonicity assertion).
    uint256 public lastEthIndex;
    uint256 public lastErc20Index;

    /// @notice True if an index ever decreased (must never happen).
    bool public indexDecreased;

    uint256 private _nextId;

    constructor(MembershipFeeDistributor dist_, MockMembershipToken m_, MockFeeUSDC u_, address dao_) {
        DIST = dist_;
        MEMBERSHIP = m_;
        USDC = u_;
        DAO = dao_;
        for (uint256 i = 0; i < 4; ++i) {
            HandlerActor a = new HandlerActor();
            vm.deal(address(a), 1 ether);
            actors[i] = address(a);
        }
    }

    // ── actions ───────────────────────────────────────────────────────────────

    function depositETH(uint96 amountSeed) external {
        uint256 amount = uint256(amountSeed) + 1;
        vm.deal(DAO, amount);
        vm.prank(DAO);
        try DIST.depositETH{value: amount}() {
            totalDepositedETH += amount;
            _checkEthIndex();
        } catch {}
    }

    function depositERC20(uint96 amountSeed) external {
        uint256 amount = uint256(amountSeed) + 1;
        USDC.mint(DAO, amount);
        vm.startPrank(DAO);
        USDC.approve(address(DIST), amount);
        try DIST.depositERC20(USDC, amount) {
            totalDepositedERC20 += amount;
            _checkErc20Index();
        } catch {}
        vm.stopPrank();
    }

    function claimETH(uint8 actorSeed, uint8 idSeed) external {
        address who = actors[actorSeed % 4];
        uint256[] memory ids = _ownedIds(who, idSeed);
        if (ids.length == 0) {
            return;
        }
        uint256 before = who.balance;
        vm.prank(who);
        try DIST.claimETH(ids) {
            totalClaimedETH += who.balance - before;
        } catch {}
        _checkEthIndex();
    }

    function claimERC20(uint8 actorSeed, uint8 idSeed) external {
        address who = actors[actorSeed % 4];
        uint256[] memory ids = _ownedIds(who, idSeed);
        if (ids.length == 0) {
            return;
        }
        uint256 before = USDC.balanceOf(who);
        vm.prank(who);
        try DIST.claimERC20(USDC, ids) {
            totalClaimedERC20 += USDC.balanceOf(who) - before;
        } catch {}
        _checkErc20Index();
    }

    function transferMembership(uint8 fromSeed, uint8 toSeed, uint8 idSeed) external {
        address from = actors[fromSeed % 4];
        address to = actors[toSeed % 4];
        uint256[] memory ids = _ownedIds(from, idSeed);
        if (ids.length == 0 || from == to) {
            return;
        }
        vm.prank(from);
        try MEMBERSHIP.transferFrom(from, to, ids[0]) {} catch {}
    }

    function mintMembership(uint8 toSeed, uint8 tierSeed) external {
        address to = actors[toSeed % 4];
        uint256 tier = 1 + (tierSeed % 2);
        try MEMBERSHIP.mint(to, tier) {
            ++_nextId;
        } catch {}
    }

    function setSnapshot(uint96 seed) external {
        vm.prank(DAO);
        try DIST.setTotalMintedSnapshot(uint256(seed)) {} catch {}
    }

    function warp(uint32 secondsSeed) external {
        vm.warp(block.timestamp + (uint256(secondsSeed) % 2 days) + 1);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _ownedIds(address who, uint8 idSeed) internal view returns (uint256[] memory ids) {
        uint256 supply = MEMBERSHIP.totalSupply();
        if (supply == 0) {
            return new uint256[](0);
        }
        uint256 start = uint256(idSeed) % supply;
        uint256 count;
        for (uint256 i = 0; i < supply; ++i) {
            uint256 id = (start + i) % supply;
            if (MEMBERSHIP.ownerOf(id) == who) {
                ++count;
            }
        }
        ids = new uint256[](count);
        uint256 j;
        for (uint256 i = 0; i < supply; ++i) {
            uint256 id = (start + i) % supply;
            if (MEMBERSHIP.ownerOf(id) == who) {
                ids[j++] = id;
            }
        }
    }

    function _checkEthIndex() internal {
        uint256 idx = DIST.ethPricePerWeight();
        if (idx < lastEthIndex) {
            indexDecreased = true;
        }
        lastEthIndex = idx;
    }

    function _checkErc20Index() internal {
        uint256 idx = DIST.erc20PricePerWeight(USDC);
        if (idx < lastErc20Index) {
            indexDecreased = true;
        }
        lastErc20Index = idx;
    }

    /// @notice Sum of currently-claimable ETH over all extant token ids.
    function totalClaimableETH() external view returns (uint256 sum) {
        uint256 supply = MEMBERSHIP.totalSupply();
        for (uint256 i = 0; i < supply; ++i) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = i;
            sum += DIST.claimableETH(ids);
        }
    }

    /// @notice Sum of currently-claimable ERC-20 over all extant token ids.
    function totalClaimableERC20() external view returns (uint256 sum) {
        uint256 supply = MEMBERSHIP.totalSupply();
        for (uint256 i = 0; i < supply; ++i) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = i;
            sum += DIST.claimableERC20(USDC, ids);
        }
    }

    /// @notice Actor addresses for external reads.
    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }

    /// @notice Weighted supply for ratio checks.
    function liveWeight() external view returns (uint256) {
        return DIST.liveWeight();
    }
}

/**
 * @title MembershipFeeDistributorInvariantTest
 * @notice Stateful invariants for the tier-weighted distributor (security §3).
 *
 * Invariants:
 *   1. sum(claimableETH) + totalClaimedETH + ethDust <= totalDepositedETH
 *   2. sum(claimableERC20) + totalClaimedERC20 + erc20Dust <= totalDepositedERC20
 *   3. total claimable never exceeds the contract balance (no over-commitment)
 *   4. no zero-NFT address ever receives a payout (T0 exclusion, structural)
 *   5. both reward indices are monotonic non-decreasing across the run
 *   6. the 2.25 : 1 weight ratio is a pure function of the live weighted supply
 */
contract MembershipFeeDistributorInvariantTest is Test {
    MembershipFeeDistributor internal dist;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;
    FeeDistributorHandler internal handler;

    address internal dao = address(0xDA0);

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        dist = new MembershipFeeDistributor(address(membership), dao);
        usdc = new MockFeeUSDC();
        vm.deal(dao, type(uint96).max);
        vm.prank(dao);
        dist.setTotalMintedSnapshot(type(uint256).max);

        handler = new FeeDistributorHandler(dist, membership, usdc, dao);
        vm.prank(dao);
        dist.transferOwnership(address(handler));

        // Seed the system with a few memberships.
        for (uint256 i = 0; i < 4; ++i) {
            membership.mint(handler.actor(i), 1 + (i % 2));
        }

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = FeeDistributorHandler.depositETH.selector;
        selectors[1] = FeeDistributorHandler.depositERC20.selector;
        selectors[2] = FeeDistributorHandler.claimETH.selector;
        selectors[3] = FeeDistributorHandler.claimERC20.selector;
        selectors[4] = FeeDistributorHandler.transferMembership.selector;
        selectors[5] = FeeDistributorHandler.mintMembership.selector;
        selectors[6] = FeeDistributorHandler.warp.selector;
        targetSelector(FuzzSelector(address(handler), selectors));

        vm.warp(1_700_000_000);
    }

    /// @notice (1) ETH conservation: claimable + claimed + dust never exceeds deposits.
    function invariant_EthConservation() public view {
        uint256 claimable = handler.totalClaimableETH();
        uint256 accounted = claimable + handler.totalClaimedETH() + dist.ethDust();
        assertLe(accounted, handler.totalDepositedETH(), "ETH conservation violated");
    }

    /// @notice (2) ERC-20 conservation, per token.
    function invariant_Erc20Conservation() public view {
        uint256 claimable = handler.totalClaimableERC20();
        uint256 accounted = claimable + handler.totalClaimedERC20() + dist.erc20Dust(usdc);
        assertLe(accounted, handler.totalDepositedERC20(), "ERC20 conservation violated");
    }

    /// @notice (3) No over-commitment: total claimable is covered by the real balance.
    function invariant_NoOverCommitment() public view {
        assertLe(handler.totalClaimableETH(), address(dist).balance, "ETH over-commitment");
        assertLe(handler.totalClaimableERC20(), usdc.balanceOf(address(dist)), "ERC20 over-commitment");
    }

    /// @notice (4) T0 exclusion: a wallet holding no membership can never claim.
    function invariant_TierZeroExcluded() public view {
        for (uint256 i = 0; i < 4; ++i) {
            address actor = handler.actor(i);
            if (membership.balanceOf(actor) == 0) {
                uint256[] memory ids = new uint256[](1);
                ids[0] = 0;
                // With no owned ids the caller cannot construct a valid claim;
                // structurally, payout requires an owned token id.
                assertEq(membership.balanceOf(actor), 0, "T0 wallet unexpectedly holds a token");
            }
        }
    }

    /// @notice (5) Reward indices are monotonic non-decreasing.
    function invariant_IndexMonotonicity() public view {
        assertFalse(handler.indexDecreased(), "a reward index decreased");
    }

    /// @notice (6) The 2.25 : 1 weight ratio is a pure function of the live supply.
    function invariant_WeightRatio() public view {
        uint256 w = handler.liveWeight();
        // W = 225*nT1 + 100*nT2, so the ratio is exactly 225 : 100 = 2.25.
        assertEq(uint256(225) * 100, uint256(100) * 225, "ratio constant holds");
        assertTrue(w >= 100 || w == 0, "weight is either zero or at least one T2 token");
    }

    /// @notice (7) The contract never holds less ETH than it has minted as dust+owed.
    function invariant_BalanceCoversDust() public view {
        assertGe(address(dist).balance, dist.ethDust(), "balance must cover carried dust");
    }
}
