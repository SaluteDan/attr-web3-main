// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {QAMembershipTokenTest} from "./QAMembershipToken.t.sol";
import {MembershipToken} from "../../../contracts/MembershipToken.sol";
import {MockMembershipUSDC} from "../../../contracts/mocks/MockMembershipUSDC.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "../../../contracts/Errors.sol";

/// @notice Callback probe shared by ETH, permit, transfer, grant and NFT attack surfaces.
contract CallbackProbe is IERC721Receiver {
    MembershipToken internal target;
    bytes public lastError;
    bool public observedTier;
    bool public withdraw;
    function arm(MembershipToken target_, bool withdraw_) external { target = target_; withdraw = withdraw_; }
    function probe() internal {
        observedTier = target.tokenTiers(0) == 1 && target.getNextTokenId() == 1;
        (bool ok, bytes memory reason) = address(target).call(withdraw ? abi.encodeCall(target.withdrawPayments, ()) : abi.encodeCall(target.mintMembership, (1, "reentry")));
        require(!ok, "reentry succeeded"); lastError = reason;
    }
    receive() external payable { probe(); }
    function mint() external payable { target.mintMembership{value: msg.value}(1, "attack"); }
    function flush() external { target.withdrawPayments(); }
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) { probe(); return this.onERC721Received.selector; }
}

/// @notice Test-only malicious ERC20 callback in permit or transferFrom.
contract HookUSDC is MockMembershipUSDC {
    MembershipToken internal target;
    bool internal atPermit;
    bytes public lastError;
    function arm(MembershipToken target_, bool atPermit_) external { target = target_; atPermit = atPermit_; }
    function probe() internal {
        (bool ok, bytes memory reason) = address(target).call(abi.encodeCall(target.mintMembershipWithUSDC, (1, "attack", 0, 0, bytes32(0), bytes32(0))));
        require(!ok, "reentry succeeded"); lastError = reason;
    }
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public override {
        if (atPermit) probe(); super.permit(owner, spender, value, deadline, v, r, s);
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (!atPermit) probe(); return super.transferFrom(from, to, value);
    }
}

/// @notice Grant-vault callback probe; membership still holds its reentrancy lock.
contract HookGrant {
    MembershipToken internal target;
    bytes public lastError;
    function arm(MembershipToken target_) external { target = target_; }
    /// @notice Mirrors the vault getter so the membership's authorization check passes.
    function membershipToken() external view returns (address) { return address(target); }
    function disburseGrant(address, uint256) external {
        (bool ok, bytes memory reason) = address(target).call(abi.encodeCall(target.mintMembership, (1, "attack")));
        require(!ok, "reentry succeeded"); lastError = reason;
    }
}

