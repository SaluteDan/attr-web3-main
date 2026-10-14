// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipToken} from "../../../contracts/MembershipToken.sol";
import {ATTRToken} from "../../../contracts/ATTRToken.sol";
import {MockMembershipUSDC} from "../../../contracts/mocks/MockMembershipUSDC.sol";
import {ReentrantMintRecipient} from "../../../contracts/mocks/ReentrantMintRecipient.sol";
import "../../../contracts/Errors.sol";

/// @notice QA and exploit tests for exact checkout, liquid grants and notice periods.
contract QAMembershipTokenTest is Test {
    MembershipToken internal membership;
    ATTRToken internal attr;
    MockMembershipUSDC internal usdc;
    address internal buyer;
    address internal treasury = address(0x777);
    uint256 internal constant KEY = 1;
    uint256 internal constant ETH_PRICE = 0.225 ether;
    uint256 internal constant USDC_PRICE = 580e6;

    function setUp() public {
        buyer = vm.addr(KEY);
        attr = new ATTRToken(1e9 ether, 0, treasury);
        usdc = new MockMembershipUSDC();
        membership = new MembershipToken("ATTR-MEMBER-ID", "ATTR#", address(this), treasury, treasury, 500, "ipfs://collection", 50000, 2);
        membership.configurePaymentTokens(address(attr), address(usdc));
        attr.grantRole(attr.MINTER_ROLE(), address(membership));
        vm.deal(buyer, 100 ether);
        usdc.mint(buyer, 10000e6);
    }

    function signature(uint256 key, uint256 nonce, uint256 deadline, uint256 price, bytes32 domain) internal view returns (uint8, bytes32, bytes32) {
        bytes32 hash = keccak256(abi.encode(keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"), buyer, address(membership), price, nonce, deadline));
        return vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, hash)));
    }

    bool internal expectPermitFailure;
    function mintUSDC(uint256 tier, uint256 key, uint256 nonce, uint256 deadline, bytes32 domain) internal {
        (uint8 v, bytes32 r, bytes32 s) = signature(key, nonce, deadline, tier == 1 ? USDC_PRICE : 260e6, domain);
        vm.prank(buyer);
        if (expectPermitFailure) { expectPermitFailure = false; vm.expectRevert(); }
        membership.mintMembershipWithUSDC(tier, "ipfs://permit", deadline, v, r, s);
    }

    function test_ETH_Tier1_GrantAndPayment() public {
        vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "ipfs://1");
        assertEq(attr.balanceOf(buyer), 2500 ether);
        assertEq(treasury.balance, ETH_PRICE);
        assertEq(membership.ownerOf(0), buyer);
    }
    function test_ETH_Tier2_Grant() public {
        vm.prank(buyer); membership.mintMembership{value: 0.1 ether}(2, "ipfs://2");
        assertEq(attr.balanceOf(buyer), 1000 ether);
    }
    function test_USDC_Tier1_ValidPermit() public {
        mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        assertEq(usdc.balanceOf(treasury), USDC_PRICE);
        assertEq(usdc.allowance(buyer, address(membership)), 0);
        assertEq(attr.balanceOf(buyer), 2500 ether);
        assertEq(usdc.nonces(buyer), 1);
    }
    function test_USDC_Tier2_ValidPermit() public {
        mintUSDC(2, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        assertEq(usdc.balanceOf(treasury), 260e6);
        assertEq(attr.balanceOf(buyer), 1000 ether);
    }
    function test_PermitReplay() public {
        uint256 deadline = block.timestamp + 1 days;
        mintUSDC(1, KEY, 0, deadline, usdc.DOMAIN_SEPARATOR());
        expectPermitFailure = true; mintUSDC(1, KEY, 0, deadline, usdc.DOMAIN_SEPARATOR());
        assertEq(membership.totalSupply(), 1);
    }
    function test_PermitWrongSigner() public {
        expectPermitFailure = true; mintUSDC(1, 2, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
    }
    function test_PermitWrongDomain() public {
        expectPermitFailure = true; mintUSDC(1, KEY, 0, block.timestamp + 1 days, bytes32(0));
    }
    function test_PermitExpired() public {
        vm.warp(100);
        expectPermitFailure = true; mintUSDC(1, KEY, 0, 99, usdc.DOMAIN_SEPARATOR());
    }
    function test_PermitFrontRunCannotStealMembership() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signature(KEY, 0, deadline, USDC_PRICE, usdc.DOMAIN_SEPARATOR());
        vm.prank(address(0xBAD)); vm.expectRevert();
        membership.mintMembershipWithUSDC(1, "stolen", deadline, v, r, s);
        mintUSDC(1, KEY, 0, deadline, usdc.DOMAIN_SEPARATOR());
        assertEq(membership.ownerOf(0), buyer);
    }
    function test_ConsumedPermitSucceeds() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signature(KEY, 0, deadline, USDC_PRICE, usdc.DOMAIN_SEPARATOR());
        // An observer or front-runner submits the permit directly to USDC
        usdc.permit(buyer, address(membership), USDC_PRICE, deadline, v, r, s);
        // Buyer checkout still succeeds because allowance was granted; permit failure is swallowed
        vm.prank(buyer);
        membership.mintMembershipWithUSDC(1, "x", deadline, v, r, s);
        assertEq(usdc.balanceOf(treasury), USDC_PRICE);
        assertEq(membership.ownerOf(0), buyer);
        assertEq(attr.balanceOf(buyer), 2500 ether);
    }
    function test_RevokedRoleRollsBackETH() public {
        attr.revokeRole(attr.MINTER_ROLE(), address(membership));
        vm.prank(buyer); vm.expectRevert(); membership.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(treasury.balance, 0); assertEq(membership.totalSupply(), 0); assertEq(membership.getMintedCount(buyer), 0);
    }
    function test_RevokedRoleRollsBackPermitAndTransfer() public {
        attr.revokeRole(attr.MINTER_ROLE(), address(membership));
        expectPermitFailure = true; mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        assertEq(usdc.nonces(buyer), 0); assertEq(usdc.balanceOf(treasury), 0); assertEq(membership.totalSupply(), 0);
    }
    function test_AdminHasNoGrant() public {
        membership.adminMintMembership(buyer, 1, "admin");
        assertEq(attr.balanceOf(buyer), 0);
    }
    function test_AdminInvalidTier() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 0)); membership.adminMintMembership(buyer, 0, "admin");
    }
    function test_RelabelInvalidTier() public {
        membership.adminMintMembership(buyer, 1, "admin");
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 0)); membership.updateTier(0, 0);
    }
    function test_MixedPaymentWalletCap() public {
        mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "x");
        vm.prank(buyer); vm.expectRevert(MaxMintPerWalletExceeded.selector); membership.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(attr.balanceOf(buyer), 5000 ether);
    }
    function test_TransferDoesNotResetCap() public {
        vm.startPrank(buyer);
        membership.mintMembership{value: ETH_PRICE}(1, "x"); membership.transferFrom(buyer, treasury, 0);
        membership.mintMembership{value: ETH_PRICE}(1, "x");
        vm.expectRevert(MaxMintPerWalletExceeded.selector); membership.mintMembership{value: ETH_PRICE}(1, "x"); vm.stopPrank();
    }
    function test_SupplyBoundary() public {
        // Target the compiler-reported _nextTokenId storage slot for a boundary fixture.
        vm.store(address(membership), bytes32(uint256(16)), bytes32(uint256(49999)));
        assertEq(membership.getNextTokenId(), 49999);
        vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(membership.totalSupply(), 50000);
        vm.prank(buyer); vm.expectRevert(MaxSupplyExceeded.selector); membership.mintMembership{value: ETH_PRICE}(1, "x");
    }
    function test_NoticeAndExecution() public {
        membership.setTierPrice(1, 1 ether);
        vm.expectRevert(PriceUpdateNotReady.selector); membership.executeTierPrice(1, false);
        vm.warp(block.timestamp + 48 hours); membership.executeTierPrice(1, false);
        assertEq(membership.tierPrices(1), 1 ether);
        vm.expectRevert(PriceUpdateNotReady.selector); membership.executeTierPrice(1, false);
    }
    function test_USDCNoticeAndExecution() public {
        membership.setTierUSDCPrice(2, 450e6);
        vm.warp(block.timestamp + 48 hours); membership.executeTierPrice(2, true);
        assertEq(membership.tierUSDCPrices(2), 450e6);
    }
    function test_RequeueRestartsNotice() public {
        membership.setTierPrice(1, 1 ether); vm.warp(block.timestamp + 47 hours);
        membership.setTierPrice(1, 2 ether); vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(PriceUpdateNotReady.selector); membership.executeTierPrice(1, false);
    }
    function test_ZeroPriceRejected() public {
        vm.expectRevert(InvalidTierPrice.selector); membership.setTierPrice(1, 0);
        vm.expectRevert(InvalidTierPrice.selector); membership.setTierUSDCPrice(1, 0);
    }
    function test_ConfigurationIsOneTime() public {
        vm.expectRevert(PaymentTokensAlreadyConfigured.selector); membership.configurePaymentTokens(address(attr), address(usdc));
    }
    function test_PauseAllMintPaths() public {
        membership.pause();
        vm.prank(buyer); vm.expectRevert(); membership.mintMembership{value: ETH_PRICE}(1, "x");
        expectPermitFailure = true; mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        vm.expectRevert(); membership.adminMintMembership(buyer, 1, "x");
        membership.unpause(); vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "x");
    }
    function test_ERC721HookReentryRollsBack() public {
        ReentrantMintRecipient attack = new ReentrantMintRecipient(address(membership), 1, ETH_PRICE);
        vm.deal(address(attack), ETH_PRICE);
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        membership.adminMintMembership(address(attack), 1, "x");
        assertEq(membership.totalSupply(), 0);
    }
    function testFuzz_ExactETH(uint256 value) public {
        value = bound(value, 0, 10 ether); vm.deal(buyer, value);
        vm.prank(buyer);
        if (value != ETH_PRICE) vm.expectRevert(abi.encodeWithSelector(ExactPaymentRequired.selector, ETH_PRICE, value));
        membership.mintMembership{value: value}(1, "x");
    }
    function testFuzz_InvalidTier(uint256 tier) public {
        vm.assume(tier != 1 && tier != 2); vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, tier)); membership.mintMembership(tier, "x");
    }
    function testFuzz_UnauthorizedPrice(address attacker) public {
        vm.assume(attacker != address(this)); vm.prank(attacker); vm.expectRevert(); membership.setTierPrice(1, 1);
    }
    function testFuzz_InvalidPermitV(uint8 v) public {
        vm.assume(v != 27 && v != 28); vm.prank(buyer); vm.expectRevert();
        membership.mintMembershipWithUSDC(1, "x", block.timestamp + 1 days, v, bytes32(uint256(1)), bytes32(uint256(1)));
    }
}
