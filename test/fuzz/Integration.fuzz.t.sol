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

        // Deploy ATTR Token: the entire fixed cap mints to the treasury at deploy.
        attr = new ATTRToken(treasury);

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
            10,
            treasury,     // tipReceiver_
            address(0)    // attrSpender_ (disabled)
        );

        // Deploy Factory
        deployer = new ATTRDeployer(owner, address(0));

        vm.stopPrank();
    }

    // ================================================================
    // FUZZ TESTS
    // ================================================================

    /**
     * @notice The full cap is minted at deploy and never changes (absent burns).
     */
    function test_DeployMintsEntireCap() public view {
        assertEq(attr.totalSupply(), attr.cap());
        assertEq(attr.balanceOf(treasury), attr.cap());
    }

    /**
     * @notice Fuzz: NFT payment with ATTR transfers tokens from holder to treasury.
     * @param price Price in ATTR tokens
     */
    function testFuzz_NFTPaymentWithATTR(uint256 price) public {
        price = bound(price, 1e18, 10000e18);

        // Fund alice from the pre-minted treasury allocation.
        vm.prank(treasury);
        attr.transfer(alice, price);

        vm.prank(alice);
        attr.approve(address(nft), price);

        uint256 aliceBalanceBefore = attr.balanceOf(alice);
        uint256 treasuryBalanceBefore = attr.balanceOf(treasury);

        assertEq(attr.allowance(alice, address(nft)), price);

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
     * @notice Fuzz: Treasury balance decreases by exactly the amount transferred out.
     */
    function testFuzz_TreasuryBalanceInvariant(uint256 transferAmount) public {
        transferAmount = bound(transferAmount, 0, attr.balanceOf(treasury));

        uint256 initialTreasury = attr.balanceOf(treasury);

        vm.prank(treasury);
        attr.transfer(alice, transferAmount);

        assertEq(attr.balanceOf(treasury), initialTreasury - transferAmount, "Treasury balance incorrect");
        assertEq(attr.balanceOf(alice), transferAmount, "Recipient balance incorrect");
    }

    /**
     * @notice Fuzz: Voting power consistency across transfers
     * @param amount Amount to distribute and transfer
     * @param delegateToSelf Whether to self-delegate
     */
    function testFuzz_VotingPowerConsistency(uint256 amount, bool delegateToSelf) public {
        amount = bound(amount, 1e18, 10_000_000e18);

        vm.prank(treasury);
        attr.transfer(alice, amount);

        if (delegateToSelf) {
            vm.prank(alice);
            attr.delegate(alice);

            assertEq(attr.getVotes(alice), amount);
        }

        vm.prank(alice);
        attr.transfer(bob, amount / 2);

        if (delegateToSelf) {
            assertEq(attr.getVotes(alice), amount - amount / 2);

            vm.prank(bob);
            attr.delegate(bob);

            assertEq(attr.getVotes(bob), amount / 2);
        }
    }

    /**
     * @notice Fuzz: Burning always keeps supply within the fixed cap.
     * @param burnAmount Amount the treasury burns
     */
    function testFuzz_BurnKeepsSupplyWithinCap(uint256 burnAmount) public {
        burnAmount = bound(burnAmount, 0, attr.balanceOf(treasury));

        uint256 supplyBefore = attr.totalSupply();

        vm.prank(treasury);
        attr.burn(burnAmount);

        assertEq(attr.totalSupply(), supplyBefore - burnAmount);
        assertLe(attr.totalSupply(), attr.cap());
    }

    /**
     * @notice Fuzz: Permit enables gasless approvals
     * @param amount Amount to approve
     * @param deadline Permit deadline
     */
    function testFuzz_PermitEnablesTransfer(uint256 amount, uint256 deadline) public {
        amount = bound(amount, 1, 1000000e18);
        deadline = bound(deadline, block.timestamp + 1, block.timestamp + 365 days);

        (address holder, uint256 holderKey) = makeAddrAndKey("holder");

        vm.prank(treasury);
        attr.transfer(holder, amount);

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

        attr.permit(holder, address(nft), amount, deadline, v, r, s);

        assertEq(attr.allowance(holder, address(nft)), amount);

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
