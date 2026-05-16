// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PaymentSplitter
 * @dev This contract allows to split Ether and ERC20 payments among a group of accounts. The sender does not need to be aware
 * that the funds will be split in this way, since it is handled transparently by the contract.
 *
 * The split can be in equal parts or in any other arbitrary proportion. The way this is specified is by assigning each
 * account to a number of shares. Of all the funds that this contract receives, each account will then be able to claim
 * an amount proportional to the percentage of total shares they were assigned.
 *
 * `PaymentSplitter` follows a _pull payment_ model. This means that payments are not automatically forwarded to the
 * accounts but kept in this contract, and the actual transfer is triggered as a separate step by calling the {release}
 * function.
 */
contract PaymentSplitter is Context, Ownable {
    event PayeeAdded(address indexed account, uint256 shares);
    event PayeeUpdated(address indexed account, uint256 shares);
    event PaymentReleased(address indexed to, uint256 amount);
    event ERC20PaymentReleased(address indexed token, address indexed to, uint256 amount);
    event PaymentReceived(address indexed from, uint256 amount);
    event BatchPaymentReleased(uint256 totalAmount, uint256 payeeCount);

    uint256 private _totalShares;
    uint256 private _totalReleased;

    mapping(address => uint256) private _shares;
    mapping(address => uint256) private _released;
    address[] private _payees;

    mapping(IERC20 => uint256) private _erc20TotalReleased;
    mapping(IERC20 => mapping(address => uint256)) private _erc20Released;

    /**
     * @dev Creates an instance of `PaymentSplitter` where each account in `payees` is assigned the number of shares at
     * the matching position in the `shares` array.
     *
     * All addresses in `payees` must be non-zero. Both arrays must have the same non-zero length, and there must be no
     * duplicates in `payees`.
     */
    constructor(address[] memory payees, uint256[] memory shares_) payable Ownable(msg.sender) {
        require(payees.length == shares_.length, "PaymentSplitter: payees and shares length mismatch");
        require(payees.length > 0, "PaymentSplitter: no payees");

        for (uint256 i = 0; i < payees.length; i++) {
            _addPayee(payees[i], shares_[i]);
        }
    }

    /**
     * @dev The Ether received will be logged with {PaymentReceived} events. Note that these events are not fully
     * reliable: it's possible for a contract to receive Ether without triggering this function. This only affects the
     * reliability of the events, and not the actual splitting of Ether.
     */
    receive() external payable virtual {
        emit PaymentReceived(_msgSender(), msg.value);
    }

    /**
     * @dev Getter for the total shares held by payees.
     */
    function totalShares() public view returns (uint256) {
        return _totalShares;
    }

    /**
     * @dev Getter for the total amount of Ether already released.
     */
    function totalReleased() public view returns (uint256) {
        return _totalReleased;
    }

    /**
     * @dev Getter for the total amount of `token` already released.
     */
    function totalReleased(IERC20 token) public view returns (uint256) {
        return _erc20TotalReleased[token];
    }

    /**
     * @dev Getter for the amount of shares held by an account.
     */
    function shares(address account) public view returns (uint256) {
        return _shares[account];
    }

    /**
     * @dev Getter for the amount of Ether already released to a payee.
     */
    function released(address account) public view returns (uint256) {
        return _released[account];
    }

    /**
     * @dev Getter for the amount of `token` already released to a payee.
     */
    function released(IERC20 token, address account) public view returns (uint256) {
        return _erc20Released[token][account];
    }

    /**
     * @dev Getter for the address of the payee number `index`.
     */
    function payee(uint256 index) public view returns (address) {
        return _payees[index];
    }

    /**
     * @dev Getter for the amount of payee's releasable Ether.
     */
    function releasable(address account) public view returns (uint256) {
        uint256 totalReceived = address(this).balance + totalReleased();
        return (totalReceived * _shares[account]) / _totalShares - _released[account];
    }

    /**
     * @dev Getter for the amount of payee's releasable `token`.
     */
    function releasable(IERC20 token, address account) public view returns (uint256) {
        uint256 totalReceived = token.balanceOf(address(this)) + totalReleased(token);
        return (totalReceived * _shares[account]) / _totalShares - released(token, account);
    }

    /**
     * @dev Triggers a transfer to `account` of the amount of Ether they are owed, according to their percentage of the
     * total shares and their previous withdrawals.
     */
    function release(address payable account) public virtual {
        require(_shares[account] > 0, "PaymentSplitter: account has no shares");

        uint256 payment = releasable(account);

        require(payment != 0, "PaymentSplitter: account is not due payment");

        _released[account] += payment;
        _totalReleased += payment;

        Address.sendValue(account, payment);
        emit PaymentReleased(account, payment);
    }

    /**
     * @dev Triggers a transfer to `account` of the amount of `token` they are owed, according to their percentage of the
     * total shares and their previous withdrawals.
     */
    function release(IERC20 token, address account) public virtual {
        require(_shares[account] > 0, "PaymentSplitter: account has no shares");

        uint256 payment = releasable(token, account);

        require(payment != 0, "PaymentSplitter: account is not due payment");

        _erc20Released[token][account] += payment;
        _erc20TotalReleased[token] += payment;

        SafeERC20.safeTransfer(token, account, payment);
        emit ERC20PaymentReleased(address(token), account, payment);
    }

    /**
     * @dev Add a new payee to the contract.
     * @param account The address of the payee to add.
     * @param shares_ The number of shares owned by the payee.
     */
    function _addPayee(address account, uint256 shares_) private {
        require(account != address(0), "PaymentSplitter: account is the zero address");
        require(shares_ > 0, "PaymentSplitter: shares are 0");
        require(_shares[account] == 0, "PaymentSplitter: account already has shares");

        _payees.push(account);
        _shares[account] = shares_;
        _totalShares = _totalShares + shares_;
        emit PayeeAdded(account, shares_);
    }

    /**
     * @dev Release payments to all payees at once
     * @notice Useful for automated CRON jobs
     */
    function releaseAll() external {
        uint256 batchTotalReleased = 0;
        uint256 batchPayeeCount = 0;
        uint256 payeesLength = _payees.length;
        
        for (uint256 i = 0; i < payeesLength; i++) {
            address payable currentPayee = payable(_payees[i]);
            uint256 payment = releasable(currentPayee);
            
            if (payment > 0) {
                _released[currentPayee] += payment;
                _totalReleased += payment;
                batchTotalReleased += payment;
                batchPayeeCount++;
                
                Address.sendValue(currentPayee, payment);
                emit PaymentReleased(currentPayee, payment);
            }
        }
        
        if (batchTotalReleased > 0) {
            emit BatchPaymentReleased(batchTotalReleased, batchPayeeCount);
        }
    }

    /**
     * @dev Release ERC20 payments to all payees at once
     * @param token The ERC20 token to release
     */
    function releaseAll(IERC20 token) external {
        uint256 batchTotalReleased = 0;
        uint256 batchPayeeCount = 0;
        uint256 payeesLength = _payees.length;
        
        for (uint256 i = 0; i < payeesLength; i++) {
            address currentPayee = _payees[i];
            uint256 payment = releasable(token, currentPayee);
            
            if (payment > 0) {
                _erc20Released[token][currentPayee] += payment;
                _erc20TotalReleased[token] += payment;
                batchTotalReleased += payment;
                batchPayeeCount++;
                
                SafeERC20.safeTransfer(token, currentPayee, payment);
                emit ERC20PaymentReleased(address(token), currentPayee, payment);
            }
        }
        
        if (batchTotalReleased > 0) {
            emit BatchPaymentReleased(batchTotalReleased, batchPayeeCount);
        }
    }

    /**
     * @dev Get all payees with pending ETH payments
     * @return Array of payee addresses with pending payments
     */
    function getPayeesWithPendingPayments() external view returns (address[] memory) {
        uint256 payeesLength = _payees.length;
        address[] memory pending = new address[](payeesLength);
        uint256 count = 0;
        
        for (uint256 i = 0; i < payeesLength; i++) {
            if (releasable(_payees[i]) > 0) {
                pending[count] = _payees[i];
                count++;
            }
        }
        
        // Resize array
        address[] memory result = new address[](count);
        for (uint256 j = 0; j < count; j++) {
            result[j] = pending[j];
        }
        return result;
    }

    /**
     * @dev Get all payees with pending ERC20 payments
     * @param token The ERC20 token to check
     * @return Array of payee addresses with pending payments
     */
    function getPayeesWithPendingPayments(IERC20 token) external view returns (address[] memory) {
        uint256 payeesLength = _payees.length;
        address[] memory pending = new address[](payeesLength);
        uint256 count = 0;
        
        for (uint256 i = 0; i < payeesLength; i++) {
            if (releasable(token, _payees[i]) > 0) {
                pending[count] = _payees[i];
                count++;
            }
        }
        
        // Resize array
        address[] memory result = new address[](count);
        for (uint256 j = 0; j < count; j++) {
            result[j] = pending[j];
        }
        return result;
    }

    /**
     * @dev Get total pending ETH payments across all payees
     * @return Total amount of ETH pending distribution
     */
    function totalPendingPayments() external view returns (uint256) {
        uint256 total = 0;
        uint256 payeesLength = _payees.length;
        for (uint256 i = 0; i < payeesLength; i++) {
            total += releasable(_payees[i]);
        }
        return total;
    }

    /**
     * @dev Get total pending ERC20 payments across all payees
     * @param token The ERC20 token to check
     * @return Total amount of tokens pending distribution
     */
    function totalPendingPayments(IERC20 token) external view returns (uint256) {
        uint256 total = 0;
        uint256 payeesLength = _payees.length;
        for (uint256 i = 0; i < payeesLength; i++) {
            total += releasable(token, _payees[i]);
        }
        return total;
    }

    /**
     * @dev Get all payees and their shares
     * @return payees Array of payee addresses
     * @return shares_ Array of corresponding shares
     */
    function getAllPayees() external view returns (address[] memory payees, uint256[] memory shares_) {
        payees = new address[](_payees.length);
        shares_ = new uint256[](_payees.length);
        
        uint256 payeesLength = _payees.length;
        for (uint256 i = 0; i < payeesLength; i++) {
            payees[i] = _payees[i];
            shares_[i] = _shares[_payees[i]];
        }
        
        return (payees, shares_);
    }

    /**
     * @dev Get the number of payees
     * @return The total number of payees
     */
    function payeeCount() external view returns (uint256) {
        return _payees.length;
    }

    /**
     * @dev Add a new payee to the contract (only owner)
     * @param account The address of the payee to add
     * @param shares_ The number of shares owned by the payee
     */
    function addPayee(address account, uint256 shares_) external onlyOwner {
        _addPayee(account, shares_);
    }

    /**
     * @dev Update payee shares (only owner)
     * @param account The address of the payee to update
     * @param newShares The new number of shares
     */
    function updatePayeeShares(address account, uint256 newShares) external onlyOwner {
        require(_shares[account] > 0, "PaymentSplitter: account has no shares");
        require(newShares > 0, "PaymentSplitter: shares are 0");
        
        _totalShares = _totalShares - _shares[account] + newShares;
        _shares[account] = newShares;
        
        emit PayeeUpdated(account, newShares);
    }
}
