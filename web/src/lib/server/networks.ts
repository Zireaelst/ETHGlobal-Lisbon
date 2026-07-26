// The deployed reality of this project, read from the same .env the agents run on.
//
// Every value here is an address, an id or an endpoint that a judge can open. Nothing is
// hardcoded for display: if the demo is pointed at a different verifier or a different topic,
// this panel follows it, because the alternative — a nice-looking constant that no longer
// matches what ran — is how a submission ends up proving nothing.

import "server-only";
import "./env";
import { computeAddress } from "ethers";
import { erc8004AgentUrl, explorerFor, facilitatorSupportedUrl } from "@/lib/explorers";
import type { SponsorId } from "@/components/SponsorLogo";
import { readRecordedRun } from "./runner";

/**
 * The compute payer's PUBLIC address, derived here from the key that pays for 0G inference.
 *
 * The key itself never leaves this process — `computeAddress` is a pure derivation and only the
 * resulting address is returned. That address is worth showing because its transactions on 0G
 * Chain are the on-chain half of "we really used 0G Compute": the ledger funding is on the
 * explorer even though the inference call is not.
 */
function ogComputePayer(): string | null {
  const key = process.env.OG_PRIVATE_KEY;
  if (!key) return null;
  try {
    return computeAddress(key.startsWith("0x") ? key : `0x${key}`);
  } catch {
    return null;
  }
}

export interface NetworkFact {
  label: string;
  /** Rendered via <Hash>. Null when the fact is real but has no explorer page. */
  value: string | null;
  kind: "tx" | "address" | "contract" | "token" | "account" | "topic" | "text";
  /** Why there is deliberately no link, when there genuinely isn't one. */
  why?: string;
  /**
   * A checkable destination that is not an explorer page. Added after a first pass left several
   * facts inert that a judge could in fact verify — an NFT instance page, a facilitator's
   * capability document, the downloadable proof bundle.
   */
  href?: string | null;
  /** Where `href` goes, named so a click is never a surprise. */
  goesTo?: string;
}

export interface NetworkEvidence {
  /** Also selects the sponsor's lockup — see SponsorLogo, which holds the name. */
  network: SponsorId;
  /** What we actually did with it — one sentence, no marketing. */
  what: string;
  /** The exact SDK/endpoint, so the claim is checkable against the code. */
  how: string;
  facts: NetworkFact[];
}

/**
 * The 0G Storage archive (P3-E), read from the last recorded honest run.
 *
 * A storage root has no explorer page — `storagescan/file/<root>` 404s, checked against a root we
 * uploaded ourselves. The UPLOAD TRANSACTION does have one, so that is where this links: it is on
 * 0G Chain, it names the root, and it is the closest thing to "prove this was really stored"
 * that can be opened in a browser. The blob itself is fetched from the indexer by root hash, and
 * the bundle carries the command for that.
 *
 * When a run archived nothing, the fact says so. An address we did not produce is not one we
 * invent (the same rule `compute.ts` follows for a missing TEE signature).
 */
function archiveFact(): NetworkFact {
  const archive = readRecordedRun("none")?.report.storage;
  if (!archive) {
    return {
      label: "Deliverable archive (0G Storage)",
      value: null,
      kind: "text",
      why:
        "This run did not archive its deliverable — storage is opt-in (OG_STORAGE=1) because every upload spends faucet credit. Nothing was stored, so there is no root hash to show.",
    };
  }
  return {
    label: "Deliverable archive (0G Storage)",
    value: archive.rootHash,
    kind: "text",
    href: explorerFor("0g", "storage-tx", archive.txHash),
    goesTo: "the upload transaction on 0G's storage explorer — a root hash has no page of its own",
    why:
      "The blob is fetched from the 0G indexer by root hash; the bundle carries the command. It is AES-256-GCM ciphertext and the key is not published: anyone can confirm the artefact exists and is retrievable, reading it stays the client's privilege.",
  };
}

