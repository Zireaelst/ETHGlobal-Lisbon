// Every identifier on the dashboard → the public explorer page that proves it.
//
// The dashboard's job is not to say "we used your technology". It is to let a judge click and
// check, on the sponsor's own explorer, without taking our word for anything. So this module is
// the single place that knows how to turn an id into a link, and the single place where the
// rule below is enforced.
//
// THE RULE: NO LINK IS BETTER THAN A WRONG LINK. Several things on this page have no explorer
// page and never will — an ECIES ciphertext, a 0G TEE signature, an intent commitment that was
// only ever a function argument. Linking those somewhere plausible would be the exact opposite
// of proof. `explorerFor` returns null for them, and the UI renders plain text instead.
//
// All four networks were verified by hand before being wired in (chain ids and URL shapes):
//   Base Sepolia  84532   sepolia.basescan.org
//   Hedera        testnet hashscan.io/testnet   (a SPA — curl 404s, browsers resolve it)
//   0G Galileo    16602   chainscan-galileo.0g.ai
//   The Graph     —       the Studio query endpoint itself is the artefact

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const OG_GALILEO_CHAIN_ID = 16602;

const BASESCAN = "https://sepolia.basescan.org";
const OG_SCAN = "https://chainscan-galileo.0g.ai";
const OG_STORAGE_SCAN = "https://storagescan-galileo.0g.ai";

function hashscan(): string {
  const network = (process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet").toLowerCase();
  return `https://hashscan.io/${network}`;
}

export type Network = "base" | "hedera" | "0g" | "thegraph";

export type Kind =
  | "tx"
  | "address"
  | "contract"
  | "token"
  | "block"
  | "account"
  | "topic"
  | "storage-root"
  /** A 0G Storage UPLOAD transaction — see the `storage-root` case for why this exists. */
  | "storage-tx";

/**
 * The explorer URL for an identifier, or null when the thing genuinely is not on one.
 * Callers must handle null by rendering plain text — never by inventing a destination.
 */
export function explorerFor(network: Network, kind: Kind, id: string | null | undefined): string | null {
  if (!id) return null;

  switch (network) {
    case "base":
      switch (kind) {
        case "tx":
          return `${BASESCAN}/tx/${id}`;
        case "address":
        case "contract":
          return `${BASESCAN}/address/${id}`;
        case "token":
          return `${BASESCAN}/token/${id}`;
        case "block":
          return `${BASESCAN}/block/${id}`;
        default:
          return null;
      }

    case "hedera":
      switch (kind) {
        case "tx":
          return `${hashscan()}/transaction/${id}`;
        case "topic":
          return `${hashscan()}/topic/${id}`;
        case "account":
        case "address":
          return `${hashscan()}/account/${id}`;
        default:
          return null;
      }

    case "0g":
      switch (kind) {
        case "tx":
          return `${OG_SCAN}/tx/${id}`;
        case "address":
        case "contract":
          return `${OG_SCAN}/address/${id}`;
        // A storage ROOT has no page. `${OG_STORAGE_SCAN}/file/<root>` was the obvious guess and
        // it 404s — verified against a root we uploaded ourselves, and the explorer does route
        // (its /tx/ path answers 200 for the same upload), so this is a missing page rather than
        // a site that rejects everything. The blob is fetched from the indexer by root hash, not
        // browsed. Returning null keeps it rendering as plain text, which is what an identifier
        // with no explorer page is supposed to look like here.
        case "storage-root":
          return null;
        // The upload transaction, however, is on chain and does have a page — that is the
        // checkable destination for an archive.
        case "storage-tx":
          return `${OG_STORAGE_SCAN}/tx/${id}`;
        default:
          return null;
      }

    // The Graph has no block explorer. The subgraph's own endpoint is the artefact: a judge
    // POSTs the query and gets the same rows the panel shows. The caller supplies that URL.
    case "thegraph":
      return kind === "address" ? id : null;
  }
}

/**
 * An ERC-8004 agent's own page on Basescan.
 *
 * The registry is an ERC-721, so an agentId is an NFT token id and Basescan gives it an instance
 * page. This is the strongest link for "agent 8429" — the registration itself, on chain, rather
 * than the collection it belongs to.
 */
export function erc8004AgentUrl(registry: string | null | undefined, agentId: string | null | undefined) {
  if (!registry || !agentId) return null;
  return `${BASESCAN}/nft/${registry}/${agentId}`;
}

/**
 * A single HCS message, straight from the public mirror node.
 *
 * HashScan has no per-message page, but the REST API does, and it returns exactly the bytes we
 * committed. That is a better proof than a topic-level link anyway: the reader sees THIS stage of
 * THIS job, base64 and all, from Hedera's own infrastructure rather than ours.
 */
export function hcsMessageUrl(topicId: string, sequenceNumber: number, network = "testnet") {
  const host = network === "mainnet" ? "mainnet-public.mirrornode.hedera.com" : `${network}.mirrornode.hedera.com`;
  return `https://${host}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
}

/**
 * The x402 facilitator's capability document.
 *
 * Not an explorer, but it is the check that matters: `/supported` lists the schemes the
 * facilitator will actually settle, including `hedera:testnet` and the fee payer our .env names.
 * A judge can confirm the rail we claim to use is the rail it advertises.
 */
export function facilitatorSupportedUrl(base: string | null | undefined) {
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/supported`;
}

/** The explorer's own name, so a link can say where it goes before it is clicked. */
export function explorerName(network: Network): string {
  switch (network) {
    case "base":
      return "Basescan";
    case "hedera":
      return "HashScan";
    case "0g":
      return "0G Chainscan";
    case "thegraph":
      return "Subgraph Studio";
  }
}
