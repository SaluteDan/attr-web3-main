// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/IMembershipFeeDistributor.sol";

/**
 * @title MockMembershipToken
 * @author ATTR Dev
 * @notice Test-only membership ERC-721 exposing the exact tier surface the
 *         distributor binds to: `getTier(uint256)` and live supply helpers.
 *
 * @dev Mirrors the production `MembershipToken` semantics that matter here:
 *      - `getTier` REVERTS for a nonexistent id (`ownerOf` guard), never
 *        silently returns 0 — T0 must be structurally unreachable.
 *      - `tierWeight` is the canonical 225 / 100 / 0 weighting.
 *      - `getTotalWeight()` / `getLiveWeightedSupply()` recompute live over the
 *        whole supply, so any mint/burn/transfer/tier change is reflected
 *        immediately (weights are never frozen).
 */
contract MockMembershipToken is ERC721 {
    /// @notice Tier-1 relative weight (2.25x of T2's 100).
    uint256 public constant TIER1_WEIGHT = 225;
    /// @notice Tier-2 relative weight (baseline 1.0x).
    uint256 public constant TIER2_WEIGHT = 100;

    mapping(uint256 => uint256) public tokenTiers;
    uint256 private _nextTokenId;

    /// @notice Registered fee distributor notified on every transfer (0 = none).
    address public feeDistributor;

    event FeeDistributorSet(address indexed oldDistributor, address indexed newDistributor);

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    // ── Distributor wiring (mirrors production MembershipToken) ───────────────

    /// @notice Register (or clear) the fee distributor notified on transfers.
    function setFeeDistributor(address distributor) external {
        address old = feeDistributor;
        feeDistributor = distributor;
        emit FeeDistributorSet(old, distributor);
    }

    /// @dev Transfer hook: settle both holders' accrual via the distributor.
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (feeDistributor != address(0) && from != address(0) && to != address(0) && from != to) {
            IMembershipFeeDistributor(feeDistributor).checkpoint(tokenId, from, to);
        }
        return from;
    }

    // ── Mint / tier admin (test-only) ──────────────────────────────────────────

    /// @notice Mint a membership of `tier` (1 or 2) to `to`.
    function mint(address to, uint256 tier) external returns (uint256 tokenId) {
        require(tier == 1 || tier == 2, "MockMembershipToken: bad tier");
        tokenId = _nextTokenId++;
        tokenTiers[tokenId] = tier;
        _safeMint(to, tokenId);
    }

    /// @notice Re-label an existing token's tier without moving it.
    function updateTier(uint256 tokenId, uint256 newTier) external {
        require(newTier == 0 || newTier == 1 || newTier == 2, "MockMembershipToken: bad tier");
        ownerOf(tokenId); // reverts for nonexistent id
        tokenTiers[tokenId] = newTier;
    }

    // ── Read surface bound by the distributor ─────────────────────────────────

    /// @notice Read the tier of an existing membership; reverts if unminted.
    function getTier(uint256 tokenId) public view virtual returns (uint256) {
        ownerOf(tokenId); // reverts if the token does not exist
        return tokenTiers[tokenId];
    }

    /// @notice Relative weight for a tier: T1 = 225, T2 = 100, T0 = 0.
    function tierWeight(uint256 tier) public pure returns (uint256) {
        if (tier == 1) return TIER1_WEIGHT;
        if (tier == 2) return TIER2_WEIGHT;
        return 0;
    }

    /// @notice Live total weight `W = 225*nT1 + 100*nT2` over extant supply.
    function getTotalWeight() external view returns (uint256 total) {
        uint256 supply = _nextTokenId;
        for (uint256 i = 0; i < supply; ++i) {
            total += tierWeight(tokenTiers[i]);
        }
    }

    /// @notice Alias kept for brief parity; same live weighted supply.
    function getLiveWeightedSupply() external view returns (uint256) {
        uint256 total;
        uint256 supply = _nextTokenId;
        for (uint256 i = 0; i < supply; ++i) {
            total += tierWeight(tokenTiers[i]);
        }
        return total;
    }

    /// @notice Lifetime minted supply (mirrors production MembershipToken).
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ── Test helpers ──────────────────────────────────────────────────────────

    /// @notice Mint `nT1` tier-1 and `nT2` tier-2 tokens to `to`.
    function mintMany(address to, uint256 nT1, uint256 nT2) external {
        for (uint256 i = 0; i < nT1; ++i) {
            uint256 id = _nextTokenId++;
            tokenTiers[id] = 1;
            _safeMint(to, id);
        }
        for (uint256 i = 0; i < nT2; ++i) {
            uint256 id = _nextTokenId++;
            tokenTiers[id] = 2;
            _safeMint(to, id);
        }
    }
}
