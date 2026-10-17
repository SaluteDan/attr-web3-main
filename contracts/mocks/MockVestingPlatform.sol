// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../Errors.sol";

/**
 * @title MockVestingPlatform
 * @notice Minimal Sablier/Hedgey-style vesting stream harness for deterministic local CI.
 * @dev Simulates third-party stream creation so testnet/CI never depends on external networks.
 *      Never deploy this mock to production.
 */
contract MockVestingPlatform {
    using SafeERC20 for IERC20;

    struct Stream {
        address sender;
        address recipient;
        address token;
        uint256 amount;
        uint256 start;
        uint256 duration;
    }

    uint256 public streamCount;
    mapping(uint256 => Stream) public streams;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount
    );

    /// @notice Create a vesting stream, escrowing `amount` of `token` from the caller.
    function createStream(
        address recipient,
        address token,
        uint256 amount,
        uint256 start,
        uint256 duration
    ) external returns (uint256 streamId) {
        if (recipient == address(0) || token == address(0)) revert ZeroAddress();

        streamId = streamCount++;
        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            start: start,
            duration: duration
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit StreamCreated(streamId, msg.sender, recipient, token, amount);
    }
}
