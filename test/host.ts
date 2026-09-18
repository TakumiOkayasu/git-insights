import * as vscode from "vscode";
import assert from "node:assert/strict";
import { Git } from "../src/git";
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
  const blameHover = async (line: number) => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(line, 0),
    );
    return (hovers ?? [])
      .flatMap((hover) => hover.contents)
      .filter(
        (content): content is vscode.MarkdownString => content instanceof vscode.MarkdownString,
      )
      .map((content) => content.value.replaceAll("&nbsp;", " "))
      .find((text) => text.includes("Git Insights"));
  };
  await vscode.window.showTextDocument(document);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.match((await blameHover(0)) ?? "", /Host Test/);
  assert.match((await blameHover(0)) ?? "", /Fixture/);
  const insertion = new vscode.WorkspaceEdit();
  insertion.insert(document.uri, new vscode.Position(0, 0), "unsaved new line\n");
  await vscode.workspace.applyEdit(insertion);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.match((await blameHover(0)) ?? "", /Uncommitted changes/);
  assert.match((await blameHover(1)) ?? "", /Host Test/);
  await vscode.commands.executeCommand("workbench.action.files.revert");
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
  const graphOpen = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes("gitInsights.graph"),
      );
  for (let attempt = 0; attempt < 20 && !graphOpen(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes("gitInsights.graph"),
      ),
    "Repository graph opens in an editor tab",
  );
  console.log("Git Insights: extension host smoke tests passed");
}
