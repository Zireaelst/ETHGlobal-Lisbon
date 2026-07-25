// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentLib} from "../src/IntentLib.sol";

/// @notice TS ↔ Solidity hash eşitliği (BUILD-PLAN gate:P1-A son kriteri).
/// @dev Fixture'ı `pnpm gate:P1-A` TypeScript tarafından ÜRETİR. Yani bu test
///      uydurma değerlere değil, agent'ların gerçekten kullanacağı koda karşı koşar.
///      Fixture elle düzenlenirse test anlamını kaybeder.
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

    /// @notice ANA KRİTER: TS'in ürettiği intentHash Solidity'de birebir çıkıyor.
    function testIntentHashMatchesTS() public view {
        Fixture memory f = _load();
        bytes32 recomputed =
            IntentLib.buildIntentHash(f.briefHash, f.dataHash, f.constraintsHash, f.price, f.nonce);
        assertEq(recomputed, f.intentHash, "intentHash TS ile uyusmuyor");
    }

    /// @notice Kodlama tam olarak 5 kelime (5 x 32 byte) - yani her alan sabit boyutlu.
    /// @dev Dinamik bir alan eklenirse uzunluk buyur ve offset/length kelimeleri girer;
    ///      bu test o degisikligi aninda yakalar.
    function testEncodingIsExactlyFiveWords() public view {
        Fixture memory f = _load();
        bytes memory encoded = abi.encode(f.briefHash, f.dataHash, f.constraintsHash, f.price, f.nonce);
        assertEq(encoded.length, 160, "kodlama 5 x 32 byte degil - sabit boyutlu olmayan alan eklenmis");
    }

    /// @notice BU duzende abi.encode ile abi.encodePacked byte-identik.
    /// @dev Bes alanin hepsi 32-byte hizali oldugu icin padding yok. BUILD-PLAN'in
    ///      "encode kullan, packed kullanma" uyarisi dogru bir aliskanlik ama bu ALAN
    ///      SETINDE o hata sinifi isleyemez - yani gate:P1-A yesilken bile "packed'e
    ///      gectik ama test yakalamadi" diye bir risk yok, cunku fark yok.
    ///      TRIPWIRE: biri dinamik (string/bytes) ya da kisa (address/uint64) bir alan
    ///      eklerse bu test kirilir; o an packed ile encode ayrisir ve TS tarafiyla
    ///      sessiz uyusmazlik riski geri doner.
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

    /// @notice Bob intent'in bir alanini degistirirse imza artik Alice'i vermez.
    /// @dev P3-A adim 3'un temeli: imza+intent ciftine guvenmiyoruz.
    function testTamperedIntentDoesNotRecoverAlice() public view {
        Fixture memory f = _load();
        IntentLib.Intent memory tampered = _intent(f);
        tampered.price = f.price + 1;
        address signer = IntentLib.recoverSigner(f.domainSeparator, tampered, f.signature);
        assertTrue(signer != f.expectedSigner, "fiyat degistigi halde ayni imzaci kurtarildi");
    }
}
