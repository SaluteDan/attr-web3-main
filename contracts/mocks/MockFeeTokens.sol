// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MockMembershipToken.sol";

/**
 * @title MockFeeUSDC
 * @author ATTR Dev
 * @notice Test-only 6-decimal ERC-20 used as a distribution currency.
 * @dev The mint helper lets arbitrary modules (fuzz handlers, security probes)
 *      fund themselves without a privileged role.
 */
contract MockFeeUSDC is ERC20 {
    constructor() ERC20("Fee USDC", "fUSDC") {}

    /// @notice USDC-compatible precision.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unrestricted test funding.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockFeeOnTransferERC20
 * @author ATTR Dev
 * @notice ERC-20 that burns a basis-point fee from every transfer.
 * @dev Models the S9 non-standard token: a distributor that credited the
 *      nominal `amount` instead of the received delta becomes insolvent.
 */
contract MockFeeOnTransferERC20 is ERC20 {
    /// @notice Fee charged on every transfer, in basis points.
    uint256 public immutable feeBps;
    /// @notice Recipient of the burned fee (the fee is simply not delivered).
    address public constant SINK = address(0xFEE);

    constructor(uint256 feeBps_) ERC20("Fee Token", "FEE") {
        require(feeBps_ <= 10_000, "fee too high");
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        if (fee != 0) {
            super._update(from, SINK, fee);
        }
        super._update(from, to, value - fee);
    }
}

/**
 * @title MaliciousTierToken
 * @author ATTR Dev
 * @notice Membership mock that flips a token's tier on every `getTier` read.
 * @dev Adversarial case from the QA brief: "malicious token changing tier
 *      mid-batch". Each claim reads `getTier` for the token, so a token whose
 *      tier oscillates 2 -> 1 is credited at T1 weight on that read, while the
 *      live weighted supply stays T2. The distributor must therefore out-credit
 *      the live weight and become momentarily under-collateralised — which the
 *      solvency assertion of the security suite pins down.
 */
contract MaliciousTierToken is MockMembershipToken {
    bool private _toggled;

    constructor() MockMembershipToken("Evil Member", "EVIL") {}

    function getTier(uint256 tokenId) public view override returns (uint256) {
        ownerOf(tokenId);
        bool flip = _toggled;
        if (flip) {
            return tokenTiers[tokenId] == 2 ? 1 : 2;
        }
        return tokenTiers[tokenId];
    }

    /// @notice Arm/disarm the per-read oscillation.
    function setToggle(bool value) external {
        _toggled = value;
    }
}
