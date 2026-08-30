/**
 * Fails when a component has changed since its REV last moved.
 *
 * The REV exists to answer one question — "is the thing in front of me the
 * current one?" — and a number that silently stops moving answers it wrongly,
 * which is worse than having no number at all. That is not hypothetical here:
 * the indicator's csproj already carried a "bump this by hand" comment, and it
 * still sat at 1.1.0 through a later change; the dashboard's package.json sat
 * at 0.1.0 through eleven.
 *
 * Each component keeps its own number on purpose. The indicator changes rarely
 * and the dashboard often, so a shared number would move the indicator's REV on
 * every web deploy and send someone to rebuild a DLL that did not change. That
 * misreading has already cost a debugging session once (HANDOFF section 3.8).
 *
 *   deno task rev:check
 *
 * Run before committing. It uses git history, which is complete on a
 * development machine — deliberately not on the Vercel build, which checks out
 * shallowly and where the REV is only ever read from the committed file.
 */

interface Component {
  /** How it is named in the failure message. */
  name: string;
  /** The file that declares the version. */
  versionFile: string;
  /** Everything whose change should force a bump. */
  dir: string;
  /** Pulls the version out of that file. */
  read: (source: string) => string | null;
  /** Builds the string to search history for, so the search matches one line. */
  needle: (version: string) => string;
}

const COMPONENTS: Component[] = [
  {
    name: "indicator",
    versionFile: "atas-indicator/AtasSignalBridge/AtasSignalBridge.csproj",
    dir: "atas-indicator",
    read: (s) => s.match(/<Version>([^<]+)<\/Version>/)?.[1] ?? null,
    needle: (v) => `<Version>${v}</Version>`,
  },
  {
    name: "web",
    versionFile: "web/package.json",
    dir: "web",
    read: (s) => {
      const parsed = JSON.parse(s);
      return typeof parsed.version === "string" ? parsed.version : null;
    },
    needle: (v) => `"version": "${v}"`,
  },
];

async function git(...args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${new TextDecoder().decode(stderr)}`,
    );
  }
  return new TextDecoder().decode(stdout).trim();
}

/** True when `earlier` is `later` or one of its ancestors. */
async function isAncestor(earlier: string, later: string): Promise<boolean> {
  const { code } = await new Deno.Command("git", {
    args: ["merge-base", "--is-ancestor", earlier, later],
    stdout: "null",
    stderr: "null",
  }).output();
  return code === 0;
}

async function describe(sha: string): Promise<string> {
  return await git("log", "-1", "--format=%h %ad  %s", "--date=short", sha);
}

let failed = false;

for (const c of COMPONENTS) {
  const version = c.read(await Deno.readTextFile(c.versionFile));
  if (version === null) {
    console.error(`✗ ${c.name}: no version found in ${c.versionFile}`);
    failed = true;
    continue;
  }

  const committed = c.read(await git("show", `HEAD:${c.versionFile}`));
  const bumpedInWorkingTree = committed !== version;

  // Uncommitted work counts. Catching it here means the reminder arrives while
  // the change is still in hand, rather than after it is already history.
  //
  // Asked as two plain lists of paths rather than parsed out of
  // `status --porcelain`, whose two-column status prefix has to survive being
  // trimmed to be read correctly — it did not, and the first file in the list
  // came out with its leading character eaten.
  const dirty = [
    ...(await git("diff", "--name-only", "HEAD", "--", c.dir)).split("\n"),
    ...(await git("ls-files", "--others", "--exclude-standard", "--", c.dir))
      .split("\n"),
  ].filter((path) => path !== "" && path !== c.versionFile);

  if (dirty.length > 0 && !bumpedInWorkingTree) {
    console.error(
      `✗ ${c.name} is at REV ${version}, unchanged, but these are edited:`,
    );
    for (const path of dirty.slice(0, 8)) console.error(`      ${path}`);
    if (dirty.length > 8) console.error(`      … and ${dirty.length - 8} more`);
    console.error(`  → bump the version in ${c.versionFile} in this change\n`);
    failed = true;
    continue;
  }

  // A version that only exists in the working tree cannot be found in history,
  // and saying "no history" about it would be the same kind of wrong answer
  // this script exists to prevent.
  if (bumpedInWorkingTree) {
    console.log(`✓ ${c.name} REV ${committed} → ${version} (not committed yet)`);
    continue;
  }

  // -S counts occurrences, so this finds the commit that introduced the version
  // currently declared rather than merely the last commit to touch the file.
  const versionCommit = await git(
    "log",
    "-1",
    "--format=%H",
    "-S",
    c.needle(version),
    "--",
    c.versionFile,
  );
  const codeCommit = await git("log", "-1", "--format=%H", "--", c.dir);

  // Only reachable on a shallow or freshly initialised clone, where history is
  // genuinely absent rather than merely not searched.
  if (versionCommit === "" || codeCommit === "") {
    console.log(
      `· ${c.name} REV ${version} — history too shallow to verify, not checked`,
    );
    continue;
  }

  // A commit is its own ancestor, so bumping the REV in the same commit as the
  // change it describes passes. That is the intended way to use this.
  if (await isAncestor(codeCommit, versionCommit)) {
    console.log(`✓ ${c.name} REV ${version}`);
    continue;
  }

  console.error(`✗ ${c.name} is at REV ${version}, which is behind its code.`);
  console.error(`      REV set by:   ${await describe(versionCommit)}`);
  console.error(`      code moved:   ${await describe(codeCommit)}`);
  console.error(`  → bump the version in ${c.versionFile}\n`);
  failed = true;
}

if (failed) {
  console.error(
    "A REV that stops moving answers 'am I on the latest?' wrongly, which is\n" +
      "worse than not answering. Bump the component's version and run again.",
  );
  Deno.exit(1);
}
