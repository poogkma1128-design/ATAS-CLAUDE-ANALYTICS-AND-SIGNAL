import { readFileSync } from "node:fs";

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

/**
 * The dashboard's REV, read out of package.json rather than derived from git.
 *
 * Deriving it — a commit count, say — would be self-maintaining and wrong here:
 * Vercel checks out shallowly, so `git rev-list --count` sees a truncated
 * history and would report a smaller number on the server than on a laptop, for
 * the same commit. A committed file is the same everywhere.
 *
 * It cannot go stale unnoticed either: `deno task rev:check` fails when web/
 * has moved since this number last did.
 */
const rev = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;

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
    NEXT_PUBLIC_BUILD_REV: rev,
    NEXT_PUBLIC_BUILD_COMMIT: commit,
    NEXT_PUBLIC_BUILT_AT: builtAt,
  },
};

export default nextConfig;
