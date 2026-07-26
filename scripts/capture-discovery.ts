// scripts/capture-discovery.ts — record a real snapshot of the index for the dashboard to fall
// back on (`pnpm capture:discovery`).
//
// WHY THIS EXISTS: the Studio query endpoint allows 3000 queries per window, and a public
// deployment can exhaust that. When it does, a serverless instance has no warm cache — module
// state does not survive between invocations — so the discovery panel went red for everyone.
//
// The bargain is the same one `fixtures/runs/*.json` makes: real data, captured by a query
// anyone could run, and never shown without its capture time. It is the LAST resort, after a
// live query and after the in-memory cache, and it is always labelled as a capture. What it is
// not, and must never become, is a hand-written registry that the panel presents as live.
//
// Re-run it before a demo so the fallback is recent.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadDotenv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

loadDotenv();

const QUERY = `
  query Dashboard($skill: [String!], $first: Int!) {
    agents(where: { skills_contains: $skill }, orderBy: verifiedDeliveries, orderDirection: desc, first: $first) {
      id
      owner
      skills
      endpoint
      verifiedDeliveries
      rejectedAttempts
      registeredBlock
    }
    jobs(orderBy: timestamp, orderDirection: desc, first: $first) {
      id
      agent { id }
      client
      outputHash
      status
      rejectionCode
      price
      timestamp
      block
      txHash
    }
    registry(id: "global") { agentCount verifiedJobs rejectedJobs }
    _meta { block { number } hasIndexingErrors }
  }
`;

async function main(): Promise<void> {
  const url = requireEnv('SUBGRAPH_QUERY_URL');
  const skill = process.argv[2] ?? 'market-analysis';
  const first = 10;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { skill: [skill], first } }),
  });

  if (!res.ok) {
    // Surfacing the reset time matters: 429 here means "come back", not "this is broken".
    const retry = res.headers.get('retry-after');
    throw new Error(
      `subgraph HTTP ${res.status}` + (retry ? ` — the window resets in ${retry}s, try again after that` : ''),
    );
  }

  const body = (await res.json()) as {
    data?: {
      agents: Array<Record<string, unknown> & { id: string }>;
      jobs: Array<Record<string, unknown> & { id: string; agent: { id: string } }>;
      registry: { agentCount: number; verifiedJobs: number; rejectedJobs: number } | null;
      _meta: { block: { number: number }; hasIndexingErrors: boolean };
    };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(`subgraph error: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('subgraph returned no data');

  const { agents, jobs, registry, _meta } = body.data;
  const snapshot = {
    agents: agents.map(({ id, ...rest }) => ({ agentId: id, ...rest })),
    jobs: jobs.map(({ id, agent, ...rest }) => ({ intentHash: id, agentId: agent.id, ...rest })),
    totals: registry ?? { agentCount: agents.length, verifiedJobs: 0, rejectedJobs: 0 },
    indexedBlock: _meta.block.number,
    hasIndexingErrors: _meta.hasIndexingErrors,
    subgraphUrl: url,
  };

  const dir = resolve(repoRoot(), 'fixtures/discovery');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'snapshot.json');
  writeFileSync(path, `${JSON.stringify({ capturedAt: new Date().toISOString(), snapshot }, null, 2)}\n`);

  console.log(`captured at block ${snapshot.indexedBlock}`);
  console.log(`  agents ${snapshot.agents.length} of ${snapshot.totals.agentCount} indexed`);
  console.log(`  jobs   ${snapshot.totals.verifiedJobs} verified · ${snapshot.totals.rejectedJobs} rejected`);
  console.log(`  → ${path}`);
}

main().catch((err) => {
  console.error(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
