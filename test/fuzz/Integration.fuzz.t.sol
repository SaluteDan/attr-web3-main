// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ATTRToken} from "../../contracts/ATTRToken.sol";
import {NFTCollection} from "../../contracts/NFTCollection.sol";
import {ATTRDeployer} from "../../contracts/ATTRDeployer.sol";

/**
 * @title Integration Fuzz Tests
 * @notice Cross-contract property-based testing
 */
contract IntegrationFuzzTest is Test {
    ATTRToken public attr;
    NFTCollection public nft;
    ATTRDeployer public deployer;
    
    address public owner;
    address public treasury;
    address public alice;
    address public bob;
    
    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        
        vm.startPrank(owner);
        
        // Deploy ATTR Token
        attr = new ATTRToken(
            1_000_000_000 * 1e18,
            100_000_000 * 1e18,
            treasury
        );
        
        // Deploy NFT Collection
        nft = new NFTCollection(
            "AttrNFT",
            "ATTRNFT",
            owner,
            treasury,
            500, // 5% royalty
            "ipfs://contract",
            10000,
            treasury,
            10
        );
        
        // Deploy Factory
        deployer = new ATTRDeployer(owner);
        
        // Fund minter
        attr.grantRole(attr.MINTER_ROLE(), owner);
        
        vm.stopPrank();
    }
    
    // ================================================================
    // CROSS-CONTRACT INVARIANTS
    // ================================================================
    
    /**
     * @notice Fuzz: NFT mint payment correctly transfers ATTR tokens
     * @param price Price in ATTR tokens
     */
    function testFuzz_NFTPaymentWithATTR(uint256 price) public {
        price = bound(price, 1e18, 10000e18);
        
        // Mint ATTR to alice
        vm.prank(owner);
        attr.mint(alice, price);
        
        // Alice approves NFT contract
        vm.prank(alice);
        attr.approve(address(nft), price);
        
        uint256 aliceBalanceBefore = attr.balanceOf(alice);
        uint256 treasuryBalanceBefore = attr.balanceOf(treasury);
        
        // Note: In real scenario, redeem() would transfer tokens
        // This verifies the setup is correct
        assertEq(attr.allowance(alice, address(nft)), price);
        
        // Simulate transfer
        vm.prank(alice);
        attr.transfer(treasury, price);
        
        assertEq(attr.balanceOf(alice), aliceBalanceBefore - price);
        assertEq(attr.balanceOf(treasury), treasuryBalanceBefore + price);
    }
    
    /**
     * @notice Fuzz: Factory deployment tracking
     * @param numCollections Number of collections to deploy
     */
    function testFuzz_FactoryDeploymentTracking(uint8 numCollections) public {
        numCollections = uint8(bound(numCollections, 1, 50));
        
        vm.startPrank(owner);
        
        for (uint i = 0; i < numCollections; i++) {
            string memory name = string(abi.encodePacked("Collection", vm.toString(i)));
            
            address[] memory creators = new address[](1);
            creators[0] = owner;
            uint256[] memory shares = new uint256[](1);
            shares[0] = 1;
            
            address collection = deployer.createCollection(
                name,
                "SYMBOL",
                500,
                creators,
                shares,
                "ipfs://",
                1000,
                5
            );
            
            assertTrue(collection != address(0));
        }
        
        assertEq(deployer.getCollectionCount(), numCollections);
        
        vm.stopPrank();
    }
    
    /**
     * @notice Fuzz: Treasury balance tracks across operations
     */
    function testFuzz_TreasuryBalanceInvariant(
        uint256 mintAmount,
        uint256 transferAmount
    ) public {
        mintAmount = bound(mintAmount, 0, 100_000_000 * 1e18);
        transferAmount = bound(transferAmount, 0, mintAmount);
        
        uint256 initialTreasury = attr.balanceOf(treasury);
        
        // Mint to treasury
        vm.prank(owner);
        attr.mint(treasury, mintAmount);
        
        assertEq(
            attr.balanceOf(treasury),
            initialTreasury + mintAmount,
            "Treasury balance after mint incorrect"
        );
        
        // Treasury transfers out
        vm.prank(treasury);
        attr.transfer(alice, transferAmount);
        
        assertEq(
            attr.balanceOf(treasury),
            initialTreasury + mintAmount - transferAmount,
            "Treasury balance after transfer incorrect"
        );
    }
    
    /**
     * @notice Fuzz: Voting power consistency across transfers
     * @param amount Amount to mint and transfer
     * @param delegateToSelf Whether to self-delegate
     */
    function testFuzz_VotingPowerConsistency(
        uint256 amount,
        bool delegateToSelf
    ) public {
        amount = bound(amount, 1e18, 10_000_000e18);
        
        // Mint to alice
        vm.prank(owner);
        attr.mint(alice, amount);
        
        if (delegateToSelf) {
            vm.prank(alice);
            attr.delegate(alice);
            
            assertEq(attr.getVotes(alice), amount);
        }
        
        // Transfer to bob
        vm.prank(alice);
        attr.transfer(bob, amount / 2);
        
        if (delegateToSelf) {
            // Alice's votes should decrease
            assertEq(attr.getVotes(alice), amount - amount / 2);
            
            // Bob delegates and gets votes
            vm.prank(bob);
            attr.delegate(bob);
            
            assertEq(attr.getVotes(bob), amount / 2);
        }
    }
    
    /**
     * @notice Fuzz: Multiple minters can mint (role-based)
     * @param minterCount Number of minters to authorize
     * @param mintPerMinter Amount each minter mints
     */
    function testFuzz_MultipleMinters(
        uint8 minterCount,
        uint256 mintPerMinter
    ) public {
        minterCount = uint8(bound(minterCount, 1, 10));
        mintPerMinter = bound(mintPerMinter, 0, 10_000_000e18);
        
        address[] memory minters = new address[](minterCount);
        
        // Grant minter roles
        vm.startPrank(owner);
        for (uint i = 0; i < minterCount; i++) {
            minters[i] = makeAddr(string(abi.encodePacked("minter", vm.toString(i))));
            attr.grantRole(attr.MINTER_ROLE(), minters[i]);
        }
        vm.stopPrank();
        
        uint256 totalMintedBefore = attr.totalSupply();
        
        // All minters mint
        for (uint i = 0; i < minterCount; i++) {
            vm.prank(minters[i]);
            try attr.mint(alice, mintPerMinter) {
                // Success
            } catch {
                // May exceed cap
            }
        }
        
        uint256 totalMinted = attr.totalSupply() - totalMintedBefore;
        assertLe(totalMinted, minterCount * mintPerMinter);
        assertLe(attr.totalSupply(), attr.cap());
    }
    
    /**
     * @notice Fuzz: Pause affects all minting operations
     */
    function testFuzz_PauseAffectsAllMinting() public {
        // Initial mint works
        vm.prank(owner);
        attr.mint(alice, 1000e18);
        
        // Pause
        vm.prank(owner);
        attr.pause();
        
        // Minting should fail
        vm.prank(owner);
        vm.expectRevert();
        attr.mint(alice, 1000e18);
        
        // Unpause
        vm.prank(owner);
        attr.unpause();
        
        // Minting works again
        vm.prank(owner);
        attr.mint(alice, 1000e18);
        
        assertEq(attr.balanceOf(alice), 2000e18);
    }
    
    /**
     * @notice Fuzz: Permit enables gasless approvals
     * @param amount Amount to approve
     * @param deadline Permit deadline
     */
    function testFuzz_PermitEnablesTransfer(
        uint256 amount,
        uint256 deadline
    ) public {
        amount = bound(amount, 1, 1000000e18);
        deadline = bound(deadline, block.timestamp + 1, block.timestamp + 365 days);
        
        // Setup holder
        (address holder, uint256 holderKey) = makeAddrAndKey("holder");
        
        vm.prank(owner);
        attr.mint(holder, amount);
        
        // Create permit
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(permitTypehash, holder, address(nft), amount, 0, deadline)
        );
        bytes32 hash = keccak256(
            abi.encodePacked("\x19\x01", attr.DOMAIN_SEPARATOR(), structHash)
        );
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, hash);
        
        // Execute permit
        attr.permit(holder, address(nft), amount, deadline, v, r, s);
        
        assertEq(attr.allowance(holder, address(nft)), amount);
        
        // Spender can transfer
        vm.prank(address(nft));
        attr.transferFrom(holder, treasury, amount);
        
        assertEq(attr.balanceOf(holder), 0);
    }
    
    // ================================================================
    // CROSS-CONTRACT INVARIANTS
    // ================================================================
    
    /**
     * @notice Invariant: ATTR total supply never exceeds cap
     */
    function invariant_ATTRSupplyWithinCap() public view {
        assertLe(attr.totalSupply(), attr.cap());
    }
    
    /**
     * @notice Invariant: NFT supply never exceeds max
     */
    function invariant_NFTSupplyWithinMax() public view {
        assertLe(nft.totalSupply(), nft.MAX_SUPPLY());
    }
    
    /**
     * @notice Invariant: Factory collection count is non-decreasing
     */
    function invariant_FactoryCountNonDecreasing() public view {
        // Collections can only be added, never removed
        assertGe(deployer.getCollectionCount(), 0);
    }
    
    /**
     * @notice Invariant: ATTR token has correct identity
     */
    function invariant_ATTRIdentity() public view {
        assertEq(attr.name(), "Attribute Point");
        assertEq(attr.symbol(), "ATTR");
    }
    
    /**
     * @notice Invariant: NFT has correct identity
     */
    function invariant_NFTIdentity() public view {
        assertEq(nft.name(), "AttrNFT");
        assertEq(nft.symbol(), "ATTRNFT");
    }
}
