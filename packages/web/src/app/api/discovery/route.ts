// GET /api/discovery — the live registry behind the Discovery panel.
//
// Needs no keys and touches no wallet, so it works from a public deployment whether or not the
// operator's laptop is running. That is deliberate: four of the five panels must survive the
// demo machine being closed.

import { NextResponse } from "next/server";
import { fetchDiscovery } from "@/lib/server/subgraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const skill = new URL(request.url).searchParams.get("skill") ?? "market-analysis";
  try {
    return NextResponse.json(await fetchDiscovery(skill));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Report the failure rather than serving a plausible-looking empty registry: an empty
    // discovery panel and a broken one must not look the same.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
