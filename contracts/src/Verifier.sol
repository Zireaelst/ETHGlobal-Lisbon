// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Dual-sig verification: Bob's Tapp seal-key sig (binding) + Alice's EIP-712 intent sig.
/// See CLAUDE.md §3.5 for the required logic. Stub — implemented in Phase 3.
contract Verifier {
    mapping(string => address) public enclaveSignerOf;
    address public owner;

    event JobVerified(bytes32 intentHash, bytes32 outputHash);

    constructor() {
        owner = msg.sender;
    }

    function setEnclaveSigner(string calldata agentId, address signer) external {
        require(msg.sender == owner, "not owner");
        enclaveSignerOf[agentId] = signer;
    }
}
