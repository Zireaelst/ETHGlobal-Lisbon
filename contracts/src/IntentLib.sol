// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Alice'in intent taahhüdü + EIP-712 digest'i — TypeScript tarafıyla BİREBİR aynı.
/// @dev Referans: BUILD-PLAN §2.3 ve packages/shared/src/intent.ts.
///      `abi.encode` kullanılıyor, `abi.encodePacked` DEĞİL. Packed'e geçmek TS ile
///      sessiz uyuşmazlık üretir (BUILD-PLAN P1-A ⛔ notu).
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

    /// @notice §2.3'teki 5 alanlı taahhüt.
    /// @dev briefHash/dataHash/constraintsHash hazır gelir — kontrat JSON parse etmez.
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

    /// @notice Intent yapısının EIP-712 struct hash'i.
    function hashStruct(Intent memory intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH, intent.intentHash, intent.client, intent.agentId, intent.price, intent.deadline
            )
        );
    }

    /// @notice İmzalanan nihai digest: 0x1901 ‖ domainSeparator ‖ structHash.
    function digest(bytes32 separator, Intent memory intent) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", separator, hashStruct(intent)));
    }

    /// @notice Digest'ten imzacıyı kurtar.
    /// @dev İmza+intent çiftini Bob verse bile digest yapının KENDİ alanlarından
    ///      yeniden üretilir — bu, §2.3'ün "anchor the client signature" kuralı.
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
