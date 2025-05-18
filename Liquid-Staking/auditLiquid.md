# H-01: Unchecked ETH Transfers in `withdrawFee()` and `withdraw()` Functions

## Description

The `stPlumeMinter` contract contains two functions, `withdrawFee()` and `withdraw()`, that perform ETH transfers using low-level `call` operations without checking the return value. If these transfers fail, the contract will update state variables that track ETH balances, effectively losing track of funds that remain in the contract.

## Affected code

**In `withdrawFee()` function:**

```solidity
function withdrawFee() external nonReentrant onlyByOwnGov returns (uint256 amount) {
    _rebalance();
    address(owner).call{value: withHoldEth}("");  // No return value check
    amount = withHoldEth;
    withHoldEth = 0;
    return amount;
}
```

**In `withdraw()` function:**

```solidity
function withdraw(address recipient) external nonReentrant returns (uint256 amount) {
    _rebalance();
    WithdrawalRequest storage request = withdrawalRequests[msg.sender];
    uint256 totalWithdrawable = plumeStaking.amountWithdrawable() + currentWithheldETH;
    require(block.timestamp >= request.timestamp, "Cooldown not complete");
    require(totalWithdrawable > 0, "Withdrawal not available yet");

    amount = request.amount;
    uint256 withdrawn;
    request.amount = 0;
    request.timestamp = 0;

    if(amount > currentWithheldETH ){
        withdrawn = plumeStaking.withdraw();
        currentWithheldETH = 0;
    } else {
        withdrawn = amount;
        currentWithheldETH -= amount;
    }

    withdrawn = withdrawn>amount ? withdrawn :amount;
    uint256 withholdFee = amount * WITHHOLD_FEE / 10000;
    currentWithheldETH += withdrawn - amount ;
    uint256 cachedAmount = withdrawn>amount ? amount :withdrawn;
    amount -= withholdFee;
    withHoldEth += cachedAmount - amount;

    address(recipient).call{value: amount}("");  // No return value check
    emit Withdrawn(msg.sender, amount);
    return amount;
}
```

## Vulnerability details

**Likelihood: Medium**

- The vulnerability is triggered only if the recipient's address is a contract with a reverting fallback function or an account that cannot receive ETH.
- While less common, it's entirely possible for contracts to act as owners or for users to provide contract addresses as recipients.

**Impact: High**

- When the transfer fails, the contract will still update its state variables (`withHoldEth = 0` in `withdrawFee()` and complex accounting updates in `withdraw()`).
- This creates a permanent discrepancy between the contract's accounting state and its actual ETH balance.
- Funds become permanently trapped in the contract because the contract's state indicates they've been withdrawn.
- For `withdrawFee()`, it could affect all accumulated fees.
- For `withdraw()`, it affects user withdrawals, potentially locking user funds.

## Tools Used

Manual Review

## Recommended Mitigation Steps

Both functions should follow the checks-effects-interactions pattern and verify the success of ETH transfers:

1. For `withdrawFee()`:

```solidity
function withdrawFee() external nonReentrant onlyByOwnGov returns (uint256 amount) {
    _rebalance();
    amount = withHoldEth;
    withHoldEth = 0;  // Update state before interaction

    (bool success, ) = address(owner).call{value: amount}("");
    require(success, "ETH transfer failed");

    return amount;
}
```

2. For `withdraw()`:

```solidity
// Simplified version focusing on the transfer check
function withdraw(address recipient) external nonReentrant returns (uint256 amount) {
    // [existing code...]

    // Cache the final amount
    uint256 finalAmount = amount;

    // Perform ETH transfer and check success
    (bool success, ) = address(recipient).call{value: finalAmount}("");
    require(success, "ETH transfer failed");

    emit Withdrawn(msg.sender, finalAmount);
    return finalAmount;
}
```

## H-02: Unstaking Accounting Vulnerability Allows Withdrawing More ETH Than Entitled

### Description

The `stPlumeMinter` contract contains an accounting vulnerability in the `unstake` and `withdraw` functions. When users unstake their frxETH tokens, the contract may allow them to withdraw more ETH than their burned tokens represent if the underlying staking protocol returns more ETH than requested during unstaking operations. This creates an improper accounting situation where the contract may promise more ETH than it legitimately holds.

### Affected code

https://github.com/username/repo/blob/main/src/stPlumeMinter.sol#L90-L140 (unstake function)

```solidity
function unstake(uint256 amount) external nonReentrant returns (uint256 amountUnstaked) {
    _rebalance();
    frxETHToken.minter_burn_from(msg.sender, amount);
    require(withdrawalRequests[msg.sender].amount == 0, "Withdrawal already requested");
    uint256 cooldownTimestamp;

    // Check if we can cover this with withheld ETH
    if (currentWithheldETH >= amount) {
        amountUnstaked = amount;
        cooldownTimestamp = block.timestamp + 1 days;
    } else {
        uint256 remainingToUnstake = amount;
        amountUnstaked = 0;
        if (currentWithheldETH > 0) {
            amountUnstaked = currentWithheldETH;
            remainingToUnstake -= currentWithheldETH;
            currentWithheldETH = 0;
        }

        uint16 validatorId = 1;
        uint numVals = numValidators();
        while (remainingToUnstake > 0 && validatorId <= numVals) {
            (bool active, ,uint256 stakedAmount,) = plumeStaking.getValidatorStats(uint16(validatorId));

            if (active && stakedAmount > 0) {
                // Calculate how much to unstake from this validator
                uint256 unstakeFromValidator = remainingToUnstake > stakedAmount ? stakedAmount : remainingToUnstake;
                uint256 actualUnstaked = plumeStaking.unstake(validatorId, unstakeFromValidator);
                amountUnstaked += actualUnstaked;
                remainingToUnstake -= actualUnstaked;
                if (remainingToUnstake == 0) break;
            }
            validatorId++;
            require(validatorId <= 10, "Too many validators checked");
        }
        cooldownTimestamp = plumeStaking.cooldownEndDate();
    }
    require(amountUnstaked > 0, "No funds were unstaked");
    require(amountUnstaked >= amount, "Not enough funds unstaked");
    withdrawalRequests[msg.sender] = WithdrawalRequest({
        amount: amountUnstaked,
        timestamp: cooldownTimestamp
    });

    emit Unstaked(msg.sender, amountUnstaked);
    return amountUnstaked;
}
```

