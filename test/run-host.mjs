import { runTests } from "@vscode/test-electron";
import { build } from "vite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const project = process.cwd();
const fixture = await mkdtemp(path.join(tmpdir(), "git-insights-host-"));
try {
  const git = (...args) => execFileSync("git", args, { cwd: fixture, windowsHide: true });
  git("init");
  git("config", "user.name", "Host Test");
  git("config", "user.email", "host@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  await writeFile(path.join(fixture, "sample.txt"), "function\nbody\nend\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  const sha = git("rev-parse", "HEAD").toString().trim();
  await writeFile(path.join(fixture, "git-rebase-todo"), `pick ${sha} Fixture\n`);
  await build({
    configFile: false,
    build: {
      target: "node20",
      outDir: "dist-test",
      lib: { entry: "test/host.ts", formats: ["cjs"], fileName: () => "host.cjs" },
      rolldownOptions: { external: ["vscode", /^node:/] },
    },
  });
  delete process.env.ELECTRON_RUN_AS_NODE;
  await runTests({
    extensionDevelopmentPath: project,
    extensionTestsPath: path.join(project, "dist-test/host.cjs"),
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
    launchArgs: [
      fixture,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-extensions",
      "--disable-telemetry",
      "--user-data-dir",
      // Electron may briefly retain file locks after exiting on Windows.
      // Keep its disposable profile outside the Git fixture being cleaned up.
      path.join(project, ".vscode-test", `profile-${path.basename(fixture)}`),
    ],
    extensionTestsEnv: { ...process.env },
  });
} finally {
  await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
