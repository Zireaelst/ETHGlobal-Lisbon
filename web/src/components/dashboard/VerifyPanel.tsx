"use client";

import { Panel, Chip, Field, ProofLink } from "./Panel";
import { Hash } from "./Hash";
import { type RunView } from "@/lib/run-types";

/**
 * The panel whose entire job is to make itself unnecessary.
 *
 * The gate's wording is that a judge downloads a file, opens a clean browser, and checks the
 * signature with plain `ethers` — nothing of ours in the loop. So this panel hands over material
 * and commands, and states its own limits rather than asserting a verdict. Anything here that
 * said "verified ✓" in our own voice would be the one claim on the page proving nothing.
 *
 * The three limits below are quoted from CLAUDE.md §11 deliberately: they are the difference
 * between what we built and what a reader might assume we built, and saying them unprompted is
 * cheaper than being caught not saying them.
 */
export function VerifyPanel({ run }: { run: RunView | null }) {
  const report = run?.report;
  const mode = report?.fraudMode ?? "none";

  return (
    <Panel
      eyebrow="Verify it yourself"
      title="Don&apos;t take our word for any of it"
      subtitle="Download the run and check it in a clean browser with nothing of ours installed. The bundle contains no verdict of ours — only the material to reach your own."
      actions={
        report ? (
          <a
            href={`/api/proof?mode=${mode}`}
            className="rounded-md border border-warm/50 px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-warm transition hover:bg-warm/[0.08]"
          >
            download bundle
          </a>
        ) : null
      }
    >
      {!report ? (
        <p className="font-body text-sm font-light text-muted-foreground">
          Run a job below, then come back and check it.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="compute">{report.computeProvider}</Field>
            <Field label="0G TEE signature">
              <span className={report.ogVerified ? "text-warm" : "text-muted-foreground"}>
                {report.ogVerified ? "verified" : "not verified"}
              </span>
            </Field>
            <Field label="chain verdict">
              <span className={report.verified ? "text-warm" : "text-alert"}>{report.codeName}</span>
            </Field>
            <Field label="decided by">{report.reasoningProvider}</Field>
          </div>

          {report.basescanUrl ? (
            <p className="mt-4">
              <ProofLink href={report.basescanUrl}>
                the contract&apos;s own event, on Base Sepolia ↗
              </ProofLink>{" "}
              <span className="font-mono text-[11px] text-muted-foreground">
                · tx <Hash value={report.txHash} network="base" kind="tx" lead={12} tail={8} />
              </span>
            </p>
          ) : null}

          {/* Printed only when the bundle actually carries the fields it reads. This command
              used to be shown unconditionally against a `binding` key the bundle never had, so
              the one instruction on the page that exists to prove we are not asking for trust
              was the one that threw. */}
          <div className="mt-6 rounded-md border border-border p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              recover the seal signature yourself
            </div>
            {report.binding ? (
              <>
                <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground">
{`npm i ethers
node -e "const {ethers}=require('ethers');const b=require('./bundle.json');
  console.log(ethers.recoverAddress(b.binding.sealDigest, b.binding.seal))"`}
                </pre>
                <p className="mt-3 font-body text-xs font-light leading-relaxed text-muted-foreground">
                  It should print{" "}
                  <span className="font-mono text-foreground">
                    {report.binding.expectedSigner ?? "the signer the contract has on file"}
                  </span>
                  {report.fraudMode === "forge" ? (
                    <>
                      {" "}
                      — and on this run it will not, because the seal was forged. That mismatch is
                      the finding, not a failure of the command.
                    </>
                  ) : (
                    <>
                      , the address the Verifier has registered for this agent. The bundle also
                      carries the body, so you can rebuild the digest instead of trusting ours.
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-3 font-body text-xs font-light leading-relaxed text-muted-foreground">
                This run was recorded before the seal material was carried in the report, so the
                bundle has nothing to recover. Run a fresh job and the command appears here — we
                would rather show you a gap than a command that fails.
              </p>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-3 flex flex-wrap gap-2">
              <Chip tone="neutral">what we do not claim</Chip>
            </div>
            <ul className="space-y-2.5 font-body text-xs font-light leading-relaxed text-muted-foreground">
              <li>
                <span className="text-foreground">The 0G signature does not cover the answer text.</span>{" "}
                It covers a tuple containing the sha256 of the raw response body — the answer&apos;s
                fingerprint. The same protection against tampering, a different sentence, and we use the
                accurate one.
              </li>
              <li>
                <span className="text-foreground">
                  The <code className="font-mono">match</code> check ran in unattested code.
                </span>{" "}
                No TDX host was available, so the recompute did not happen inside a measured enclave. You,
                holding the brief, can verify it independently. A stranger cannot. That gap is real.
              </li>
              <li>
                <span className="text-foreground">We did not build the TEE.</span> 0G did. What we added is
                binding it to the intent the client signed — and the provider we pinned reports itself as a
                single cloud operator, not decentralised compute.
              </li>
              <li>
                <span className="text-foreground">The agents&apos; reasoning is not verified.</span> It can
                refuse to trade; it cannot make an invalid job verify. Nothing it said is signed by anything.
              </li>
            </ul>
          </div>
        </>
      )}
    </Panel>
  );
}
