// GET /api/timeline?intentHash=0x… — the HCS timeline behind the Job timeline panel.
//
// Like /api/discovery this is a read of a public network, so it needs no keys and survives the
// demo laptop being closed. The response carries `mirrorQueryUrl` so a judge can re-run the
// exact same query themselves and compare.

import { NextResponse } from "next/server";
import { fetchTimeline } from "@/lib/server/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const intentHash = new URL(request.url).searchParams.get("intentHash") ?? undefined;
  try {
    return NextResponse.json(await fetchTimeline(intentHash));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
