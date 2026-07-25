// Load the repo-root .env into the dashboard's server process.
//
// Next.js reads .env files relative to the app directory (packages/web), but this is a monorepo
// and there is exactly one .env, at the root, shared by the agents, the gates and the scripts.
// Duplicating it here would mean two files that must agree about a private key — a class of bug
// worth designing out.
//
// `loadDotenv()` is the same loader @ca/shared uses, so the dashboard and `pnpm demo:base` read
// byte-for-byte the same configuration. It never overrides an already-set variable, so a real
// deployment's host environment still wins over the file.

import "server-only";
import { loadDotenv } from "@ca/shared";

loadDotenv();

/** Re-exported so a module can depend on the side effect explicitly rather than by import order. */
export function ensureEnvLoaded(): void {
  loadDotenv();
}
