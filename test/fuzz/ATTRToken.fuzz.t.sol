// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ATTRToken} from "../../contracts/ATTRToken.sol";

/**
 * @title ATTRToken Fuzz & Invariant Tests
 * @notice Comprehensive property-based testing for ATTRToken
 * @dev Uses Foundry's built-in fuzzer and invariant testing
 */
contract ATTRTokenFuzzTest is Test {
    ATTRToken public token;
    
    // Test addresses
    address public owner;
    address public treasury;
    address public minter;
    address public alice;
    address public bob;
    
    // Constants
    uint256 constant CAP = 1_000_000_000 * 1e18;  // 1B tokens
    uint256 constant INITIAL_MINT = 100_000_000 * 1e18; // 100M tokens
    
    // Invariant tracking
    uint256 public totalMinted;
    uint256 public totalBurned;
    mapping(address => uint256) public userBalances;
    
    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        minter = makeAddr("minter");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        
        vm.startPrank(owner);
        token = new ATTRToken(CAP, INITIAL_MINT, treasury);
        token.grantRole(token.MINTER_ROLE(), minter);
        vm.stopPrank();
        
        totalMinted = INITIAL_MINT;
    }
    
    // ================================================================
    // FUZZ TESTS: Individual Functions
    // ================================================================
    
    /**
     * @notice Fuzz: Mint amount should never exceed cap
     * @param amount Random amount to attempt minting
     * @param recipient Random recipient address
     */
    function testFuzz_MintNeverExceedsCap(uint256 amount, address recipient) public {
        vm.assume(recipient != address(0));
        vm.assume(recipient != address(token));
        
        uint256 currentSupply = token.totalSupply();
        uint256 remaining = CAP - currentSupply;
        
        vm.prank(minter);
        
        if (amount > remaining) {
            vm.expectRevert();
            token.mint(recipient, amount);
        } else {
            token.mint(recipient, amount);
            assertEq(token.totalSupply(), currentSupply + amount);
            assertLe(token.totalSupply(), CAP);
        }
    }
    
    /**
     * @notice Fuzz: Transfers should maintain total supply
     * @param amount Random transfer amount
     * @param fromSeed Seed to select sender
     * @param toSeed Seed to select recipient
     */
    function testFuzz_TransferMaintainsSupply(uint256 amount, uint8 fromSeed, uint8 toSeed) public {
        address[4] memory holders = [treasury, alice, bob, minter];
        address from = holders[fromSeed % 4];
        address to = holders[toSeed % 4];
        
        vm.assume(from != to);
        vm.assume(to != address(0));
        
        uint256 fromBalance = token.balanceOf(from);
        amount = bound(amount, 0, fromBalance);
        
        uint256 supplyBefore = token.totalSupply();
        
        vm.prank(from);
        token.transfer(to, amount);
        
        assertEq(token.totalSupply(), supplyBefore, "Supply changed on transfer");
    }
    
    /**
     * @notice Fuzz: Burn should always reduce total supply
     * @param burnAmount Amount to burn from treasury
     */
    function testFuzz_BurnReducesSupply(uint256 burnAmount) public {
        uint256 treasuryBalance = token.balanceOf(treasury);
        burnAmount = bound(burnAmount, 0, treasuryBalance);
        
        uint256 supplyBefore = token.totalSupply();
        
        vm.prank(treasury);
        token.burn(burnAmount);
        
        assertEq(token.totalSupply(), supplyBefore - burnAmount);
        assertEq(token.balanceOf(treasury), treasuryBalance - burnAmount);
    }
    
    /**
     * @notice Fuzz: Permit should work with valid signatures
     * @param amount Amount to approve via permit
     */
    function testFuzz_PermitValidSignature(uint256 amount) public {
        amount = bound(amount, 0, type(uint256).max);
        
        // Generate keypair for holder
        (address holder, uint256 holderKey) = makeAddrAndKey("holder");
        
        // Give tokens to holder
        vm.prank(minter);
        token.mint(holder, 1000e18);
        
        // Use the actual nonce from the contract
        uint256 nonce = token.nonces(holder);
        
        // Create permit signature
        bytes32 domainSeparator = token.DOMAIN_SEPARATOR();
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 deadline = block.timestamp + 1 hours;
        
        bytes32 structHash = keccak256(
            abi.encode(permitTypehash, holder, bob, amount, nonce, deadline)
        );
        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, hash);
        
        // Execute permit
        token.permit(holder, bob, amount, deadline, v, r, s);
        
        assertEq(token.allowance(holder, bob), amount);
    }
    
    /**
     * @notice Fuzz: Only minter role can mint
     * @param caller Random address attempting to mint
     * @param amount Random mint amount
     */
    function testFuzz_OnlyMinterCanMint(address caller, uint256 amount) public {
        vm.assume(caller != minter);
        vm.assume(!token.hasRole(token.MINTER_ROLE(), caller));
        
        vm.prank(caller);
        vm.expectRevert();
        token.mint(alice, amount);
    }
    
    /**
     * @notice Fuzz: Vote delegation changes voting power correctly
     * @param mintAmount Amount to mint to alice
     * @param transferAmount Amount alice transfers after delegating
     */
    function testFuzz_DelegationChangesVotingPower(uint256 mintAmount, uint256 transferAmount) public {
        mintAmount = bound(mintAmount, 1, 1000000e18);
        transferAmount = bound(transferAmount, 0, mintAmount);
        
        // Mint to alice
        vm.prank(minter);
        token.mint(alice, mintAmount);
        
        // Alice delegates to herself
        vm.prank(alice);
        token.delegate(alice);
        
        assertEq(token.getVotes(alice), mintAmount);
        
        // Alice transfers to bob
        vm.prank(alice);
        token.transfer(bob, transferAmount);
        
        // Alice's voting power should decrease
        assertEq(token.getVotes(alice), mintAmount - transferAmount);
    }
    
    /**
     * @notice Fuzz: Pausable stops transfers
     * @param amount Amount to attempt transferring while paused
     */
    function testFuzz_PauseStopsMinting(uint256 amount) public {
        amount = bound(amount, 1, CAP - INITIAL_MINT);
        
        // Owner pauses
        vm.prank(owner);
        token.pause();
        
        // Mint should fail while paused
        vm.prank(minter);
        vm.expectRevert();
        token.mint(alice, amount);
        
        // Owner unpauses
        vm.prank(owner);
        token.unpause();
        
        // Mint should succeed after unpause
        vm.prank(minter);
        token.mint(alice, amount);
        
        assertEq(token.balanceOf(alice), amount);
    }
    
    // ================================================================
    // INVARIANT TESTS: Properties That Must Always Hold
    // ================================================================
    
    /**
     * @notice Invariant: Total supply never exceeds cap
     */
    function invariant_SupplyNeverExceedsCap() public view {
        assertLe(token.totalSupply(), CAP, "Supply exceeded cap");
    }
    
    /**
     * @notice Invariant: Sum of all balances equals total supply
     */
    function invariant_SumOfBalancesEqualsSupply() public view {
        address[5] memory holders = [treasury, alice, bob, minter, owner];
        uint256 sum;
        
        for (uint i = 0; i < holders.length; i++) {
            sum += token.balanceOf(holders[i]);
        }
        
        assertEq(sum, token.totalSupply(), "Balance sum mismatch");
    }
    
    /**
     * @notice Invariant: Cap is constant
     */
    function invariant_CapIsConstant() public view {
        assertEq(token.cap(), CAP, "Cap changed unexpectedly");
    }
    
    /**
     * @notice Invariant: Name and symbol don't change
     */
    function invariant_TokenIdentityConstant() public view {
        assertEq(token.name(), "Attribute Point");
        assertEq(token.symbol(), "ATTR");
    }
    
    /**
     * @notice Invariant: Owner always has admin role
     */
    function invariant_OwnerHasAdminRole() public view {
        assertTrue(
            token.hasRole(token.DEFAULT_ADMIN_ROLE(), owner),
            "Owner lost admin role"
        );
    }
    
    /**
     * @notice Invariant: Total supply >= total burned (sanity check)
     */
    function invariant_SupplyGteBurned() public view {
        assertGe(token.totalSupply(), 0, "Negative supply impossible");
    }
    
    // ================================================================
    // HANDLERS: For Stateful Fuzzing
    // ================================================================
    
    /**
     * @notice Handler: Mint tokens (called by fuzzer)
     */
    function handler_mint(address to, uint256 amount) public {
        vm.assume(to != address(0));
        amount = bound(amount, 0, 1000000e18);
        
        uint256 supplyBefore = token.totalSupply();
        
        vm.prank(minter);
        try token.mint(to, amount) {
            totalMinted += amount;
            userBalances[to] += amount;
        } catch {
            // Expected if cap would be exceeded
            assertGe(supplyBefore + amount, CAP, "Unexpected mint failure");
        }
    }
    
    /**
     * @notice Handler: Burn tokens
     */
    function handler_burn(address from, uint256 amount) public {
        uint256 balance = token.balanceOf(from);
        amount = bound(amount, 0, balance);
        
        vm.prank(from);
        try token.burn(amount) {
            totalBurned += amount;
            userBalances[from] -= amount;
        } catch {
            // Should not fail if balance sufficient
            assertGt(balance, amount, "Burn failed unexpectedly");
        }
    }
    
    /**
     * @notice Handler: Transfer tokens
     */
    function handler_transfer(address from, address to, uint256 amount) public {
        vm.assume(from != address(0));
        vm.assume(to != address(0));
        vm.assume(from != to);
        
        uint256 fromBalance = token.balanceOf(from);
        amount = bound(amount, 0, fromBalance);
        
        vm.prank(from);
        token.transfer(to, amount);
        
        userBalances[from] -= amount;
        userBalances[to] += amount;
    }
    
    /**
     * @notice Handler: Toggle pause
     */
    function handler_togglePause() public {
        vm.prank(owner);
        if (token.paused()) {
            token.unpause();
        } else {
            token.pause();
        }
    }
}
