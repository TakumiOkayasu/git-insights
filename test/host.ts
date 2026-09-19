import * as vscode from "vscode";
import assert from "node:assert/strict";
import { Git } from "../src/git";
import { blameHover, blameCommands } from "../src/blame-hover";
import { CommitOperations } from "../src/commit-operation";
import { OperationEditor } from "../src/operation-editor";
export async function run() {
  const extension = vscode.extensions.getExtension("TakumiOkayasu.git-insights");
  assert.ok(extension, "Extension discovered");
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["fileHistory", "lineHistory", "refresh", "openRebase", "openGraph"])
    assert.ok(commands.includes(`gitInsights.${command}`), command);
  const folder = vscode.workspace.workspaceFolders![0].uri;
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder, "sample.txt"),
  );
  const symbols = vscode.languages.registerDocumentSymbolProvider(
    { language: "plaintext" },
    {
      provideDocumentSymbols: () => [
        new vscode.DocumentSymbol(
          "sample",
          "",
          vscode.SymbolKind.Function,
          new vscode.Range(0, 0, 2, 1),
          new vscode.Range(0, 0, 0, 1),
        ),
      ],
    },
  );
  await vscode.window.showTextDocument(document);
  const gitApi = (await vscode.extensions.getExtension("vscode.git")!.activate()).getAPI(1);
  const git = new Git(gitApi.git.path);
  console.log("Host fixture", {
    file: document.uri.fsPath,
    language: document.languageId,
    git: git.executable,
  });
  console.log("Host blame", await git.blame(folder.fsPath, document.uri.fsPath));
  const commit = await git.commit(folder.fsPath, await git.head(folder.fsPath));
  const richHover = blameHover(
    commit,
    {
      changes: [
        { status: "M", path: "sample.txt", added: "10", deleted: "3" },
        { status: "A", path: "image.png", added: "-", deleted: "-" },
      ],
      remoteUrl: `https://gitlab.com/owner/repo/-/commit/${commit.sha}`,
      avatar: "data:image/png;base64,AQID",
    },
    1,
    new Date(commit.date).getTime() + 86400000,
  );
  assert.equal(richHover.supportHtml, true);
  assert.equal(richHover.supportThemeIcons, true);
  assert.deepEqual(richHover.isTrusted, { enabledCommands: Object.values(blameCommands) });
  const hoverText = richHover.value.replaceAll("&nbsp;", " ");
  assert.match(hoverText, /2 files changed/);
  assert.match(hoverText, /10 insertions/);
  assert.match(hoverText, /3 deletions/);
  assert.match(hoverText, /1 binary files/);
  assert.match(hoverText, /Open in GitLab/);
  assert.match(hoverText, /data:image\/png;base64,AQID/);
  assert.ok(hoverText.includes(commit.sha));
  const hostile =
    '[run](command:workbench.action.closeWindow) <img src="https://example.invalid/tracker">';
  const escaped = new vscode.MarkdownString().appendText(hostile).value;
  const escapedHover = blameHover(
    { ...commit, author: hostile, subject: hostile, body: hostile, email: hostile },
    {},
    1,
  );
  assert.ok(escapedHover.value.includes(escaped), "Repository text uses VS Code escaping");
  assert.ok(!escapedHover.value.includes(hostile), "Repository text cannot inject links or HTML");
  const unsafeAvatar = blameHover(
    commit,
    { changes: [], avatar: "https://example.invalid/tracker" },
    1,
  );
  assert.ok(!unsafeAvatar.value.includes("<img"), "Only validated raster data is embedded");
  const uncommitted = blameHover(undefined, {}, 1);
  assert.ok(!uncommitted.value.includes("copySha"));
  assert.ok(!uncommitted.value.includes("openRemote"));
  console.log("Host diff", await git.run(folder.fsPath, ["diff", "HEAD", "--", "sample.txt"]));
  let lenses: vscode.CodeLens[] = [];
  // Language providers and Git repository discovery settle asynchronously at startup.
  for (let attempt = 0; attempt < 20; attempt++) {
    lenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        document.uri,
      )) ?? [];
    if (lenses.some((l) => l.command?.command === "gitInsights.fileHistory")) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("Host lenses", lenses);
  assert.ok(
    lenses?.some(
      (l) =>
        l.command?.command === "gitInsights.fileHistory" && l.command.title.includes("Host Test"),
    ),
    "CodeLens shows real Git author",
  );
  await vscode.commands.executeCommand("gitInsights.fileHistory");
  const otherHover = vscode.languages.registerHoverProvider(
    { language: "plaintext", scheme: "file" },
    {
      provideHover: (_document, position) =>
        new vscode.Hover("Other extension hover", new vscode.Range(position, position)),
    },
  );
  try {
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 400));
    for (const position of [new vscode.Position(0, 0), document.lineAt(0).range.end]) {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        position,
      );
      const contents = (hovers ?? []).flatMap((hover) => hover.contents);
      const text = contents
        .map((content) => (typeof content === "string" ? content : content.value))
        .join("\n");
      assert.match(text, /Other extension hover/, "Other providers remain available");
      assert.doesNotMatch(text, /Git Insights/, "Blame is confined to its decoration hover");
    }
  } finally {
    otherHover.dispose();
  }
  await vscode.commands.executeCommand("gitInsights.lineHistory");
  await vscode.commands.executeCommand("gitInsights.refresh");
  await vscode.commands.executeCommand(
    "vscode.openWith",
    vscode.Uri.joinPath(folder, "git-rebase-todo"),
    "gitInsights.rebase",
  );
  assert.ok(
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .some(
        (t) =>
          t.input instanceof vscode.TabInputCustom && t.input.viewType === "gitInsights.rebase",
      ),
    "Rebase custom editor opens",
  );
  symbols.dispose();
  await vscode.commands.executeCommand("gitInsights.openGraph", folder.fsPath);
  await vscode.commands.executeCommand("gitInsights.graph.focus");
  const editorTabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  assert.ok(
    !editorTabs().some(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.includes("gitInsights.graph"),
    ),
    "Repository graph does not open an editor tab",
  );
  assert.ok(
    editorTabs().some(
      (tab) =>
        tab.input instanceof vscode.TabInputCustom && tab.input.viewType === "gitInsights.rebase",
    ),
    "Opening the graph preserves the rebase editor",
  );
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await vscode.commands.executeCommand("gitInsights.openGraph", folder.fsPath);
  console.log("Git Insights: extension host smoke tests passed");
  // Exercise editor placement and the Node editor bridge under the extension host.
  await git.run(folder.fsPath, ["add", "git-rebase-todo"]);
  await git.run(folder.fsPath, ["commit", "-m", "Track todo fixture"]);
  const before = await git.head(folder.fsPath);
  const operations = new CommitOperations(git);
  const editor = new OperationEditor(
    operations,
    () => "<html><body>Review</body></html>",
    () => {},
  );
  try {
    await editor.open(folder.fsPath, "reword", commit.sha);
    const operationOpen = () =>
      editorTabs().some(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes("gitInsights.operation"),
      );
    for (let attempt = 0; attempt < 20 && !operationOpen(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(operationOpen(), "Commit operation opens in an editor tab");
    assert.equal(await git.head(folder.fsPath), before, "Opening review does not mutate Git");
  } finally {
    editor.dispose();
  }
  const operation = await operations.prepare(folder.fsPath, "reword", commit.sha);
  await operation.execute("Reworded host fixture\n\n# keep this line\n");
  assert.match(
    await git.run(folder.fsPath, ["show", "-s", "--format=%B", "HEAD~1"]),
    /# keep this line/,
  );
  console.log("Git Insights: commit operation host tests passed");
}
