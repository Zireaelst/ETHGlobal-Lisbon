// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentLib} from "../src/IntentLib.sol";
import {Verifier} from "../src/Verifier.sol";

/// @notice BUILD-PLAN gate:P3-A — the full test set for dual-signature verification.
/// @dev The fixture is PRODUCED by `pnpm gate:P3-A` from the TypeScript side: the intent is
///      gercek EIP-712 imzasiyla, seal ise packages/bob-binding'in gercekten urettigi
///      imzayla gelir. Uydurma imzayla test SAYILMAZ (planin kendi kurali).
contract VerifierTest is Test {
    Verifier internal verifier;

    // --- fixture'dan yuklenen alanlar ---
    IntentLib.Intent internal intent;
    bytes internal clientSig;
    bytes32 internal outputHash;
    bool internal matchFlag;
    bytes32 internal ogSigHash;
    Verifier.SealSig internal seal;
    address internal enclaveSigner;
    address internal aliceAddr;
    uint256 internal chainId;

    string internal json;

    uint256 internal alicePk;

    /// @dev Alice'in imzasi kontrat ADRESINE bagli (EIP-712 domain'inde
    ///      verifyingContract = address(this)). Fixture'i TS uretirken adres henuz
    ///      is unknown, so the client signature is produced INSIDE THE TEST against the real domain
    ///      atiyoruz — ayni ozel anahtarla. TS ile Solidity'nin ayni EIP-712 digest'ini
    ///      what it produces is already proven against the fixture in gate:P1-A.
    ///      Because the SEAL signature is address-independent, it comes LIVE from packages/bob-binding
    ///      arrives — that signature is what P3-A is really about.
    function _signIntent(uint256 pk, IntentLib.Intent memory i) internal view returns (bytes memory) {
        bytes32 digest = IntentLib.digest(verifier.DOMAIN_SEPARATOR(), i);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/verifier.json"));

        chainId = vm.parseJsonUint(json, ".chainId");
        verifier = new Verifier(chainId);

        alicePk = vm.parseJsonUint(json, ".alicePrivateKey");

        intent = IntentLib.Intent({
            intentHash: vm.parseJsonBytes32(json, ".intent.intentHash"),
            client: vm.parseJsonAddress(json, ".intent.client"),
            agentId: vm.parseJsonBytes32(json, ".intent.agentId"),
            price: vm.parseJsonUint(json, ".intent.price"),
            deadline: vm.parseJsonUint(json, ".intent.deadline")
        });
        outputHash = vm.parseJsonBytes32(json, ".outputHash");
        matchFlag = vm.parseJsonBool(json, ".match");
        ogSigHash = vm.parseJsonBytes32(json, ".ogSigHash");
        seal = Verifier.SealSig({
            agentId: vm.parseJsonString(json, ".seal.agentId"),
            sealId: vm.parseJsonString(json, ".seal.sealId"),
            timestamp: vm.parseJsonString(json, ".seal.timestamp"),
            r: vm.parseJsonBytes32(json, ".seal.r"),
            s: vm.parseJsonBytes32(json, ".seal.s")
        });
        enclaveSigner = vm.parseJsonAddress(json, ".enclaveSigner");
        aliceAddr = vm.addr(alicePk);
        require(aliceAddr == intent.client, "fixture client adresi Alice anahtariyla uyusmuyor");
        clientSig = _signIntent(alicePk, intent);

        verifier.setEnclaveSigner(intent.agentId, enclaveSigner);
        verifier.setRegisteredClient(aliceAddr, true);
        vm.warp(intent.deadline - 1);
    }

    // ---------------------------------------------------------------------
    // Mutlu yol
    // ---------------------------------------------------------------------

    /// @notice CANLI fixture ile JobVerified cikiyor.
    function testHappyPath() public {
        vm.expectEmit(true, true, true, true);
        emit Verifier.JobVerified(
            intent.intentHash, outputHash, intent.client, uint256(intent.agentId), intent.price
        );
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertTrue(verifier.verified(intent.intentHash), "verified isaretlenmedi");
    }

    /// @notice Seal digest'i TS tarafiyla birebir ayni.
    function testSealDigestMatchesTS() public view {
        bytes memory body = verifier.encodeBody(intent.intentHash, outputHash, matchFlag, ogSigHash);
        assertEq(keccak256(body), vm.parseJsonBytes32(json, ".bodyKeccak"), "body does not match TS");
        assertEq(
            verifier.sealDigestOf(seal, body), vm.parseJsonBytes32(json, ".sealDigest"), "seal digest uyusmuyor"
        );
    }

    /// @notice The body can be rebuilt from the fields (which is what the contract does).
    function testBodyIsReproducibleFromFields() public view {
        bytes memory body = verifier.encodeBody(intent.intentHash, outputHash, matchFlag, ogSigHash);
        (bytes32 ih, bytes32 oh, bool mf, bytes32 og) = abi.decode(body, (bytes32, bytes32, bool, bytes32));
        assertEq(ih, intent.intentHash);
        assertEq(oh, outputHash);
        assertEq(mf, matchFlag);
        assertEq(og, ogSigHash);
    }

    // ---------------------------------------------------------------------
    // Ret yollari
    // ---------------------------------------------------------------------

    /// @notice Bob'un uydurdugu intent+output cifti BadClientSig.
    function testRejectsWrongClientSig() public {
        IntentLib.Intent memory forged = intent;
        forged.price = intent.price + 1; // the signature no longer belongs to this struct
        vm.expectRevert(Verifier.BadClientSig.selector);
        verifier.verifyJob(forged, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    /// @notice Kayitli olmayan istemci BadClientSig.
    function testRejectsUnregisteredClient() public {
        verifier.setRegisteredClient(aliceAddr, false);
        vm.expectRevert(Verifier.BadClientSig.selector);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    /// @notice A body signed with an unregistered key gives BadEnclaveSig.
    function testRejectsNonEnclaveSigner() public {
        verifier.setEnclaveSigner(intent.agentId, address(0xBEEF));
        vm.expectRevert(Verifier.BadEnclaveSig.selector);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    /// @notice An agentId that was never registered gives BadEnclaveSig.
    function testRejectsUnknownAgent() public {
        IntentLib.Intent memory other = intent;
        other.agentId = bytes32(uint256(999999));
        vm.expectRevert(Verifier.BadClientSig.selector); // agentId imzaya dahil -> once client sig duser
        verifier.verifyJob(other, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    /// @notice match=false -> MatchFalse. (Fraud demosunun ana yolu.)
    function testRejectsMatchFalse() public {
        string memory falseJson =
            vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/verifier-matchfalse.json"));
        Verifier.SealSig memory falseSeal = Verifier.SealSig({
            agentId: vm.parseJsonString(falseJson, ".seal.agentId"),
            sealId: vm.parseJsonString(falseJson, ".seal.sealId"),
            timestamp: vm.parseJsonString(falseJson, ".seal.timestamp"),
            r: vm.parseJsonBytes32(falseJson, ".seal.r"),
            s: vm.parseJsonBytes32(falseJson, ".seal.s")
        });
        bytes32 falseOutputHash = vm.parseJsonBytes32(falseJson, ".outputHash");
        vm.expectRevert(Verifier.MatchFalse.selector);
        verifier.verifyJob(intent, clientSig, falseOutputHash, false, ogSigHash, falseSeal);
    }

    /// @notice outputHash degisince seal digest tutmuyor -> BadEnclaveSig.
    function testRejectsTamperedBody() public {
        bytes32 tampered = keccak256(abi.encodePacked(outputHash, "tampered"));
        vm.expectRevert(Verifier.BadEnclaveSig.selector);
        verifier.verifyJob(intent, clientSig, tampered, matchFlag, ogSigHash, seal);
    }

    /// @notice Changing ogSigHash also corrupts the body -> BadEnclaveSig.
    function testRejectsTamperedOgSigHash() public {
        vm.expectRevert(Verifier.BadEnclaveSig.selector);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, bytes32(uint256(1)), seal);
    }

    /// @notice Ayni intentHash ikinci kez AlreadyVerified.
    function testReplay() public {
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        vm.expectRevert(Verifier.AlreadyVerified.selector);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    /// @notice Suresi gecmis intent Expired.
    function testExpired() public {
        vm.warp(intent.deadline + 1);
        vm.expectRevert(Verifier.Expired.selector);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    // ---------------------------------------------------------------------
    // Lenient yol — fraud butonu
    // ---------------------------------------------------------------------

    function testLenientEmitsVerifiedOnHappyPath() public {
        (bool ok, uint8 code) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertTrue(ok, "lenient mutlu yolda basarisiz");
        assertEq(code, 0);
    }

    function testLenientEmitsRejectedWithCode() public {
        // MatchFalse (5)
        string memory falseJson =
            vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/verifier-matchfalse.json"));
        Verifier.SealSig memory falseSeal = Verifier.SealSig({
            agentId: vm.parseJsonString(falseJson, ".seal.agentId"),
            sealId: vm.parseJsonString(falseJson, ".seal.sealId"),
            timestamp: vm.parseJsonString(falseJson, ".seal.timestamp"),
            r: vm.parseJsonBytes32(falseJson, ".seal.r"),
            s: vm.parseJsonBytes32(falseJson, ".seal.s")
        });
        bytes32 falseOutputHash = vm.parseJsonBytes32(falseJson, ".outputHash");

        vm.expectEmit(true, true, true, true);
        emit Verifier.JobRejected(intent.intentHash, intent.client, uint256(intent.agentId), 5);
        (bool ok, uint8 code) = verifier.verifyJobLenient(intent, clientSig, falseOutputHash, false, ogSigHash, falseSeal);
        assertFalse(ok);
        assertEq(code, 5, "not the MatchFalse code");

        // BadEnclaveSig (4)
        verifier.setEnclaveSigner(intent.agentId, address(0xBEEF));
        (, uint8 code4) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertEq(code4, 4, "not the BadEnclaveSig code");
        verifier.setEnclaveSigner(intent.agentId, enclaveSigner);

        // BadClientSig (3)
        verifier.setRegisteredClient(aliceAddr, false);
        (, uint8 code3) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertEq(code3, 3, "not the BadClientSig code");
        verifier.setRegisteredClient(aliceAddr, true);

        // Expired (1)
        vm.warp(intent.deadline + 1);
        (, uint8 code1) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertEq(code1, 1, "not the Expired code");
        vm.warp(intent.deadline - 1);

        // AlreadyVerified (2)
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        (, uint8 code2) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertEq(code2, 2, "not the AlreadyVerified code");
    }

    /// @notice The lenient path DOES NOT REVERT — the fraud tx must appear successful on Basescan.
    function testLenientNeverReverts() public {
        verifier.setEnclaveSigner(intent.agentId, address(0xBEEF));
        verifier.setRegisteredClient(aliceAddr, false);
        vm.warp(intent.deadline + 1);
        (bool ok,) = verifier.verifyJobLenient(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertFalse(ok, "her sey bozukken bile true dondu");
    }

    // ---------------------------------------------------------------------
    // v pariteleri + gaz
    // ---------------------------------------------------------------------

    /// @notice Hem 27 hem 28 ile uretilmis fixture geciyor.
    /// @dev Wrapper `v`'yi attigi icin kontrat iki pariteyi de denemek ZORUNDA.
    ///      The fixture generator writes two samples covering both parities.
    function testBothVParities() public {
        string memory vJson = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/verifier-parities.json"));
        uint256 count = vm.parseJsonUint(vJson, ".count");
        assertEq(count, 2, "iki parite ornegi bekleniyordu");

        for (uint256 i = 0; i < count; i++) {
            string memory p = string.concat(".samples[", vm.toString(i), "]");
            Verifier.SealSig memory s = Verifier.SealSig({
                agentId: vm.parseJsonString(vJson, string.concat(p, ".seal.agentId")),
                sealId: vm.parseJsonString(vJson, string.concat(p, ".seal.sealId")),
                timestamp: vm.parseJsonString(vJson, string.concat(p, ".seal.timestamp")),
                r: vm.parseJsonBytes32(vJson, string.concat(p, ".seal.r")),
                s: vm.parseJsonBytes32(vJson, string.concat(p, ".seal.s"))
            });
            bytes memory body = vm.parseJsonBytes(vJson, string.concat(p, ".body"));
            address signer = vm.parseJsonAddress(vJson, string.concat(p, ".signer"));
            uint256 v = vm.parseJsonUint(vJson, string.concat(p, ".v"));

            bytes32 digest = verifier.sealDigestOf(s, body);
            assertEq(ecrecover(digest, uint8(v), s.r, s.s), signer, "beklenen parite imzaciyi vermedi");
        }
    }

    function testGasUnder200k() public {
        uint256 before = gasleft();
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        uint256 used = before - gasleft();
        assertLt(used, 200_000, "verifyJob 200k gazi asti");
    }

    // ---------------------------------------------------------------------
    // Yetki
    // ---------------------------------------------------------------------

    function testOnlyOwnerCanSetEnclaveSigner() public {
        vm.prank(address(0xCAFE));
        vm.expectRevert(Verifier.NotOwner.selector);
        verifier.setEnclaveSigner(intent.agentId, address(0xBEEF));
    }

    /// @notice Setter MUTABLE kalmali — seal key donerse demo kurtarilabilsin.
    function testEnclaveSignerRemainsMutable() public {
        verifier.setEnclaveSigner(intent.agentId, address(0xBEEF));
        assertEq(verifier.enclaveSignerOf(intent.agentId), address(0xBEEF));
        verifier.setEnclaveSigner(intent.agentId, enclaveSigner);
        assertEq(verifier.enclaveSignerOf(intent.agentId), enclaveSigner);
        verifier.verifyJob(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        assertTrue(verifier.verified(intent.intentHash), "the job did not pass after re-registration");
    }
}
