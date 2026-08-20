import { keccak256, AbiCoder, toUtf8Bytes } from "ethers";
const RPC = "https://testrpc.xlayer.tech/terigon";
const call = async (m,p) => { const r = await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})}); const j = await r.json();
  if (j.error) throw new Error(j.error.message); return j.result; };
const decStr = (hex) => { if(!hex||hex==="0x") return null;
  const b=Buffer.from(hex.slice(2),"hex"); if(b.length<64) return null;
  const len=Number(BigInt("0x"+(b.subarray(32,64).toString("hex")||"0")));
  return len?b.subarray(64,64+len).toString("utf8"):null; };
const g = async (T,sel) => { try { return await call("eth_call",[{to:T,data:sel},"latest"]); } catch { return null; } };

const TYPEHASH = keccak256(toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const mkDomain = (name, version, chainId, addr) => keccak256(
  AbiCoder.defaultAbiCoder().encode(["bytes32","bytes32","bytes32","uint256","address"],
    [TYPEHASH, keccak256(toUtf8Bytes(name)), keccak256(toUtf8Bytes(version)), chainId, addr]));

const CHAIN = 1952;
for (const [label,T] of [["USDC_TEST","0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d"],
                         ["USDT0","0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c"],
                         ["Circle-dokümanı","0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3"]]) {
  console.log("\n=== "+label+" "+T+" ===");
  const code = await call("eth_getCode",[T,"latest"]);
  if (code==="0x") { console.log("  ⚠️  KOD YOK — X Layer testnet'te bu adreste kontrat yok"); continue; }
  const name = decStr(await g(T,"0x06fdde03"));
  const ver  = decStr(await g(T,"0x54fd4d50"));
  const onchain = await g(T,"0x3644e515");
  console.log("  name()        :", name);
  console.log("  version()     :", ver ?? "(getter YOK)");
  console.log("  decimals()    :", parseInt(await g(T,"0x313ce567"),16));
  console.log("  DOMAIN_SEP    :", onchain);
  if (name && onchain) for (const v of ["1","2","3"]) {
    const m = mkDomain(name,v,CHAIN,T);
    if (m.toLowerCase()===onchain.toLowerCase()) console.log(`  ✅ EŞLEŞEN version = "${v}"`);
  }
  // EIP-3009 canlı mı: authorizationState(address,bytes32)
  const as = await g(T,"0xe94a0102"+"0".repeat(24)+"dead".padStart(40,"0")+"0".repeat(64));
  console.log("  EIP-3009 authorizationState:", as ? "✅ revert etmiyor" : "❌ yok/revert");
}
