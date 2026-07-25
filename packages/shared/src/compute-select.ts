// compute-select.ts — decide from the environment which compute backend to use.
//
// There are three modes and ALL THREE label themselves correctly (`ComputeProvider` is
// carried all the way to the UI):
//
//   REPLAY_0G=1   → 'fixture-replay'      a recorded REAL call is replayed, no network access
//   0G key present→ '0g-sealed-inference' a live TEE call
//   neither       → 'none'                no inference at all; NO fake output is produced
//
// NAMING NOTE: BUILD-PLAN calls this flag `MOCK_0G`, and the name is misleading — "mock"
// suggests fabricated data, whereas what it does is replay a recording of a REAL call. The
// signature in the fixture is one a 0G TEE genuinely produced, and it is re-verified on
// every replay. Hence `REPLAY_0G` is the primary name; `MOCK_0G` is still accepted for
// backwards compatibility so existing usage in the plan and in .env does not break.

import type { ComputeBackend } from './compute.js';
import { createNoComputeBackend } from './compute.js';

export interface ComputeSelectionEnv {
  REPLAY_0G?: string;
  /** @deprecated use `REPLAY_0G` — this name suggests "fabricated data". */
  MOCK_0G?: string;
  OG_RPC_URL?: string;
  OG_PRIVATE_KEY?: string;
  OG_PROVIDER_ADDRESS?: string;
}

export interface ComputeSelectionOptions {
  /** The fixture directory (for replay mode). */
  fixtureDir: string;
  /** Record live calls here. No recording when absent. */
  recordDir?: string;
}

const isOn = (v: string | undefined): boolean => v === '1' || v === 'true';

/** Also returns the reason for the choice — gates and the demo print it. */
export async function selectComputeBackend(
  env: ComputeSelectionEnv,
  options: ComputeSelectionOptions,
): Promise<{ backend: ComputeBackend; reason: string }> {
  if (isOn(env.REPLAY_0G) || isOn(env.MOCK_0G)) {
    const { createFixtureComputeBackend } = await import('./compute-fixture.js');
    const flag = isOn(env.REPLAY_0G) ? 'REPLAY_0G' : 'MOCK_0G (legacy name)';
    return {
      backend: createFixtureComputeBackend({ dir: options.fixtureDir }),
      reason: `${flag}=1 → replaying a recorded real 0G response, no network access`,
    };
  }

  if (env.OG_RPC_URL && env.OG_PRIVATE_KEY) {
    const { createZeroGComputeBackend } = await import('./compute-0g.js');
    return {
      backend: createZeroGComputeBackend({
        rpcUrl: env.OG_RPC_URL,
        privateKey: env.OG_PRIVATE_KEY,
        providerAddress: env.OG_PROVIDER_ADDRESS || undefined,
        recordDir: options.recordDir,
      }),
      reason: '0G key present → live Sealed Inference',
    };
  }

  return {
    backend: createNoComputeBackend(),
    reason: 'no 0G key and replay is off → NO inference (no fake output is produced)',
  };
}