export function networkEvidence(): NetworkEvidence[] {
  const env = process.env;

  return [
    {
      network: "0g",
      what:
        "The analysis Alice buys runs inside a 0G Sealed Inference enclave, so neither Bob nor the infrastructure sees her brief. The output comes back signed by the TEE, and the intent commitment is carried through the enclave inside the signed body.",
      how: "@0gfoundation/0g-compute-ts-sdk · createZGComputeNetworkBroker → getServiceMetadata (TeeML) → /chat/completions → processResponse",
      facts: [
        {
          label: "Provider we pinned (on 0G Chain)",
          value: env.OG_PROVIDER_ADDRESS ?? null,
          kind: "address",
        },
        {
          label: "Our compute payer — its ledger txs are on chain",
          value: ogComputePayer(),
          kind: "address",
        },
        {
          label: "TEE signature over the response body",
          value: "download the bundle to verify it",
          kind: "text",
          href: "/api/proof?mode=none",
          goesTo: "the proof bundle — the response body plus the command to check the signature",
          why:
            "Off-chain by design. The TEE signs a tuple containing sha256 of the raw response body, so verifying it needs the body — that is what the downloadable bundle is for. No explorer holds it.",
        },
        archiveFact(),
      ],
    },
    {
      network: "thegraph",
      what:
        "Alice is never given Bob's address. She queries the subgraph by skill and ranks candidates by deliveries a contract confirmed — and the same index records the fraud attempts, so cheating is permanently visible where hiring decisions are made.",
      how: "graph-cli · a subgraph indexing the ERC-8004 registry plus our Verifier's JobVerified / JobRejected events",
      facts: [
        { label: "Query endpoint (POST the query yourself)", value: env.SUBGRAPH_QUERY_URL ?? null, kind: "address" },
        { label: "ERC-8004 identity registry", value: env.ERC8004_IDENTITY ?? null, kind: "token" },
        {
          label: "Bob's agentId",
          value: env.BOB_AGENT_ID ?? null,
          kind: "text",
          href: erc8004AgentUrl(env.ERC8004_IDENTITY, env.BOB_AGENT_ID),
          goesTo: "Bob's registration itself — the ERC-721 token page on Basescan",
        },
      ],
    },
    {
      network: "hedera",
      what:
        "The job's whole lifecycle is timestamped by Hedera consensus — quote, intent, enclave, output, settlement — as commitments only. On the Hedera run the payment itself goes through x402 with the blocky402 facilitator, and settlement is refused unless the contract verified the job first.",
      how: "@hiero-ledger/sdk TopicMessageSubmitTransaction · @x402/hedera exact scheme · blocky402 testnet facilitator",
      facts: [
        { label: "Consensus topic", value: env.HEDERA_TOPIC_ID ?? null, kind: "topic" },
        { label: "Operator account", value: env.HEDERA_OPERATOR_ID ?? null, kind: "account" },
        { label: "Bob's payout account", value: env.BOB_HEDERA_ACCOUNT ?? null, kind: "account" },
        {
          label: "x402 facilitator",
          value: env.BLOCKY402_URL ?? null,
          kind: "text",
          href: facilitatorSupportedUrl(env.BLOCKY402_URL),
          goesTo: `its /supported document — it advertises hedera:testnet and fee payer ${env.BLOCKY402_FEE_PAYER ?? "the account we name"}`,
        },
      ],
    },
    {
      network: "base",
      what:
        "Base holds the verdict. The Verifier recovers both signatures — the enclave's seal and Alice's EIP-712 intent — and refuses the job unless they agree and match is true. Payment settles only after JobVerified, and on the Base run the recipient is a fresh ERC-5564 stealth address, so the payout does not name Bob.",
      how: "Foundry · Verifier.sol + IntentLib.sol · x402 over USDC · @scopelift/stealth-address-sdk",
      facts: [
        { label: "Verifier contract", value: env.VERIFIER_ADDRESS ?? null, kind: "contract" },
        { label: "ERC-8004 registry", value: env.ERC8004_IDENTITY ?? null, kind: "token" },
        { label: "USDC (payment asset)", value: env.USDC_BASE_SEPOLIA ?? null, kind: "token" },
      ],
    },
  ];
}
