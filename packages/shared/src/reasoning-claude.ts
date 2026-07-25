// reasoning-claude.ts — the agents' brain, running as Claude on the operator's own machine.
//
// Transport only; the decisions and their guards live in `reasoning-llm.ts`.
//
// Why the CLI rather than an SDK call: the Claude Code CLI authenticates with the operator's
// existing subscription, which is what makes "local Claude, no extra model wired in" literally
// true — no API key to provision, no second provider in the stack, no per-call bill.
//
// FOUR FLAG DECISIONS THAT ARE NOT COSMETIC:
//   --system-prompt (replace, NOT --append-system-prompt): the default Claude Code system
//       prompt is a large coding-agent brief — measured at ~15k tokens of context per call for
//       a question whose answer is one boolean. Replacing it keeps a decision small and fast.
//   --allowedTools "" : the brain is asked to think, never to act. No file access, no shell,
//       no network. Every consequence of a decision is carried out by our own code afterwards.
//   --strict-mcp-config with an empty config: otherwise the CLI boots this repo's MCP servers
//       (.mcp.json) for every judgement call.
//   NO --bare: that flag reads credentials strictly from ANTHROPIC_API_KEY and never from
//       OAuth/keychain, which would defeat the entire point of subscription auth.

import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { REASONING_SYSTEM_PROMPT } from './reasoning-prompts.js';
import { createLlmReasoningBackend } from './reasoning-llm.js';
import type { ReasoningBackend } from './reasoning.js';

const run = promisify(execFile);

export interface ClaudeReasoningOptions {
  /** The CLI binary. Overridable so a gate can point at a stub. */
  bin?: string;
  /** Model alias. `sonnet` is the right trade for a one-sentence judgement. */
  model?: string;
  /** Per-decision timeout. Three decisions must still fit the P0-G 60s end-to-end budget. */
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** The shape of `claude -p --output-format json`. Only three fields are load-bearing here. */
interface ClaudeCliResult {
  is_error?: boolean;
  result?: string;
  subtype?: string;
}

/**
 * Everything the child process is allowed to inherit.
 *
 * CLAUDE.md §9 says the payment key must never enter agent/LLM context. The prompts never
 * contain one — but a naively spawned child inherits `process.env`, which by then holds every
 * key loaded from .env. The brain has no tools and so could not read them anyway; we strip
 * them regardless, because "it could not have used it" is a weaker sentence than "it was never
 * given it", and the second is the one we want to say to a judge.
 *
 * Variables prefixed ANTHROPIC_ or CLAUDE_ survive: those are the brain's OWN credentials,
 * not the project's.
 */
export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const SECRET = /(PRIVATE|SECRET|MNEMONIC|SEED|PASSWORD|_KEY$|KEY_)/i;
  const KEEP = /^(ANTHROPIC|CLAUDE)_/i;
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (KEEP.test(name) || !SECRET.test(name)) out[name] = value;
  }
  return out;
}

export function createClaudeReasoningBackend(options: ClaudeReasoningOptions = {}): ReasoningBackend {
  const bin = options.bin ?? 'claude';
  const model = options.model ?? 'sonnet';
  const timeout = options.timeoutMs ?? 45_000;

  return createLlmReasoningBackend({
    provider: 'claude-local',
    log: options.log,
    async ask(prompt: string, what: string): Promise<string> {
      const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--model',
        model,
        '--system-prompt',
        REASONING_SYSTEM_PROMPT,
        '--allowedTools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
      ];

      let stdout: string;
      try {
        // cwd is a scratch directory on purpose: run from the repo and the CLI discovers and
        // loads this project's CLAUDE.md into a question that has nothing to do with it.
        ({ stdout } = await run(bin, args, {
          cwd: tmpdir(),
          timeout,
          maxBuffer: 8 * 1024 * 1024,
          env: scrubbedEnv(process.env),
        }));
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`${what}: the claude CLI failed (${why})`);
      }

      let envelope: ClaudeCliResult;
      try {
        envelope = JSON.parse(stdout) as ClaudeCliResult;
      } catch {
        throw new Error(`${what}: the CLI did not return JSON (${stdout.slice(0, 160)})`);
      }
      if (envelope.is_error || typeof envelope.result !== 'string') {
        throw new Error(`${what}: the CLI reported an error (${envelope.subtype ?? 'unknown'})`);
      }
      return envelope.result;
    },
  });
}
