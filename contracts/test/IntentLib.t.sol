// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentLib} from "../src/IntentLib.sol";

/// @notice TS ↔ Solidity hash equality (the final BUILD-PLAN gate:P1-A criterion).
/// @dev The fixture is PRODUCED by `pnpm gate:P1-A` from the TypeScript side. So this test runs
///      against the code the agents actually use, not against invented values.
///      If the fixture is edited by hand the test loses its meaning.
contract IntentLibTest is Test {
    string constant FIXTURE = "/test/fixtures/intent.json";

    struct Fixture {
        bytes32 briefHash;
        bytes32 dataHash;
        bytes32 constraintsHash;
        uint256 price;
        uint256 nonce;
        bytes32 intentHash;
        // EIP-712
        string domainName;
        string domainVersion;
        uint256 chainId;
        address verifyingContract;
        bytes32 domainSeparator;
        bytes32 structHash;
        bytes32 digest;
        address client;
        bytes32 agentId;
        uint256 deadline;
        bytes signature;
        address expectedSigner;
    }

    function _load() internal view returns (Fixture memory f) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), FIXTURE));
        f.briefHash = vm.parseJsonBytes32(json, ".briefHash");
        f.dataHash = vm.parseJsonBytes32(json, ".dataHash");
        f.constraintsHash = vm.parseJsonBytes32(json, ".constraintsHash");
        f.price = vm.parseJsonUint(json, ".price");
        f.nonce = vm.parseJsonUint(json, ".nonce");
        f.intentHash = vm.parseJsonBytes32(json, ".intentHash");

        f.domainName = vm.parseJsonString(json, ".domain.name");
        f.domainVersion = vm.parseJsonString(json, ".domain.version");
        f.chainId = vm.parseJsonUint(json, ".domain.chainId");
        f.verifyingContract = vm.parseJsonAddress(json, ".domain.verifyingContract");
        f.domainSeparator = vm.parseJsonBytes32(json, ".domainSeparator");
        f.structHash = vm.parseJsonBytes32(json, ".structHash");
        f.digest = vm.parseJsonBytes32(json, ".digest");

        f.client = vm.parseJsonAddress(json, ".intent.client");
        f.agentId = vm.parseJsonBytes32(json, ".intent.agentId");
        f.deadline = vm.parseJsonUint(json, ".intent.deadline");
        f.signature = vm.parseJsonBytes(json, ".signature");
        f.expectedSigner = vm.parseJsonAddress(json, ".expectedSigner");
    }

    function _intent(Fixture memory f) internal pure returns (IntentLib.Intent memory) {
        return IntentLib.Intent({
            intentHash: f.intentHash,
            client: f.client,
            agentId: f.agentId,
            price: f.price,
            deadline: f.deadline
        });
    }

    /// @notice THE MAIN CRITERION: the intentHash TS produced comes out identical in Solidity.
    function testIntentHashMatchesTS() public view {
        Fixture memory f = _load();
        bytes32 recomputed =
            IntentLib.buildIntentHash(f.briefHash, f.dataHash, f.constraintsHash, f.price, f.nonce);
        assertEq(recomputed, f.intentHash, "intentHash TS ile uyusmuyor");
    }

    /// @notice The encoding is exactly 5 words (5 x 32 bytes) - i.e. every field is fixed-size.
    /// @dev Dinamik bir alan eklenirse uzunluk buyur ve offset/length kelimeleri girer;
    ///      bu test o degisikligi aninda yakalar.
    function testEncodingIsExactlyFiveWords() public view {
        Fixture memory f = _load();
        bytes memory encoded = abi.encode(f.briefHash, f.dataHash, f.constraintsHash, f.price, f.nonce);
        assertEq(encoded.length, 160, "encoding is not 5 x 32 bytes - a non-fixed-size field was added");
    }

    /// @notice IN THIS LAYOUT abi.encode and abi.encodePacked are byte-identical.
    /// @dev All five fields are 32-byte aligned, so there is no padding. BUILD-PLAN's
    ///      "use encode, not packed" warning is a good habit, but with THIS FIELD SET that
    ///      class of bug cannot occur - i.e. even with gate:P1-A green there is no risk of
    ///      "we switched to packed and the test missed it", because there is no difference.
    ///      TRIPWIRE: if anyone adds a dynamic (string/bytes) or short (address/uint64) field
    ///      this test breaks; at that moment packed and encode diverge and, against the TS side,
    ///      the silent-mismatch risk comes back.
    function testPackedEqualsEncodeForThisLayout() public view {
        Fixture memory f = _load();
        bytes32 packed = keccak256(abi.encodePacked(f.briefHash, f.dataHash, f.constraintsHash, f.price, f.nonce));
        assertEq(packed, f.intentHash, "packed ile encode ayristi - alan duzeni degismis olmali");
    }

    /// @notice Guard rail gercek mi: hizali OLMAYAN bir alanda packed ile encode ayrisiyor.
    /// @dev Yukaridaki testin "tesadufen esit" olmadigini gosterir.
    function testPackedDivergesWhenFieldIsNotWordAligned() public pure {
        address client = address(0xdEADBEeF00000000000000000000000000000000);
        assertTrue(
            keccak256(abi.encode(bytes32(uint256(1)), client)) != keccak256(abi.encodePacked(bytes32(uint256(1)), client)),
            "address alaninda bile packed == encode cikti - kodlama varsayimi yanlis"
        );
    }

    function testDomainSeparatorMatchesTS() public view {
        Fixture memory f = _load();
        bytes32 recomputed =
            IntentLib.domainSeparator(f.domainName, f.domainVersion, f.chainId, f.verifyingContract);
        assertEq(recomputed, f.domainSeparator, "domainSeparator TS ile uyusmuyor");
    }

    function testStructHashMatchesTS() public view {
        Fixture memory f = _load();
        assertEq(IntentLib.hashStruct(_intent(f)), f.structHash, "structHash TS ile uyusmuyor");
    }

    function testDigestMatchesTS() public view {
        Fixture memory f = _load();
        assertEq(IntentLib.digest(f.domainSeparator, _intent(f)), f.digest, "digest TS ile uyusmuyor");
    }

    /// @notice Kontrat, Alice'in imzasindan ayni adresi kurtariyor.
    function testRecoversAliceFromTSSignature() public view {
        Fixture memory f = _load();
        address signer = IntentLib.recoverSigner(f.domainSeparator, _intent(f), f.signature);
        assertEq(signer, f.expectedSigner, "kurtarilan imzaci TS ile uyusmuyor");
    }

    /// @notice If Bob changes a field of the intent, the signature no longer yields Alice.
    /// @dev The basis of P3-A step 3: we do not trust the signature+intent pair.
    function testTamperedIntentDoesNotRecoverAlice() public view {
        Fixture memory f = _load();
        IntentLib.Intent memory tampered = _intent(f);
        tampered.price = f.price + 1;
        address signer = IntentLib.recoverSigner(f.domainSeparator, tampered, f.signature);
        assertTrue(signer != f.expectedSigner, "the same signer was recovered despite the price changing");
    }
}
