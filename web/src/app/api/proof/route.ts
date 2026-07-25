// GET /api/proof?mode=… — the downloadable proof bundle.
//
// THIS IS THE PANEL THAT MUST NOT REQUIRE TRUSTING US. The gate's wording is that a judge takes
// the downloaded file into a clean browser and verifies the 0G signature with plain `ethers` —
// nothing of ours in the loop. So the bundle carries the raw material and the exact commands,
// and deliberately carries NO verdict of our own: a "verified: true" field we wrote would be
// the one thing in the file that proves nothing.
//
// The honest boundary is stated in the bundle itself (CLAUDE.md §3.1, §11): the 0G TEE
// signature covers a colon-joined tuple containing the sha256 of the RAW response body, not the
// answer text. Same tamper guarantee, different sentence — and the file says the accurate one.

import { NextResponse } from "next/server";
import { readRecordedRun, type FraudMode } from "@/lib/server/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: FraudMode[] = ["none", "substitute", "tamper", "forge", "selfintent"];

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("mode") ?? "none";
  const mode = (MODES as string[]).includes(raw) ? (raw as FraudMode) : "none";

  const recorded = readRecordedRun(mode);
  if (!recorded) {
    return NextResponse.json({ error: `no recorded "${mode}" run to build a bundle from` }, { status: 404 });
  }

  const { report, recordedAt } = recorded;
  const bundle = {
    README: [
      "Confidential Agents — independent verification bundle.",
      "",
      "Nothing in this file asks you to trust us. It contains no verdict of ours; it contains",
      "the material you need to reach your own. Two independent checks are possible:",
      "",
      "1. THE CHAIN'S VERDICT. Open `chain.basescanUrl`. The Verifier contract on Base Sepolia",
      "   emitted either JobVerified or JobRejected for this job. That event is the settlement",
      "   gate: payment is released only after JobVerified.",
      "",
      "2. THE ENCLAVE'S SIGNATURE. `binding.seal` is a secp256k1 signature over the response",
      "   body, produced by the code that recomputed the client's commitment. Recover it with",
      "   plain ethers and compare against `binding.expectedSigner`:",
      "",
      "     npm i ethers",
      "     node -e \"const {ethers}=require('ethers');const b=require('./bundle.json');\\",
      "       console.log(ethers.recoverAddress(b.binding.sealDigest, b.binding.seal))\"",
      "",
      "WHAT WE DO NOT CLAIM (CLAUDE.md §11):",
      "- The 0G TEE signature does NOT cover the answer text. It covers a colon-joined tuple",
      "  containing sha256 of the RAW response body — the answer's fingerprint. Same guarantee",
      "  against tampering, different sentence.",
      "- The `match` flag was computed by UNATTESTED code. No TDX host was available, so the",
      "  recompute did not run inside a measured enclave. You, holding the brief, can verify it",
      "  independently; a stranger cannot. That gap is real and we are not papering over it.",
      "- We did not build the TEE. 0G did. We bind it to the client's intent.",
    ].join("\n"),
    recordedAt,
    job: {
      fraudMode: report.fraudMode,
      signedIntentHash: report.signedIntentHash,
      bodyIntentHash: report.bodyIntentHash,
      match: report.match,
    },
    chain: {
      network: "base-sepolia",
      chainId: 84532,
      verifier: process.env.VERIFIER_ADDRESS ?? null,
      verdict: report.codeName,
      verified: report.verified,
      txHash: report.txHash ?? null,
      blockNumber: report.blockNumber ?? null,
      basescanUrl: report.basescanUrl ?? null,
    },
    compute: {
      provider: report.computeProvider,
      ogSignatureVerified: report.ogVerified,
      note:
        report.computeProvider === "fixture-replay"
          ? "A recorded REAL 0G response, replayed. The signature in the fixture is one 0G hardware genuinely produced and it is re-verified on every replay — but this particular run was not a live call."
          : "A live 0G Sealed Inference call.",
    },
    reasoning: {
      provider: report.reasoningProvider,
      decisions: report.decisions ?? null,
      note:
        "The agents' decision layer is UNVERIFIED and UNATTESTED. It can refuse to trade; it cannot make an invalid job verify. Nothing it said is signed by anything.",
    },
    timeline: report.timeline ?? null,
    payment: report.payment ?? null,
  };

  return new NextResponse(`${JSON.stringify(bundle, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="confidential-agents-proof-${mode}.json"`,
    },
  });
}
