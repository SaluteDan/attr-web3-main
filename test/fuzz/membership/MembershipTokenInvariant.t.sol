// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {QAMembershipTokenTest} from "./QAMembershipToken.t.sol";
import {MembershipToken} from "../../../contracts/MembershipToken.sol";
import {ATTRToken} from "../../../contracts/ATTRToken.sol";
import {MockMembershipUSDC} from "../../../contracts/mocks/MockMembershipUSDC.sol";

/// @notice Stateful mixed-payment handler with exact accounting of successful mints.
contract MembershipHandler is Test {
    MembershipToken internal membership;
    MockMembershipUSDC internal usdc;
    address[4] public actors;
    uint256[4] public grants;
    uint256 public ethPaid;
    uint256 public usdcPaid;
    uint256 public successfulMints;
    uint256 public adminMints;
    constructor(MembershipToken membership_, MockMembershipUSDC usdc_) {
        membership = membership_; usdc = usdc_;
        for (uint256 i; i < 4; ++i) actors[i] = vm.addr(i + 100);
    }
    function mintETH(uint8 actorSeed, uint8 tierSeed) external {
        uint256 i = actorSeed % 4; uint256 tier = 1 + tierSeed % 2;
        uint256 price = membership.tierPrices(tier); vm.deal(actors[i], price);
        vm.prank(actors[i]);
        try membership.mintMembership{value: price}(tier, "stateful") {
            ethPaid += price; ++successfulMints; grants[i] += tier == 1 ? 2500 ether : 1000 ether;
        } catch {}
    }
    function mintUSDC(uint8 actorSeed, uint8 tierSeed) external {
        uint256 i = actorSeed % 4; uint256 tier = 1 + tierSeed % 2;
        uint256 price = membership.tierUSDCPrices(tier); uint256 deadline = block.timestamp + 1 days;
        usdc.mint(actors[i], price);
        bytes32 hash = keccak256(abi.encode(keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"), actors[i], address(membership), price, usdc.nonces(actors[i]), deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(i + 100, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), hash)));
        vm.prank(actors[i]);
        try membership.mintMembershipWithUSDC(tier, "stateful", deadline, v, r, s) {
            usdcPaid += price; ++successfulMints; grants[i] += tier == 1 ? 2500 ether : 1000 ether;
        } catch {}
    }
    function adminMint(uint8 actorSeed, uint8 tierSeed) external {
        try membership.adminMintMembership(actors[actorSeed % 4], 1 + tierSeed % 2, "admin") { ++adminMints; } catch {}
    }
    function togglePause(bool paused) external {
        if (paused && !membership.paused()) membership.pause();
        if (!paused && membership.paused()) membership.unpause();
    }
    function reprice(uint8 tierSeed, uint96 priceSeed, bool isUSDC) external {
        uint256 tier = 1 + tierSeed % 2; uint256 price = uint256(priceSeed) + 1;
        if (isUSDC) membership.setTierUSDCPrice(tier, price);
        else membership.setTierPrice(tier, price);
        vm.warp(block.timestamp + 48 hours); membership.executeTierPrice(tier, isUSDC);
    }
}

/// @notice Stateful invariants covering mixed payments, governance and emergency state.
contract MembershipTokenInvariantTest is Test {
    MembershipToken internal membership;
    ATTRToken internal attr;
    MockMembershipUSDC internal usdc;
    address internal treasury = address(0x777);
    MembershipHandler internal handler;
    function setUp() public {
        attr = new ATTRToken(1e9 ether, 0, treasury);
        usdc = new MockMembershipUSDC();
        membership = new MembershipToken("ATTR-MEMBER-ID", "ATTR#", address(this), treasury, treasury, 500, "", 50000, 2);
        membership.configurePaymentTokens(address(attr), address(usdc));
        attr.grantRole(attr.MINTER_ROLE(), address(membership));
        handler = new MembershipHandler(membership, usdc);
        membership.transferOwnership(address(handler));
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.mintETH.selector; selectors[1] = handler.mintUSDC.selector;
        selectors[2] = handler.adminMint.selector; selectors[3] = handler.togglePause.selector; selectors[4] = handler.reprice.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }
    function invariant_SupplyAndTierValidity() public view {
        assertLe(membership.totalSupply(), 50000);
        assertEq(membership.totalSupply(), membership.getNextTokenId());
        assertEq(membership.totalSupply(), handler.successfulMints() + handler.adminMints());
        for (uint256 i; i < membership.totalSupply(); ++i) {
            uint256 tier = membership.tokenTiers(i); assertTrue(tier == 1 || tier == 2);
        }
    }
    function invariant_WalletCapsAndAtomicGrants() public view {
        uint256 counts;
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i); uint256 count = membership.getMintedCount(actor);
            assertLe(count, 2); counts += count; assertEq(attr.balanceOf(actor), handler.grants(i));
        }
        assertEq(counts, handler.successfulMints());
    }
    function invariant_ExactPaymentConservation() public view {
        assertEq(treasury.balance, handler.ethPaid());
        assertEq(usdc.balanceOf(treasury), handler.usdcPaid());
        assertEq(address(membership).balance, 0);
        assertEq(usdc.balanceOf(address(membership)), 0);
        assertGt(membership.tierPrices(1), 0); assertGt(membership.tierPrices(2), 0);
        assertEq(membership.tierPrices(0), 0); assertEq(membership.tierPrices(3), 0);
    }
}
