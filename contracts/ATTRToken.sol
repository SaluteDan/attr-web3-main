// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "./Errors.sol";

/**
 * @title ATTRToken
 * @author Attributes Gallery
 * @notice "Attribute Point" ($ATTR) - The Native Token of the Attributes platform.
 * @dev Features: Fixed capped supply, Burnable, Gasless Approvals (Permit), Governance (Votes).
 *
 *      Issuance model (see specs/attr-issuance-preminted-treasury.md):
 *      - The entire 1,000,000,000 ATTR cap is minted exactly once, at deploy, to the
 *        distribution address. `mint()` and `MINTER_ROLE` no longer exist.
 *      - Total supply is therefore constant at the cap forever, except when tokens are
 *        burned via `burn()` / `burnFrom()`.
 */
contract ATTRToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, ERC20Votes {
    /**
     * @notice Fixed, immutable supply cap: 1,000,000,000 ATTR.
     */
    uint256 public constant CAP = 1_000_000_000 ether;

    /**
     * @notice Deploys the token and mints the entire fixed cap to `distributionDeployer_`.
     * @dev There is no mint function; the full cap is created in a single update at deploy.
     * @param distributionDeployer_ The address receiving the full 1B allocation (cannot be zero).
     */
    constructor(address distributionDeployer_)
        ERC20("Attribute Point", "ATTR")
        ERC20Capped(CAP)
        ERC20Permit("Attribute Point")
    {
        if (distributionDeployer_ == address(0)) revert ZeroAddress();

        // Mint the entire fixed cap to the distribution address in a single update.
        _mint(distributionDeployer_, CAP);
    }

    /**
     * @dev Override required by ERC20Capped and ERC20Votes.
     */
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped, ERC20Votes) {
        super._update(from, to, value);
    }

    /**
     * @notice Get the current nonce for an address for permit functionality.
     * @dev Override required by ERC20Permit and ERC20Votes.
     * @param owner The address to query the nonce for.
     * @return The current nonce of the owner.
     */
    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