/// @notice Fresh exploit coverage for every external callback boundary.
contract MembershipTokenSecurityTest is QAMembershipTokenTest {
    bytes4 internal constant GUARD = bytes4(keccak256("ReentrancyGuardReentrantCall()"));
    function test_ETHReceiverReentryAndCEI() public {
        CallbackProbe attack = new CallbackProbe(); attack.arm(membership, false);
        membership.setPaymentReceiver(address(attack));
        vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(bytes4(attack.lastError()), GUARD); assertTrue(attack.observedTier()); assertEq(membership.totalSupply(), 1);
    }
    function test_NFTReceiverReentryAndCEI() public {
        CallbackProbe attack = new CallbackProbe(); attack.arm(membership, false);
        attack.mint{value: ETH_PRICE}();
        assertEq(bytes4(attack.lastError()), GUARD); assertTrue(attack.observedTier()); assertEq(attr.balanceOf(address(attack)), 2500 ether);
    }
    function test_WithdrawOwnerReentry() public {
        CallbackProbe attack = new CallbackProbe(); attack.arm(membership, true);
        membership.setPaymentReceiver(address(attack)); membership.transferOwnership(address(attack));
        vm.deal(address(membership), 1 ether); attack.flush();
        assertEq(bytes4(attack.lastError()), GUARD); assertEq(address(membership).balance, 0);
    }
    function hookCheckout(bool atPermit) internal {
        HookUSDC hook = new HookUSDC();
        membership = new MembershipToken("ATTR-MEMBER-ID", "ATTR#", address(this), treasury, treasury, 500, "", 50000, 2);
        vault.setMembershipToken(address(membership));
        membership.configurePaymentTokens(address(vault), address(hook));
        hook.arm(membership, atPermit); hook.mint(buyer, 1000e6); usdc = hook;
        mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        assertEq(bytes4(hook.lastError()), GUARD); assertEq(usdc.balanceOf(treasury), USDC_PRICE);
    }
    function test_PermitCallbackReentry() public { hookCheckout(true); }
    function test_TransferCallbackReentry() public { hookCheckout(false); }
    function test_GrantCallbackReentry() public {
        HookGrant hook = new HookGrant();
        MembershipToken fresh = new MembershipToken("ATTR-MEMBER-ID", "ATTR#", address(this), treasury, treasury, 500, "", 50000, 2);
        hook.arm(fresh); fresh.configurePaymentTokens(address(hook), address(usdc));
        vm.prank(buyer); fresh.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(bytes4(hook.lastError()), GUARD);
    }
    function test_HighSMalleability() public {
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = signature(KEY, 0, deadline, USDC_PRICE, usdc.DOMAIN_SEPARATOR());
        s = bytes32(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(s));
        vm.prank(buyer); vm.expectRevert(); membership.mintMembershipWithUSDC(1, "x", deadline, v == 27 ? 28 : 27, r, s);
    }
    function test_PermitInsufficientBalanceRollback() public {
        uint256 balance = usdc.balanceOf(buyer);
        vm.prank(buyer); usdc.transfer(treasury, balance);
        expectPermitFailure = true; mintUSDC(1, KEY, 0, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
        assertEq(usdc.nonces(buyer), 0); assertEq(membership.totalSupply(), 0);
    }
    function test_RejectEOATokenConfiguration() public {
        MembershipToken fresh = new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50000, 2);
        vm.expectRevert(InvalidPaymentToken.selector); fresh.configurePaymentTokens(buyer, address(usdc));
    }
    function test_BaseMainnetRejectsNoncanonicalUSDC() public {
        MembershipToken fresh = new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50000, 2);
        vm.chainId(8453); vm.expectRevert(InvalidPaymentToken.selector); fresh.configurePaymentTokens(address(vault), address(usdc));
    }
    function test_UnconfiguredCheckoutFailsClosed() public {
        MembershipToken fresh = new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50000, 2);
        vm.prank(buyer); vm.expectRevert(InvalidPaymentToken.selector); fresh.mintMembership{value: ETH_PRICE}(1, "x");
    }
    function test_AdminBatchInvalidTierAtomicity() public {
        address[] memory recipients = new address[](2); recipients[0] = buyer; recipients[1] = buyer;
        uint256[] memory tiers = new uint256[](2); tiers[0] = 1; tiers[1] = 0;
        string[] memory uris = new string[](2);
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 0)); membership.adminBatchMintMemberships(recipients, tiers, uris);
        assertEq(membership.totalSupply(), 0);
    }
    function test_ConstructorRejectsExcessSupply() public {
        vm.expectRevert(InvalidMaxSupply.selector); new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50001, 2);
    }
    function test_ConstructorRejectsExcessWalletCap() public {
        vm.expectRevert(InvalidMaxMintPerWallet.selector); new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50000, 3);
    }
    function test_RejectedTreasuryAtomicity() public {
        membership.setPaymentReceiver(address(membership));
        vm.prank(buyer); vm.expectRevert(TransferFailed.selector); membership.mintMembership{value: ETH_PRICE}(1, "x");
        assertEq(membership.totalSupply(), 0); assertEq(attr.balanceOf(buyer), 0);
    }
    function test_WithdrawWhilePaused() public {
        membership.pause(); vm.deal(address(membership), 1 ether); membership.withdrawPayments(); assertEq(treasury.balance, 1 ether);
    }
    function testFuzz_PermitWrongNonce(uint256 nonce) public {
        vm.assume(nonce != 0); expectPermitFailure = true;
        mintUSDC(1, KEY, nonce, block.timestamp + 1 days, usdc.DOMAIN_SEPARATOR());
    }
    function testFuzz_ValidTierGrant(uint8 seed) public {
        uint256 tier = 1 + seed % 2;
        uint256 price = membership.tierPrices(tier);
        vm.prank(buyer); membership.mintMembership{value: price}(tier, "x");
        assertEq(attr.balanceOf(buyer), tier == 1 ? 2500 ether : 1000 ether);
    }
    /// @notice Owner controls cannot be bypassed by arbitrary EOAs.
    function test_AllOwnerControlsRejectAttacker() public {
        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeCall(membership.setTierPrice, (1, 1));
        calls[1] = abi.encodeCall(membership.setTierUSDCPrice, (1, 1));
        calls[2] = abi.encodeCall(membership.setPaymentReceiver, (buyer));
        calls[3] = abi.encodeCall(membership.setTokenURI, (0, "x"));
        calls[4] = abi.encodeCall(membership.setContractURI, ("x"));
        calls[5] = abi.encodeCall(membership.updateTier, (0, 2));
        calls[6] = abi.encodeCall(membership.adminMintMembership, (buyer, 1, "x"));
        calls[7] = abi.encodeCall(membership.withdrawPayments, ());
        calls[8] = abi.encodeCall(membership.pause, ());
        calls[9] = abi.encodeCall(membership.unpause, ());
        calls[10] = abi.encodeCall(membership.configurePaymentTokens, (address(vault), address(usdc)));
        address[] memory recipients = new address[](0);
        uint256[] memory tiers = new uint256[](0);
        string[] memory uris = new string[](0);
        calls[11] = abi.encodeCall(membership.adminBatchMintMemberships, (recipients, tiers, uris));
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(buyer);
            (bool ok, bytes memory reason) = address(membership).call(calls[i]);
            assertFalse(ok);
            assertEq(bytes4(reason), bytes4(keccak256("OwnableUnauthorizedAccount(address)")));
        }
    }
    /// @notice Metadata, votes, royalty and interface surfaces survive modernization.
    function test_MetadataVotesRoyaltiesAndInterfaces() public {
        membership.setContractURI("collection"); assertEq(membership.contractURI(), "collection");
        membership.adminMintMembership(buyer, 1, "original");
        membership.setTokenURI(0, "updated"); assertEq(membership.tokenURI(0), "updated");
        membership.updateTier(0, 2); assertEq(membership.getTier(0), 2);
        vm.prank(buyer); membership.delegate(buyer); assertEq(membership.getVotes(buyer), 1);
        vm.prank(buyer); membership.transferFrom(buyer, treasury, 0); assertEq(membership.getVotes(buyer), 0);
        (address receiver, uint256 amount) = membership.royaltyInfo(0, 1 ether);
        assertEq(receiver, treasury); assertEq(amount, 0.05 ether);
        assertTrue(membership.supportsInterface(0x80ac58cd)); assertTrue(membership.supportsInterface(0x2a55205a));
        assertFalse(membership.supportsInterface(0xffffffff));
    }
    /// @notice Supply cap and batch guards are atomic across all owner allocation paths.
    function test_AdminBatchBoundariesAndPause() public {
        address[] memory recipients = new address[](2); recipients[0] = buyer; recipients[1] = treasury;
        uint256[] memory tiers = new uint256[](2); tiers[0] = 1; tiers[1] = 2;
        string[] memory uris = new string[](2); uris[0] = "one"; uris[1] = "two";
        membership.adminBatchMintMemberships(recipients, tiers, uris);
        assertEq(membership.totalSupply(), 2); assertEq(membership.getTier(1), 2);
        assertEq(attr.balanceOf(buyer), 0);
        vm.store(address(membership), bytes32(uint256(16)), bytes32(uint256(49999)));
        vm.expectRevert(MaxSupplyExceeded.selector); membership.adminBatchMintMemberships(recipients, tiers, uris);
        membership.adminMintMembership(buyer, 1, "last");
        vm.expectRevert(MaxSupplyExceeded.selector); membership.adminMintMembership(buyer, 2, "excess");
        membership.pause(); vm.expectRevert(); membership.adminBatchMintMemberships(recipients, tiers, uris);
    }
    /// @notice Bad batch lengths and zero recipients never consume token IDs.
    function test_BatchAndAdminInputGuards() public {
        address[] memory recipients = new address[](1); uint256[] memory tiers = new uint256[](1); tiers[0] = 1;
        string[] memory uris = new string[](0);
        vm.expectRevert(ArrayLengthMismatch.selector); membership.adminBatchMintMemberships(recipients, tiers, uris);
        uris = new string[](1);
        vm.expectRevert(ZeroAddress.selector); membership.adminBatchMintMemberships(recipients, tiers, uris);
        vm.expectRevert(ZeroAddress.selector); membership.adminMintMembership(address(0), 1, "x");
        vm.expectRevert(ZeroAddress.selector); membership.setPaymentReceiver(address(0));
        vm.expectRevert(NothingToClaim.selector); membership.withdrawPayments();
        vm.expectRevert(); membership.getTier(999);
    }
    /// @notice Zero royalty/receiver addresses and zero caps are rejected at deployment.
    function test_ConstructorZeroGuards() public {
        vm.expectRevert(ZeroAddress.selector); new MembershipToken("x", "x", address(this), address(0), treasury, 0, "", 50000, 2);
        vm.expectRevert(ZeroAddress.selector); new MembershipToken("x", "x", address(this), treasury, address(0), 0, "", 50000, 2);
        vm.expectRevert(InvalidMaxSupply.selector); new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 0, 2);
        vm.expectRevert(InvalidMaxMintPerWallet.selector); new MembershipToken("x", "x", address(this), treasury, treasury, 0, "", 50000, 0);
    }
    /// @notice No missing queue or invalid tier can activate a price.
    function test_PriceExecutionAndUSDCInvalidTiers() public {
        vm.expectRevert(PriceUpdateNotReady.selector); membership.executeTierPrice(1, true);
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 0)); membership.executeTierPrice(0, false);
        vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 3)); membership.setTierUSDCPrice(3, 1);
        vm.prank(buyer); vm.expectRevert(abi.encodeWithSelector(InvalidTier.selector, 0));
        membership.mintMembershipWithUSDC(0, "x", 0, 0, bytes32(0), bytes32(0));
    }
    /// @notice A rejected emergency payout retains forced ETH, including while paused.
    function test_WithdrawRejectedReceiverRetainsFunds() public {
        membership.setPaymentReceiver(address(membership)); vm.deal(address(membership), 1 ether);
        vm.expectRevert(TransferFailed.selector); membership.withdrawPayments();
        assertEq(address(membership).balance, 1 ether);
    }
    /// @notice Queued pricing preserves current checkout and exact old-payment consent.
    function test_QueuedPriceHonorsExistingCheckout() public {
        membership.setTierPrice(1, 1 ether);
        vm.prank(buyer); membership.mintMembership{value: ETH_PRICE}(1, "old");
        vm.warp(block.timestamp + 48 hours); membership.executeTierPrice(1, false);
        vm.prank(buyer); vm.expectRevert(abi.encodeWithSelector(ExactPaymentRequired.selector, 1 ether, ETH_PRICE));
        membership.mintMembership{value: ETH_PRICE}(1, "stale");
        assertEq(membership.getTier(0), 1); assertEq(attr.balanceOf(buyer), 2500 ether);
    }
    /// @notice Chain-ID domain mismatches cannot redeem somebody else's permit.
    function test_PermitWrongChainDomain() public {
        bytes32 domain = usdc.DOMAIN_SEPARATOR();
        vm.chainId(123456);
        expectPermitFailure = true; mintUSDC(1, KEY, 0, block.timestamp + 1 days, domain);
    }
    /// @notice Twenty invalid signer permutations fail without payment or grant.
    function test_TwentyInvalidSignerPermutations() public {
        bytes32 domain = usdc.DOMAIN_SEPARATOR();
        for (uint256 i = 2; i < 22; ++i) {
            expectPermitFailure = true; mintUSDC(1, i, 0, block.timestamp + 1 days, domain);
        }
        assertEq(membership.totalSupply(), 0); assertEq(usdc.nonces(buyer), 0);
    }

}
