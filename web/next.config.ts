import type { NextConfig } from "next";

/**
 * The build stamps itself so a page can say which version it is.
 *
 * These are read at build time and inlined into the bundle, which is what is
 * wanted here: the answer describes the deployment, not the request. Vercel
 * sets VERCEL_GIT_COMMIT_SHA for every build; a local `next dev` has neither,
 * and says "dev" rather than claiming a commit it cannot know.
 */
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "dev";

// Bangkok, matching the Telegram alerts. Fixed +7 for the same reason: Thailand
// has no daylight saving, and a build container is not guaranteed to carry a
// timezone database.
const builtAt = new Date(Date.now() + 7 * 60 * 60 * 1000)
  .toISOString()
  .replace("T", " ")
  .slice(0, 16);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: commit,
    NEXT_PUBLIC_BUILT_AT: builtAt,
  },
};

export default nextConfig;
