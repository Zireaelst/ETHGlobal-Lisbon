import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
