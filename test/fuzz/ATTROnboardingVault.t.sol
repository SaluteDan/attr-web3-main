// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ATTROnboardingVault} from "../../contracts/ATTROnboardingVault.sol";
import {ATTRToken} from "../../contracts/ATTRToken.sol";
import "../../contracts/Errors.sol";

/**
 * @title ATTROnboardingVault Unit Tests
 * @notice Authorization, disbursement, balance, and rescue coverage for the onboarding vault.
 */
contract ATTROnboardingVaultTest is Test {
    ATTRToken internal attr;
    ATTROnboardingVault internal vault;

    address internal dao = makeAddr("dao");
    address internal membership = makeAddr("membership");
    address internal recipient = makeAddr("recipient");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant FUNDING = 150_000_000 ether;
    uint256 internal constant TIER1_GRANT = 2500 ether;
    uint256 internal constant MAX_SUPPLY = 50_000;

    event GrantDisbursed(address indexed recipient, uint256 amount, uint256 remainingBalance);
    event MembershipTokenUpdated(address indexed membershipToken);
    event EmergencyRescued(address indexed to, uint256 amount);

    function setUp() public {
        // Deployer receives the whole 1B cap, then funds the vault with the 150M grant pool.
        attr = new ATTRToken(address(this));
        vault = new ATTROnboardingVault(address(attr), membership, dao);
        attr.transfer(address(vault), FUNDING);
    }

    // ── Construction & configuration ─────────────────────────────────────────

    function test_InitialState() public view {
        assertEq(address(vault.attrToken()), address(attr));
        assertEq(vault.membershipToken(), membership);
        assertEq(vault.owner(), dao);
        assertEq(attr.balanceOf(address(vault)), FUNDING);
    }

    function test_ConstructorRejectsZeroAttrToken() public {
        vm.expectRevert(ZeroAddress.selector);
        new ATTROnboardingVault(address(0), membership, dao);
    }

    function test_ConstructorRejectsZeroDaoTimelock() public {
        // Ownable's own guard rejects the zero owner before our defensive check runs.
        vm.expectRevert(abi.encodeWithSignature("OwnableInvalidOwner(address)", address(0)));
        new ATTROnboardingVault(address(attr), membership, address(0));
    }

    function test_ConstructorAllowsZeroMembershipToken() public {
        ATTROnboardingVault fresh = new ATTROnboardingVault(address(attr), address(0), dao);
        assertEq(fresh.membershipToken(), address(0));
    }

    function test_SetMembershipTokenOnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        vault.setMembershipToken(recipient);

        vm.prank(dao);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MembershipTokenUpdated(recipient);
        vault.setMembershipToken(recipient);

        assertEq(vault.membershipToken(), recipient);
    }

    function test_SetMembershipTokenRejectsZero() public {
        vm.prank(dao);
        vm.expectRevert(ZeroAddress.selector);
        vault.setMembershipToken(address(0));
    }

    // ── Disbursement authorization ────────────────────────────────────────────

    function test_DisburseGrantSuccess() public {
        vm.prank(membership);
        vm.expectEmit(true, true, true, true, address(vault));
        emit GrantDisbursed(recipient, TIER1_GRANT, FUNDING - TIER1_GRANT);
        vault.disburseGrant(recipient, TIER1_GRANT);

        assertEq(attr.balanceOf(recipient), TIER1_GRANT);
        assertEq(attr.balanceOf(address(vault)), FUNDING - TIER1_GRANT);
    }

    function test_DisburseGrantOnlyMembershipToken() public {
        vm.prank(attacker);
        vm.expectRevert(Unauthorized.selector);
        vault.disburseGrant(recipient, TIER1_GRANT);

        assertEq(attr.balanceOf(address(vault)), FUNDING);
    }

    function test_DisburseGrantRejectsZeroRecipient() public {
        vm.prank(membership);
        vm.expectRevert(ZeroAddress.selector);
        vault.disburseGrant(address(0), TIER1_GRANT);
    }

    function test_DisburseGrantRejectsInsufficientBalance() public {
        vm.prank(membership);
        vm.expectRevert(InsufficientVaultBalance.selector);
        vault.disburseGrant(recipient, FUNDING + 1);
    }

    // ── Emergency rescue ──────────────────────────────────────────────────────

    function test_EmergencyRescueOnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        vault.emergencyRescue(recipient, TIER1_GRANT);
    }

    function test_EmergencyRescueTransfersAndEmits() public {
        uint256 amount = 1_000_000 ether;
        vm.prank(dao);
        vm.expectEmit(true, true, true, true, address(vault));
        emit EmergencyRescued(recipient, amount);
        vault.emergencyRescue(recipient, amount);

        assertEq(attr.balanceOf(recipient), amount);
        assertEq(attr.balanceOf(address(vault)), FUNDING - amount);
    }

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_DisburseGrant(uint256 amount) public {
        (bool ok, bytes memory ret) = address(vault).call(
            abi.encodeCall(ATTROnboardingVault.disburseGrant, (recipient, amount))
        );
        // Called directly (not via MembershipToken) it always reverts Unauthorized.
        assertFalse(ok);
        assertEq(bytes4(ret), Unauthorized.selector);

        amount = bound(amount, 0, FUNDING);
        vm.prank(membership);
        vault.disburseGrant(recipient, amount);
        assertEq(attr.balanceOf(recipient), amount);
        assertEq(attr.balanceOf(address(vault)), FUNDING - amount);
    }

    // ── Non-exhaustion invariant ──────────────────────────────────────────────

    /**
     * @notice Worst-case lifetime disbursement (50,000 Tier-1 grants) stays within funding.
     */
    function test_NonExhaustionInvariant() public view {
        uint256 maxCumulativeGrant = MAX_SUPPLY * TIER1_GRANT;
        assertLt(maxCumulativeGrant, attr.balanceOf(address(vault)));
    }
}
