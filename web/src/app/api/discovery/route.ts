// GET /api/discovery — the live registry behind the Discovery panel.
//
// Needs no keys and touches no wallet, so it works from a public deployment whether or not the
// operator's laptop is running. That is deliberate: four of the five panels must survive the
// demo machine being closed.

import { NextResponse } from "next/server";
import { SubgraphError, fetchDiscovery, lastGoodDiscovery } from "@/lib/server/subgraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const skill = new URL(request.url).searchParams.get("skill") ?? "market-analysis";
  try {
    return NextResponse.json(await fetchDiscovery(skill));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rateLimited = error instanceof SubgraphError && error.rateLimited;

    // Being rate-limited is a different failure from being broken, and flattening both into 502
    // cost the client the one fact it needs to respond correctly. The status is passed through
    // so the panel can slow down rather than keep hammering at the rate that caused it.
    //
    // A recent good answer beats an empty frame, PROVIDED it is labelled — so the age travels
    // with it and the panel says how old it is. Working, broken, and held-over must each look
    // different; two of them looking alike is how a demo starts lying quietly.
    const held = lastGoodDiscovery();
    if (held && held.ageMs < 120_000) {
      return NextResponse.json({ ...held.snapshot, staleMs: held.ageMs, staleReason: message, rateLimited });
    }

    // Report the failure rather than serving a plausible-looking empty registry: an empty
    // discovery panel and a broken one must not look the same.
    return NextResponse.json({ error: message, rateLimited }, { status: rateLimited ? 429 : 502 });
  }
}
