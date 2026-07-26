// The demo dApp (BUILD-PLAN P5-A). Six panels: five show state, one makes something happen.
//
// The discovery snapshot is fetched on the server so the page has real content in its first
// paint — a judge on a phone should not meet an empty frame and a spinner. Everything after
// that is client-side, because the interesting parts are live.

import { ThemeProvider } from "@/lib/theme";
import SiteHeader from "@/components/SiteHeader";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { fetchDiscovery, recordedDiscovery } from "@/lib/server/subgraph";
import { runnerEnabled } from "@/lib/server/runner";
import { networkEvidence } from "@/lib/server/networks";
import type { DiscoverySnapshot } from "@/lib/run-types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Confidential Agents — live demo",
  description:
    "Two AI agents discover each other publicly and keep everything else private. Watch a contract reject work that is not the job that was ordered.",
};

export default async function DashboardPage() {
  // A failed subgraph read must not blank the whole page: the fraud panel still works without
  // it, and DiscoveryPanel reports the failure inside its own frame.
  // A rate-limited window used to make that first paint an empty frame anyway, because the
  // in-memory cache is cold on every serverless invocation. Falling back to the checked-in
  // capture keeps the panel populated with a real index; the client re-reads immediately and
  // replaces it the moment a live query succeeds.
  let discovery: DiscoverySnapshot | null = null;
  try {
    discovery = await fetchDiscovery();
  } catch {
    discovery = recordedDiscovery()?.snapshot ?? null;
  }

  return (
    <ThemeProvider>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-normal leading-tight text-foreground sm:text-4xl">
            One confidential job, end to end
          </h1>
          <p className="mt-4 max-w-3xl font-body text-sm font-light leading-relaxed text-muted-foreground sm:text-base">
            Payment is solved for agents. Execution is solved. Reputation is solved. Nothing connects
            them — nobody proves that the work you paid for is the work you ordered. Below, one signed
            intent is carried from payment, through the enclave, to reputation. Then we break it on
            purpose and let the contract say no.
          </p>
        </header>

        <DashboardClient discovery={discovery} evidence={networkEvidence()} runnerEnabled={runnerEnabled()} />
      </main>
    </ThemeProvider>
  );
}
