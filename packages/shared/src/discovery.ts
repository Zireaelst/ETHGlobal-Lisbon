// discovery.ts — discovery through The Graph (BUILD-PLAN P2-B/P2-C).
//
// Alice does NOT know Bob's address. She searches by skill, the subgraph supplies the
// endpoint and the ECIES pubkey, and the job proceeds from there. The absence of a
// hard-coded agent address in the code is the proof that The Graph is load-bearing — the
// gate verifies this with a grep.
//
// Ranking is by `verifiedDeliveries`: reputation comes from the `JobVerified` event emitted
// by Verifier.sol, not from user input. (CLAUDE.md §11: this is not "Sybil-proof" —
// inflating it is expensive, not impossible.)

export interface DiscoveredAgent {
  /** ERC-8004 agentId, decimal string. */
  agentId: string;
  owner: string;
  skills: string[];
  endpoint: string | null;
  eciesPubKey: string | null;
  stealthMetaAddress: string | null;
  verifiedDeliveries: number;
  rejectedAttempts: number;
  registeredBlock: string;
}

export interface SubgraphMeta {
  blockNumber: number;
  hasIndexingErrors: boolean;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function query<T>(url: string, gql: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) throw new Error(`subgraph error: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('subgraph returned an empty response');
  return body.data;
}

const AGENT_FIELDS = `
  id
  owner
  skills
  endpoint
  eciesPubKey
  stealthMetaAddress
  verifiedDeliveries
  rejectedAttempts
  registeredBlock
`;

interface RawAgent {
  id: string;
  owner: string;
  skills: string[];
  endpoint: string | null;
  eciesPubKey: string | null;
  stealthMetaAddress: string | null;
  verifiedDeliveries: number;
  rejectedAttempts: number;
  registeredBlock: string;
}

function toAgent(raw: RawAgent): DiscoveredAgent {
  return {
    agentId: raw.id,
    owner: raw.owner,
    skills: raw.skills,
    endpoint: raw.endpoint,
    eciesPubKey: raw.eciesPubKey,
    stealthMetaAddress: raw.stealthMetaAddress,
    verifiedDeliveries: raw.verifiedDeliveries,
    rejectedAttempts: raw.rejectedAttempts,
    registeredBlock: raw.registeredBlock,
  };
}

/** The subgraph's indexing status — the gate uses this as proof of sync. */
export async function subgraphMeta(url: string): Promise<SubgraphMeta> {
  const data = await query<{ _meta: { block: { number: number }; hasIndexingErrors: boolean } }>(
    url,
    '{ _meta { block { number } hasIndexingErrors } }',
  );
  return { blockNumber: data._meta.block.number, hasIndexingErrors: data._meta.hasIndexingErrors };
}

/**
 * Search for agents by skill, ranked by verified delivery count.
 *
 * Records without an `endpoint` and an `eciesPubKey` are filtered out — no work can be done
 * with them. (The registry also contains records from others, with empty metadata.)
 */
export async function discoverBySkill(
  subgraphUrl: string,
  skill: string,
  options: { requireUsable?: boolean; first?: number } = {},
): Promise<DiscoveredAgent[]> {
  const requireUsable = options.requireUsable ?? true;
  const data = await query<{ agents: RawAgent[] }>(
    subgraphUrl,
    `query DiscoverBySkill($skill: [String!], $first: Int!) {
       agents(
         where: { skills_contains: $skill }
         first: $first
         orderBy: verifiedDeliveries
         orderDirection: desc
       ) { ${AGENT_FIELDS} }
     }`,
    { skill: [skill], first: options.first ?? 25 },
  );

  const agents = data.agents.map(toAgent);
  const usable = requireUsable ? agents.filter((a) => a.endpoint && a.eciesPubKey) : agents;

  // The subgraph already sorts; on a tie put the earlier registration first (be deterministic).
  return usable.sort(
    (a, b) =>
      b.verifiedDeliveries - a.verifiedDeliveries ||
      Number(BigInt(a.registeredBlock) - BigInt(b.registeredBlock)),
  );
}

/** Fetch a single agent by agentId. */
export async function findAgentById(subgraphUrl: string, agentId: string): Promise<DiscoveredAgent | null> {
  const data = await query<{ agent: RawAgent | null }>(
    subgraphUrl,
    `query FindAgent($id: ID!) { agent(id: $id) { ${AGENT_FIELDS} } }`,
    { id: agentId },
  );
  return data.agent ? toAgent(data.agent) : null;
}

/** The first usable agent discovery returns — Alice's default choice. */
export async function pickBestAgent(subgraphUrl: string, skill: string): Promise<DiscoveredAgent> {
  const found = await discoverBySkill(subgraphUrl, skill);
  const best = found[0];
  if (!best) throw new Error(`no agent with the "${skill}" skill, an endpoint and a pubkey was found`);
  return best;
}
