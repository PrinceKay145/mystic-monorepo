// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

// Simplified mock of stPlumeMinter to demonstrate the vulnerability
contract MockStPlumeMinter {
    uint256 public withHoldEth = 0;
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    // Vulnerable withdrawFee function - doesn't check ETH transfer result
    function withdrawFee() external returns (uint256 amount) {
        amount = withHoldEth;
        (bool success, ) = address(owner).call{value: withHoldEth}("");  // Vulnerable line
        // No check on 'success'
        withHoldEth = 0;  // State is updated regardless of transfer success
        return amount;
    }
    
    // For testing - add ETH to withHoldEth
    function addWithholdEth() external payable {
        withHoldEth += msg.value;
    }
    
    // Fixed version - properly checks return value
    function withdrawFee_fixed() external returns (uint256 amount) {
        amount = withHoldEth;
        (bool success, ) = address(owner).call{value: withHoldEth}("");
        require(success, "ETH transfer failed");  // Proper check
        withHoldEth = 0;
        return amount;
    }
    
    // Makes contract payable
    receive() external payable {}
}

// Contract that rejects ETH transfers
contract EthRejecter {
    // Fallback function that explicitly reverts on ETH transfers
    receive() external payable {
        revert("I reject ETH");
    }
    
    // Function to check if this contract is working
    function testReject() external payable {
        require(false, "Should always revert");
    }
}

contract UncheckedEthTransferTest is Test {
    MockStPlumeMinter public minter;
    EthRejecter public rejecter;
    
    function setUp() public {
        minter = new MockStPlumeMinter();
        rejecter = new EthRejecter();
        
        // Fund the minter contract with ETH
        vm.deal(address(minter), 10 ether);
        
        // Add ETH to withHoldEth
        minter.addWithholdEth{value: 5 ether}();
    }
    
    function testUncheckedEthTransferVulnerability() public {
        // Verify the rejecter actually rejects ETH
        vm.expectRevert();
        (bool success, ) = address(rejecter).call{value: 1 ether}("");
        require(!success, "Rejecter should reject ETH");
        
        // Record the withHoldEth and contract balance before
        uint256 withHoldEthBefore = minter.withHoldEth();
        uint256 balanceBefore = address(minter).balance;
        
        // Set owner to the rejecting contract
        vm.store(
            address(minter),
            bytes32(uint256(1)), // Owner is in slot 1
            bytes32(uint256(uint160(address(rejecter))))
        );
        
        // Verify owner change
        assertEq(minter.owner(), address(rejecter));
        
        // Call the vulnerable withdrawFee function
        // This call should succeed even though the ETH transfer fails
        minter.withdrawFee();
        
        // Verify the vulnerability:
        // 1. withHoldEth was zeroed out even though transfer failed
        assertEq(minter.withHoldEth(), 0, "withHoldEth should be zero after call");
        
        // 2. But the ETH is still in the contract
        assertEq(address(minter).balance, balanceBefore, "ETH should still be in the contract");
        
        console.log("VULNERABILITY CONFIRMED: ETH is stuck in the contract");
        console.log("withHoldEth before:", withHoldEthBefore);
        console.log("withHoldEth after:", minter.withHoldEth());
        console.log("Contract balance before:", balanceBefore);
        console.log("Contract balance after:", address(minter).balance);
        console.log("ETH permanently lost:", balanceBefore - address(minter).balance);
        
        // We should still have the same amount of ETH in the contract,
        // even though withHoldEth is 0, meaning we can't withdraw it anymore
        assertEq(address(minter).balance, balanceBefore);
        
        // Test the fixed version
        // First reset the minter for a clean test
        MockStPlumeMinter fixedMinter = new MockStPlumeMinter();
        vm.deal(address(fixedMinter), 10 ether);
        fixedMinter.addWithholdEth{value: 5 ether}();
        
        // Set owner to the rejecting contract
        vm.store(
            address(fixedMinter),
            bytes32(uint256(1)), // Owner is in slot 1
            bytes32(uint256(uint160(address(rejecter))))
        );
        
        // The fixed version should revert since the transfer fails
        vm.expectRevert();
        fixedMinter.withdrawFee_fixed();
        
        // withHoldEth should remain unchanged in the fixed version
        assertEq(fixedMinter.withHoldEth(), 5 ether, "withHoldEth should not change when transfer fails");
    }
}