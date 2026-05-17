// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./Errors.sol";

/**
 * @title ATTRToken
 * @author Attributes Platform
 * @notice "Attribute Point" ($ATTR) - The Native Token of the Attributes platform.
 * @dev Features: Capped Supply, Burnable, Gasless Approvals (Permit), Access Control, Governance (Votes), Pausable.
 */
contract ATTRToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, ERC20Votes, AccessControl, Pausable {
    /**
     * @notice Role identifier for addresses authorized to mint new tokens.
     */
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /**
     * @notice Constructor sets up the token with a Cap and Initial Supply.
     * @dev Grants DEFAULT_ADMIN_ROLE and MINTER_ROLE to the deployer. Mints initial supply to treasury.
     * @param cap_ The maximum number of tokens that can ever exist (in wei).
     * @param initialSupply_ The amount to mint immediately to the treasury (must be <= cap_).
     * @param treasury_ The address to receive the initial supply (cannot be zero address).
     */
    constructor(uint256 cap_, uint256 initialSupply_, address treasury_)
        ERC20("Attribute Point", "ATTR")
        ERC20Capped(cap_)
        ERC20Permit("Attribute Point")
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (cap_ == 0) revert InvalidMaxSupply();
        if (initialSupply_ > cap_) revert MaxSupplyExceeded();
        
        // Grant Deployer the Admin and Minter roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        // Mint initial supply
        if (initialSupply_ > 0) {
            _mint(treasury_, initialSupply_);
        }
    }

    /**
     * @notice Mint new tokens to a specified address.
     * @dev Restricted to addresses with MINTER_ROLE. Reverts if total supply would exceed cap.
     * @param to The address to receive the minted tokens.
     * @param amount The amount of tokens to mint (in wei).
     */
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) whenNotPaused {
        _mint(to, amount);
    }

    /**
     * @notice Pause all token transfers and minting.
     * @dev Restricted to addresses with DEFAULT_ADMIN_ROLE. Emits Paused event.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause token transfers and minting, restoring normal operation.
     * @dev Restricted to addresses with DEFAULT_ADMIN_ROLE. Emits Unpaused event.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Override required by ERC20Capped and ERC20Votes
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
