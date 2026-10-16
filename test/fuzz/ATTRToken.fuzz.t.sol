// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ATTRToken} from "../../contracts/ATTRToken.sol";

/**
 * @title ATTRToken Fuzz & Invariant Tests
 * @notice Property-based testing for the fixed-cap, pre-minted ATTRToken.
 */
contract ATTRTokenFuzzTest is Test {
    ATTRToken public token;

    // Test addresses
    address public owner;
    address public treasury;
    address public alice;
    address public bob;

    // Constants
    uint256 constant CAP = 1_000_000_000 ether; // 1B tokens

    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // The entire cap is minted to the distribution address in a single update.
        token = new ATTRToken(treasury);

        // Stateful invariant fuzzing targets only the handlers below.
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = this.handler_transfer.selector;
        selectors[1] = this.handler_burn.selector;
        targetSelector(FuzzSelector({addr: address(this), selectors: selectors}));
    }

    // ================================================================
    // FUZZ TESTS: Individual Functions
    // ================================================================

    /**
     * @notice The full cap is minted at deploy; there is no mint() and no minter role.
     */
    function test_DeployMintsEntireCap() public view {
        assertEq(token.totalSupply(), CAP, "supply != cap");
        assertEq(token.balanceOf(treasury), CAP, "treasury != cap");
        assertEq(token.cap(), CAP, "cap mismatch");
        assertEq(token.CAP(), CAP, "CAP constant mismatch");
    }

    /**
     * @notice Fuzz: Transfers should maintain total supply.
     */
    function testFuzz_TransferMaintainsSupply(uint256 amount, uint8 fromSeed, uint8 toSeed) public {
        address[4] memory holders = [treasury, alice, bob, owner];
        address from = holders[fromSeed % 4];
        address to = holders[toSeed % 4];
        vm.assume(from != to);

        amount = bound(amount, 0, token.balanceOf(from));
        uint256 supplyBefore = token.totalSupply();

        vm.prank(from);
        token.transfer(to, amount);

        assertEq(token.totalSupply(), supplyBefore, "Supply changed on transfer");
    }

    /**
     * @notice Fuzz: Burn should always reduce total supply and stay within cap.
     */
    function testFuzz_BurnReducesSupply(uint256 burnAmount) public {
        uint256 treasuryBalance = token.balanceOf(treasury);
        burnAmount = bound(burnAmount, 0, treasuryBalance);

        uint256 supplyBefore = token.totalSupply();

        vm.prank(treasury);
        token.burn(burnAmount);

        assertEq(token.totalSupply(), supplyBefore - burnAmount);
        assertEq(token.balanceOf(treasury), treasuryBalance - burnAmount);
        assertLe(token.totalSupply(), CAP, "Supply exceeded cap");
    }

    /**
     * @notice Fuzz: burnFrom consumes allowance and reduces supply.
     */
    function testFuzz_BurnFromReducesSupply(uint256 approveAmount, uint256 burnAmount) public {
        approveAmount = bound(approveAmount, 0, CAP);
        burnAmount = bound(burnAmount, 0, approveAmount);

        vm.prank(treasury);
        token.approve(alice, approveAmount);

        uint256 supplyBefore = token.totalSupply();

        vm.prank(alice);
        token.burnFrom(treasury, burnAmount);

        assertEq(token.totalSupply(), supplyBefore - burnAmount);
        assertEq(token.allowance(treasury, alice), approveAmount - burnAmount);
    }

    /**
     * @notice Fuzz: Permit should work with valid signatures.
     */
    function testFuzz_PermitValidSignature(uint256 amount) public {
        amount = bound(amount, 0, type(uint256).max);

        (address holder, uint256 holderKey) = makeAddrAndKey("holder");

        vm.prank(treasury);
        token.transfer(holder, 1000 ether);

        uint256 nonce = token.nonces(holder);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                holder,
                bob,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, hash);

        token.permit(holder, bob, amount, deadline, v, r, s);

        assertEq(token.allowance(holder, bob), amount);
    }

    /**
     * @notice Fuzz: Vote delegation changes voting power correctly.
     */
    function testFuzz_DelegationChangesVotingPower(uint256 transferAmount) public {
        transferAmount = bound(transferAmount, 0, CAP);

        vm.prank(treasury);
        token.delegate(treasury);

        assertEq(token.getVotes(treasury), CAP);

        vm.prank(treasury);
        token.transfer(alice, transferAmount);

        assertEq(token.getVotes(treasury), CAP - transferAmount);
    }

    // ================================================================
    // INVARIANT TESTS: Properties That Must Always Hold
    // ================================================================

    /**
     * @notice Invariant: Total supply never exceeds the fixed cap.
     */
    function invariant_SupplyNeverExceedsCap() public view {
        assertLe(token.totalSupply(), CAP, "Supply exceeded cap");
    }

    /**
     * @notice Invariant: Sum of all balances equals total supply.
     */
    function invariant_SumOfBalancesEqualsSupply() public view {
        address[4] memory holders = [treasury, alice, bob, owner];
        uint256 sum;

        for (uint256 i = 0; i < holders.length; i++) {
            sum += token.balanceOf(holders[i]);
        }

        assertEq(sum, token.totalSupply(), "Balance sum mismatch");
    }

    /**
     * @notice Invariant: Cap is constant.
     */
    function invariant_CapIsConstant() public view {
        assertEq(token.cap(), CAP, "Cap changed unexpectedly");
    }

    /**
     * @notice Invariant: Name and symbol don't change.
     */
    function invariant_TokenIdentityConstant() public view {
        assertEq(token.name(), "Attribute Point");
        assertEq(token.symbol(), "ATTR");
    }

    // ================================================================
    // HANDLERS: For Stateful Fuzzing
    // ================================================================

    /**
     * @notice Handler: Transfer tokens.
     */
    function handler_transfer(address from, address to, uint256 amount) public {
        vm.assume(from != address(0));
        vm.assume(to != address(0));
        vm.assume(from != to);

        amount = bound(amount, 0, token.balanceOf(from));

        vm.prank(from);
        token.transfer(to, amount);
    }

    /**
     * @notice Handler: Burn tokens.
     */
    function handler_burn(address from, uint256 amount) public {
        amount = bound(amount, 0, token.balanceOf(from));

        vm.prank(from);
        token.burn(amount);
    }
}
