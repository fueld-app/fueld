import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Analyse changed files to determine the conventional commit type and scope.
 */
function analyseChanges(changedPaths: string[], diff: string) {
  const files = changedPaths;

  // Determine commit type
  let type = "chore";
  const allTest = files.every((f) => f.includes("test") || f.includes(".test.") || f.includes(".spec."));
  const allDocs = files.every((f) => f.startsWith("docs/") || f.endsWith(".md"));
  const allConfig = files.every((f) => f.startsWith(".") || f === "package.json" || f === "tsconfig.json");

  if (allTest) type = "test";
  else if (allDocs) type = "docs";
  else if (allConfig) type = "chore";
  else if (diff.includes("import") || diff.includes("export class") || diff.includes("@Component")) {
    if (diff.includes("Component") || diff.includes("component")) type = "feat";
    else type = "refactor";
  }
  else if (diff.includes("fix(") || diff.includes("bug") || diff.includes("hotfix")) type = "fix";
  else if (diff.includes("style") || diff.includes("css") || diff.includes("tailwind")) {
    if (diff.includes("class:") || files.some((f) => f.endsWith(".css") || f.endsWith(".scss"))) type = "style";
  }

  // Determine scope
  let scope = "";
  const paths = files.map((f) => f.replace("apps/web/src/app/", "").replace("apps/api/src/", ""));
  const commonPrefix = findCommonPrefix(paths);
  if (commonPrefix && commonPrefix.length > 2) {
    scope = commonPrefix;
  }

  // Build subject from file summaries
  const subjects: string[] = [];
  const added = files.filter((f) => !changedPaths.includes(f));
  const modified = files.filter((f) => changedPaths.includes(f));

  if (type === "refactor" && files.length > 0) {
    const comps = files.filter((f) => f.includes("component")).map((f) => {
      const parts = f.split("/").pop()?.replace(".component.ts", "").replace(".ts", "") || f;
      return parts.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    });
    if (comps.length > 0) subjects.push(`extract ${comps.join(", ")}`);
  }

  if (type === "feat") {
    const newFiles = files.filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    if (newFiles.length > 0) subjects.push(`add ${newFiles.map((f) => f.split("/").pop()).join(", ")}`);
  }

  if (subjects.length === 0) {
    const summary = files.length <= 3
      ? files.map((f) => f.split("/").pop()).join(", ")
      : `${files[0]!.split("/").pop()}, ${files[1]!.split("/").pop()} & ${files.length - 2} more`;
    subjects.push(summary);
  }

  const scopePart = scope ? `(${scope})` : "";
  return `${type}${scopePart}: ${subjects.join("; ")}`;
}

function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const parts = paths.map((p) => p.split("/"));
  const result: string[] = [];
  for (let i = 0; i < parts[0]!.length; i++) {
    const part = parts[0]![i];
    if (parts.every((p) => p[i] === part)) {
      if (part.includes("component") || part.includes("service") || part.includes("page")) break;
      result.push(part);
    } else break;
  }
  return result.join("/");
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("ship", {
    description: "Typecheck → add → commit (auto-message) → push",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const userMsg = args.trim();

      ctx.ui.notify("🚢 Running typecheck...", "info");

      // 1. Typecheck
      const tc = await pi.exec("bun", ["run", "typecheck"], { cwd, timeout: 60_000 });
      if (tc.code !== 0) {
        ctx.ui.notify("❌ Typecheck failed — aborting", "error");
        return;
      }

      ctx.ui.notify("✅ Typecheck passed", "success");

      // 2. Stage all
      await pi.exec("git", ["add", "-A"], { cwd, timeout: 10_000 });

      // Check if there's anything to commit
      const status = await pi.exec("git", ["status", "--porcelain"], { cwd, timeout: 5_000 });
      if (!status.stdout.trim()) {
        ctx.ui.notify("⚠️  Nothing to commit", "warning");
        return;
      }

      // 3. Generate commit message from diff
      let commitMsg = userMsg;
      if (!commitMsg) {
        const diffResult = await pi.exec("git", ["diff", "--cached", "--stat"], { cwd, timeout: 10_000 });
        const nameResult = await pi.exec("git", ["diff", "--cached", "--name-only"], { cwd, timeout: 10_000 });
        const diffContent = await pi.exec("git", ["diff", "--cached", "--", "*.ts"], { cwd, timeout: 10_000 });

        const changedFiles = nameResult.stdout.trim().split("\n").filter(Boolean);
        commitMsg = analyseChanges(changedFiles, diffContent.stdout);

        // Show the proposed message and ask for confirmation
        const ok = await ctx.ui.confirm(
          `Proposed commit message: "${commitMsg}"`,
          "Use this?",
        );
        if (!ok) {
          // Ask for custom input
          const custom = await ctx.ui.input("Enter commit message:");
          if (custom) commitMsg = custom;
          else {
            ctx.ui.notify("📝 Commit skipped", "warning");
            return;
          }
        }
      }

      // 4. Commit
      const commit = await pi.exec("git", ["commit", "-m", commitMsg], { cwd, timeout: 10_000 });
      if (commit.code !== 0) {
        ctx.ui.notify("❌ Commit failed", "error");
        return;
      }
      ctx.ui.notify(`✅ ${commit.stdout.trim().split("\n")[0] || "Committed"}`, "success");

      // 5. Push
      ctx.ui.notify("☁️  Pushing...", "info");
      const push = await pi.exec("git", ["push"], { cwd, timeout: 30_000 });
      if (push.code !== 0) {
        ctx.ui.notify("❌ Push failed — check remote", "error");
        return;
      }

      ctx.ui.notify("🚢 Shipped! ✅", "success");
    },
  });
}
