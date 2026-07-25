// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Alice's intent commitment + its EIP-712 digest — IDENTICAL to the TypeScript side.
/// @dev Referans: BUILD-PLAN §2.3 ve packages/shared/src/intent.ts.
///      It uses `abi.encode`, NOT `abi.encodePacked`. Switching to packed produces a silent
///      mismatch with TS (the BUILD-PLAN P1-A ⛔ note).
library IntentLib {
    /// @dev keccak256("Intent(bytes32 intentHash,address client,bytes32 agentId,uint256 price,uint256 deadline)")
    bytes32 internal constant INTENT_TYPEHASH =
        keccak256("Intent(bytes32 intentHash,address client,bytes32 agentId,uint256 price,uint256 deadline)");

    /// @dev keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    struct Intent {
        bytes32 intentHash;
        address client;
        bytes32 agentId;
        uint256 price;
        uint256 deadline;
    }

    /// @notice The 5-field commitment from §2.3.
    /// @dev briefHash/dataHash/constraintsHash arrive ready-made — the contract does not parse JSON.
    function buildIntentHash(
        bytes32 briefHash,
        bytes32 dataHash,
        bytes32 constraintsHash,
        uint256 price,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(briefHash, dataHash, constraintsHash, price, nonce));
    }

    function domainSeparator(string memory name, string memory version, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract
            )
        );
    }

    /// @notice The EIP-712 struct hash of the Intent.
    function hashStruct(Intent memory intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH, intent.intentHash, intent.client, intent.agentId, intent.price, intent.deadline
            )
        );
    }

    /// @notice The final signed digest: 0x1901 ‖ domainSeparator ‖ structHash.
    function digest(bytes32 separator, Intent memory intent) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", separator, hashStruct(intent)));
    }

    /// @notice Recover the signer from the digest.
    /// @dev Even if Bob supplies the signature+intent pair, the digest is rebuilt from the
    ///      struct's OWN fields — this is §2.3's "anchor the client signature" rule.
    function recoverSigner(bytes32 separator, Intent memory intent, bytes memory signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "IntentLib: sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest(separator, intent), v, r, s);
    }
}
