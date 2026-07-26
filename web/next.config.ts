import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app is one member of a workspace, so what it needs at runtime is not all under web/.
  // Anchoring tracing at the repo root makes the deployed bundle keep the same relative shape
  // the checkout has, which is what lets the path below resolve on both sides.
  outputFileTracingRoot: path.join(__dirname, ".."),

  // The recorded runs are DATA the route handlers read at request time, not imports — nothing in
  // the module graph points at them, so tracing alone would leave them behind. Without this, a
  // deployment with the live runner switched off (which is every public one, by design) has no
  // run to show and the proof bundle 404s. See `src/lib/server/runner.ts`.
  outputFileTracingIncludes: {
    "/api/run": ["../fixtures/runs/*.json"],
    "/api/proof": ["../fixtures/runs/*.json"],
    // Same reasoning for the discovery capture: the panel falls back to it when the Studio
    // endpoint's query window is exhausted, and a serverless instance has no warm cache to hold
    // over. Both the route and the page's first paint read it.
    "/api/discovery": ["../fixtures/discovery/*.json"],
    "/dashboard": ["../fixtures/discovery/*.json"],
  },

  // @ca/demo boots Bob's HTTP server, signs with ethers and spawns the Claude CLI. None of that
  // can be bundled for the browser or run on an edge runtime, so the route handlers that use it
  // pin `runtime = "nodejs"` and these stay external to the server bundle.
  serverExternalPackages: [
    "@ca/demo",
    "@ca/shared",
    "@ca/payment",
    "@ca/alice-agent",
    "@ca/bob-agent",
    "@ca/bob-binding",
  ],
};

export default nextConfig;
