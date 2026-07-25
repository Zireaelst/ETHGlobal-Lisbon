// The deployed reality of this project, read from the same .env the agents run on.
//
// Every value here is an address, an id or an endpoint that a judge can open. Nothing is
// hardcoded for display: if the demo is pointed at a different verifier or a different topic,
// this panel follows it, because the alternative — a nice-looking constant that no longer
// matches what ran — is how a submission ends up proving nothing.

import "server-only";
import "./env";
import { computeAddress } from "ethers";

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
  /** Why there is deliberately no link, when there isn't one. */
  why?: string;
}

export interface NetworkEvidence {
  network: "base" | "hedera" | "0g" | "thegraph";
  sponsor: string;
  /** What we actually did with it — one sentence, no marketing. */
  what: string;
  /** The exact SDK/endpoint, so the claim is checkable against the code. */
  how: string;
  facts: NetworkFact[];
}

export function networkEvidence(): NetworkEvidence[] {
  const env = process.env;

  return [
    {
      network: "0g",
      sponsor: "0G",
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
          value: null,
          kind: "text",
          why:
            "Off-chain by design. The TEE signs a tuple containing sha256 of the raw response body, so verifying it needs the body — that is what the downloadable bundle is for. No explorer holds it.",
        },
      ],
    },
    {
      network: "thegraph",
      sponsor: "The Graph",
      what:
        "Alice is never given Bob's address. She queries the subgraph by skill and ranks candidates by deliveries a contract confirmed — and the same index records the fraud attempts, so cheating is permanently visible where hiring decisions are made.",
      how: "graph-cli · a subgraph indexing the ERC-8004 registry plus our Verifier's JobVerified / JobRejected events",
      facts: [
        { label: "Query endpoint (POST the query yourself)", value: env.SUBGRAPH_QUERY_URL ?? null, kind: "address" },
        { label: "ERC-8004 identity registry", value: env.ERC8004_IDENTITY ?? null, kind: "token" },
        { label: "Bob's agentId", value: env.BOB_AGENT_ID ?? null, kind: "text", why: "An NFT token id inside the registry above, not an address of its own." },
      ],
    },
    {
      network: "hedera",
      sponsor: "Hedera",
      what:
        "The job's whole lifecycle is timestamped by Hedera consensus — quote, intent, enclave, output, settlement — as commitments only. On the Hedera run the payment itself goes through x402 with the blocky402 facilitator, and settlement is refused unless the contract verified the job first.",
      how: "@hiero-ledger/sdk TopicMessageSubmitTransaction · @x402/hedera exact scheme · blocky402 testnet facilitator",
      facts: [
        { label: "Consensus topic", value: env.HEDERA_TOPIC_ID ?? null, kind: "topic" },
        { label: "Operator account", value: env.HEDERA_OPERATOR_ID ?? null, kind: "account" },
        { label: "Bob's payout account", value: env.BOB_HEDERA_ACCOUNT ?? null, kind: "account" },
        { label: "x402 facilitator", value: env.BLOCKY402_URL ?? null, kind: "text", why: "An HTTP facilitator endpoint, not a ledger entity." },
      ],
    },
    {
      network: "base",
      sponsor: "Base",
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
