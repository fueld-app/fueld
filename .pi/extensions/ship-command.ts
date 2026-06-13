import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("ship", {
    description: "Typecheck → git add -A → commit → push. Usage: /ship [commit message]",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const msg = args.trim();

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

      // 3. Commit
      if (msg) {
        const commit = await pi.exec("git", ["commit", "-m", msg], { cwd, timeout: 10_000 });
        if (commit.code !== 0) {
          const out = commit.stdout + commit.stderr;
          if (out.includes("nothing to commit")) {
            ctx.ui.notify("⚠️  Nothing to commit", "warning");
            return;
          }
          ctx.ui.notify("❌ Commit failed", "error");
          return;
        }
        ctx.ui.notify(`✅ Committed: ${msg}`, "success");
      } else {
        ctx.ui.notify("📝 No message provided — use /ship <commit message>", "warning");
        return;
      }

      // 4. Push
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
