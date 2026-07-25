// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentLib} from "./IntentLib.sol";

/// @title Verifier — intent-bound verification
/// @notice Iki imzayi birlikte dogrular:
///           (A) Bob'un enclave seal imzasi  -> "bu ciktiyi olculmus kod uretti"
///           (B) Alice'in EIP-712 intent imzasi -> "bu is gercekten siparis edildi"
///         Ikisi birlikte tezi kuruyor: TEE'nin calistigini degil, DOGRU isin
///         calistigini kanitliyoruz.
///
/// @dev Durustluk siniri (CLAUDE.md §11): imzalari ON-CHAIN, attestation'i KURULUMDA
///      OFF-CHAIN dogruluyoruz. Kontrat, 0G Attestor'in seal key'i yalnizca olculmus
///      image'imizi calistiran gercek bir enclave'e verdigine GUVENIYOR. Ham on-chain
///      TDX quote dogrulamasi YOK.
contract Verifier {
    // ---------------------------------------------------------------------
    // Tipler
    // ---------------------------------------------------------------------

    /// @dev Seal imzasi `v` TASIMAZ: agent-wrapper imzayi 64-byte R‖S olarak
    ///      donduruyor ve `v`'yi atiyor (CLAUDE.md §3.1B). Kontrat 27 ve 28'i
    ///      kendisi deniyor — cagiranin pariteyi bilmesi gerekmiyor.
    struct SealSig {
        string agentId;
        string sealId;
        string timestamp;
        bytes32 r;
        bytes32 s;
    }

    // ---------------------------------------------------------------------
    // Durum
    // ---------------------------------------------------------------------

    address public owner;

    /// @notice agentId => enclave seal imzalayicisi.
    /// @dev Seal key konteyner omru basina uretiliyor; setter 36 saat MUTABLE kalir
    ///      (BUILD-PLAN P3-C kurtarma provasi). Bu bilincli bir merkezilik.
    mapping(bytes32 => address) public enclaveSignerOf;

    /// @notice Kayitli istemciler — Alice'in intent'i ancak buradaysa kabul edilir.
    mapping(address => bool) public registeredClient;

    /// @notice Tekrar oynatma korumasi.
    mapping(bytes32 => bool) public verified;

    // ---------------------------------------------------------------------
    // Event'ler
    // ---------------------------------------------------------------------

    /// @dev `agentId` BILEREK uint256: subgraph mapping'i `Agent.load(id.toString())`
    ///      ile eslesebilsin diye. bytes32 yayilsaydi mapping tarafinda
    ///      little-endian donusum gerekir ve yanlis yapilirsa Job kayitlari hicbir
    ///      Agent'a baglanmadan SESSIZCE bos kalirdi (subgraph/README.md Karar 2).
    event JobVerified(
        bytes32 indexed intentHash,
        bytes32 outputHash,
        address indexed client,
        uint256 indexed agentId,
        uint256 price
    );

    /// @dev Lenient yol revert etmek yerine bunu yayar: revert eden bir tx juriye
    ///      Basescan'de kotu gorunur ve subgraph onu indeksleyemez.
    event JobRejected(bytes32 indexed intentHash, address indexed client, uint256 indexed agentId, uint8 code);

    event EnclaveSignerSet(bytes32 indexed agentId, address signer);
    event ClientRegistered(address indexed client, bool allowed);

    // ---------------------------------------------------------------------
    // Hatalar + kodlar
    // ---------------------------------------------------------------------

    error NotOwner();
    error Expired();
    error AlreadyVerified();
    error BadClientSig();
    error BadEnclaveSig();
    error MatchFalse();

    /// @dev `JobRejected.code` degerleri. Katı yoldaki hatalarla BIREBIR ayni sirada;
    ///      demo dApp bu kodu okuyup hangi kontrolun dustugunu gosteriyor.
    uint8 internal constant CODE_OK = 0;
    uint8 internal constant CODE_EXPIRED = 1;
    uint8 internal constant CODE_ALREADY_VERIFIED = 2;
    uint8 internal constant CODE_BAD_CLIENT_SIG = 3;
    uint8 internal constant CODE_BAD_ENCLAVE_SIG = 4;
    uint8 internal constant CODE_MATCH_FALSE = 5;

    // ---------------------------------------------------------------------

    bytes32 public immutable DOMAIN_SEPARATOR;

    constructor(uint256 chainId) {
        owner = msg.sender;
        DOMAIN_SEPARATOR = IntentLib.domainSeparator("ConfidentialAgents", "1", chainId, address(this));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setEnclaveSigner(bytes32 agentId, address signer) external onlyOwner {
        enclaveSignerOf[agentId] = signer;
        emit EnclaveSignerSet(agentId, signer);
    }

    function setRegisteredClient(address client, bool allowed) external onlyOwner {
        registeredClient[client] = allowed;
        emit ClientRegistered(client, allowed);
    }

    // ---------------------------------------------------------------------
    // Dogrulama
    // ---------------------------------------------------------------------

    /// @notice Kati yol — settlement bunu kullanir. Basarisizsa REVERT eder.
    function verifyJob(
        IntentLib.Intent calldata intent,
        bytes calldata clientSig,
        bytes32 outputHash,
        bool matchFlag,
        bytes32 ogSigHash,
        SealSig calldata seal
    ) external {
        uint8 code = _check(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);

        if (code == CODE_EXPIRED) revert Expired();
        if (code == CODE_ALREADY_VERIFIED) revert AlreadyVerified();
        if (code == CODE_BAD_CLIENT_SIG) revert BadClientSig();
        if (code == CODE_BAD_ENCLAVE_SIG) revert BadEnclaveSig();
        if (code == CODE_MATCH_FALSE) revert MatchFalse();

        verified[intent.intentHash] = true;
        emit JobVerified(intent.intentHash, outputHash, intent.client, uint256(intent.agentId), intent.price);
    }

    /// @notice Musamahali yol — fraud butonu bunu cagirir. Revert ETMEZ, kodu yayar.
    /// @return ok dogrulama gecti mi
    /// @return code CODE_* sabitlerinden biri
    function verifyJobLenient(
        IntentLib.Intent calldata intent,
        bytes calldata clientSig,
        bytes32 outputHash,
        bool matchFlag,
        bytes32 ogSigHash,
        SealSig calldata seal
    ) external returns (bool ok, uint8 code) {
        code = _check(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
        if (code == CODE_OK) {
            verified[intent.intentHash] = true;
            emit JobVerified(intent.intentHash, outputHash, intent.client, uint256(intent.agentId), intent.price);
            return (true, CODE_OK);
        }
        emit JobRejected(intent.intentHash, intent.client, uint256(intent.agentId), code);
        return (false, code);
    }

    /// @notice Yan etkisiz on-izleme — dApp tx atmadan sonucu gosterebilsin diye.
    function previewJob(
        IntentLib.Intent calldata intent,
        bytes calldata clientSig,
        bytes32 outputHash,
        bool matchFlag,
        bytes32 ogSigHash,
        SealSig calldata seal
    ) external view returns (uint8 code) {
        return _check(intent, clientSig, outputHash, matchFlag, ogSigHash, seal);
    }

    // ---------------------------------------------------------------------
    // Ic mantik
    // ---------------------------------------------------------------------

    function _check(
        IntentLib.Intent calldata intent,
        bytes calldata clientSig,
        bytes32 outputHash,
        bool matchFlag,
        bytes32 ogSigHash,
        SealSig calldata seal
    ) internal view returns (uint8) {
        // 1. Suresi gecmis intent kabul edilmez.
        if (block.timestamp > intent.deadline) return CODE_EXPIRED;

        // 2. Tekrar oynatma.
        if (verified[intent.intentHash]) return CODE_ALREADY_VERIFIED;

        // 3. Alice'in imzasi — digest YAPININ KENDI ALANLARINDAN yeniden uretilir.
        //    Bob'un verdigi intent+imza ciftine guvenmiyoruz (BUILD-PLAN §2.3).
        address client = IntentLib.recoverSigner(DOMAIN_SEPARATOR, intent, clientSig);
        if (client == address(0) || client != intent.client) return CODE_BAD_CLIENT_SIG;
        if (!registeredClient[intent.client]) return CODE_BAD_CLIENT_SIG;

        // 4. Govdeyi ALANLARDAN yeniden uret — JSON parse yok, iddiaya guven yok.
        bytes memory body = abi.encode(intent.intentHash, outputHash, matchFlag, ogSigHash);

        // 5-6. Seal digest'i kur ve imzaciyi kurtar (v = 27, tutmazsa 28).
        address expected = enclaveSignerOf[intent.agentId];
        if (expected == address(0)) return CODE_BAD_ENCLAVE_SIG;
        if (!_sealSignedBy(seal, body, expected)) return CODE_BAD_ENCLAVE_SIG;

        // 7. Enclave match:false raporladiysa is siparis edilen is degildir.
        //    (Enclave yine de imzalar — reddi BURASI verir.)
        if (!matchFlag) return CODE_MATCH_FALSE;

        return CODE_OK;
    }

    /// @dev keccak256("agentId|sealId|timestamp|hex(sha256(body))"), EIP-191 ONEKI YOK.
    ///      Format kaynagi CLAUDE.md §3.1(B) ve packages/shared/src/sealsig.ts —
    ///      ikisi BIRLIKTE degistirilmeli.
    ///
    ///      ⚠️ hex kucuk harf ve 0x oneksiz VARSAYIMI su an dogrulanmis degil
    ///      (BUILD-PLAN U1, P0-C kapatacak). Degisirse burasi ve sealsig.ts.
    function _sealDigest(SealSig calldata seal, bytes memory body) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                seal.agentId, "|", seal.sealId, "|", seal.timestamp, "|", _toHexLower(sha256(body))
            )
        );
    }

    /// @dev `v` disaridan gelmiyor; wrapper onu attigi icin iki pariteyi de deniyoruz.
    function _sealSignedBy(SealSig calldata seal, bytes memory body, address expected)
        internal
        pure
        returns (bool)
    {
        bytes32 digest = _sealDigest(seal, body);
        // EIP-2 malleability: s degeri ust yariya duserse imza gecersiz sayilir.
        if (uint256(seal.s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return false;
        }
        if (ecrecover(digest, 27, seal.r, seal.s) == expected) return true;
        return ecrecover(digest, 28, seal.r, seal.s) == expected;
    }

    /// @dev bytes32 -> 64 karakterlik KUCUK HARF hex, `0x` oneki YOK.
    function _toHexLower(bytes32 value) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            out[i * 2] = alphabet[b >> 4];
            out[i * 2 + 1] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    // ---------------------------------------------------------------------
    // Gorunurluk yardimcilari (test + dApp)
    // ---------------------------------------------------------------------

    function sealDigestOf(SealSig calldata seal, bytes calldata body) external pure returns (bytes32) {
        return _sealDigest(seal, body);
    }

    function encodeBody(bytes32 intentHash, bytes32 outputHash, bool matchFlag, bytes32 ogSigHash)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(intentHash, outputHash, matchFlag, ogSigHash);
    }
}