https://github.com/username/repo/blob/main/src/stPlumeMinter.sol#L172-L201 (withdraw function)

```solidity
function withdraw(address recipient) external nonReentrant returns (uint256 amount) {
    _rebalance();
    WithdrawalRequest storage request = withdrawalRequests[msg.sender];
    uint256 totalWithdrawable = plumeStaking.amountWithdrawable() + currentWithheldETH;
    require(block.timestamp >= request.timestamp, "Cooldown not complete");
    require(totalWithdrawable > 0, "Withdrawal not available yet");

    amount = request.amount;
    uint256 withdrawn;
    request.amount = 0;
    request.timestamp = 0;

    if(amount > currentWithheldETH ){
        withdrawn = plumeStaking.withdraw();
        currentWithheldETH = 0;
    } else {
        withdrawn = amount;
        currentWithheldETH -= amount;
    }

    withdrawn = withdrawn>amount ? withdrawn :amount; //fees could be taken by staker contract so that less than requested amount is sent
    uint256 withholdFee = amount * WITHHOLD_FEE / 10000;
    currentWithheldETH += withdrawn - amount ; //keep the rest of the funds for the rest of users that might have unstaked to avoid gas loss to unstake, withdraw but fees are taken by staker too so recognize that
    uint256 cachedAmount = withdrawn>amount ? amount :withdrawn;
    amount -= withholdFee;
    withHoldEth += cachedAmount - amount;

    address(recipient).call{value: amount}(""); //send amount to user
    emit Withdrawn(msg.sender, amount);
    return amount;
}
```

### Vulnerability details

**Likelihood: Medium** - This vulnerability requires the `plumeStaking.unstake()` function to return more ETH than requested, which may happen naturally if validators have accumulated rewards.

**Impact: High** - Multiple users exploiting this vulnerability could drain excess ETH from the contract, potentially leading to insolvency where some users would be unable to withdraw their legitimately staked ETH.

The vulnerability stems from three interrelated issues:

1. In the `unstake` function, the amount recorded for withdrawal (`amountUnstaked`) can be greater than the amount of frxETH tokens burned (`amount`):

```solidity
// The function allows amountUnstaked > amount
require(amountUnstaked >= amount, "Not enough funds unstaked");
withdrawalRequests[msg.sender] = WithdrawalRequest({
    amount: amountUnstaked,  // Should be limited to 'amount'
    timestamp: cooldownTimestamp
});
```

2. The unstaking logic differs depending on whether there's enough withheld ETH:

   - If `currentWithheldETH >= amount`, exactly `amount` is recorded for withdrawal
   - Otherwise, the amount returned from validators is used, which could be more than requested

3. In the `withdraw` function, users can withdraw the full `amountUnstaked` recorded from their unstaking request, even if it exceeds their burned frxETH tokens.

Example exploitation scenario:

1. User burns 10 frxETH tokens in `unstake(10)`
2. Due to accumulated rewards, validators return 11 ETH when only 10 was requested
3. The user's withdrawal request is recorded as 11 ETH
4. The user withdraws 11 ETH (minus fees), gaining 1 ETH more than their burned tokens represent
5. If many users exploit this, the contract will eventually have insufficient ETH to cover all legitimate withdrawals

### Tools Used

Manual Review

### Recommended Mitigation Steps

1. Modify the `unstake` function to limit the withdrawal request to the amount of frxETH tokens burned, adding any excess to `currentWithheldETH`:

```solidity
// Calculate the unstaked amount as before
// ...

// Handle excess unstaked amount
if (amountUnstaked > amount) {
    uint256 excessAmount = amountUnstaked - amount;
    currentWithheldETH += excessAmount;
    amountUnstaked = amount; // Limit to the amount of tokens burned
}

// Record withdrawal request based on burned token amount
withdrawalRequests[msg.sender] = WithdrawalRequest({
    amount: amount,
    timestamp: cooldownTimestamp
});
```

2. Ensure the `withdraw` function handles fees consistently and maintains proper accounting:

```solidity
// In withdraw function
amount = request.amount;
request.amount = 0;
request.timestamp = 0;

// Calculate fee
uint256 feeAmount = amount * WITHHOLD_FEE / 10000;
uint256 amountAfterFee = amount - feeAmount;
withHoldEth += feeAmount;

// Process withdrawal
// ...

address(recipient).call{value: amountAfterFee}("");
emit Withdrawn(msg.sender, amountAfterFee);
return amountAfterFee;
```

These changes ensure that users can only withdraw ETH equivalent to the frxETH they burned, maintaining proper accounting in the system.
