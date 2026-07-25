// @ca/shared — the single source of truth used by both agents (BUILD-PLAN §2.1).
export * from './config.js';
export * from './canonical.js';
export * from './schema.js';
export * from './intent.js';
export * from './ecies.js';
export * from './sealsig.js';
export * from './ogsig.js';
export * from './identity.js';
export * from './discovery.js';
export * from './timing.js';
export * from './compute.js';
export * from './compute-fixture.js';
export * from './compute-0g.js';
export * from './compute-select.js';
// The agents' brain — who DECIDES, as opposed to what is verified (see reasoning.ts).
// The two transports are deliberately NOT re-exported here: `reasoning-claude.ts` pulls in
// node:child_process, and this barrel is imported by the Next.js dashboard. `selectReasoningBackend`
// loads whichever one is asked for, lazily, so the browser bundle never sees either.
export * from './reasoning.js';
export * from './reasoning-prompts.js';
export * from './reasoning-llm.js';
export * from './reasoning-select.js';
export * from './timeline.js';
export * from './storage.js';
