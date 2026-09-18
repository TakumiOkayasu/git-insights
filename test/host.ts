import * as vscode from "vscode";
import assert from "node:assert/strict";
export async function run() {
  const extension = vscode.extensions.getExtension("TakumiOkayasu.git-insights");
  assert.ok(extension, "Extension discovered");
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["fileHistory", "lineHistory", "refresh", "openRebase"])
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
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
    "vscode.executeCodeLensProvider",
    document.uri,
  );
  assert.ok(
    lenses?.some(
      (l) =>
        l.command?.command === "gitInsights.fileHistory" && l.command.title.includes("Host Test"),
    ),
    "CodeLens shows real Git author",
  );
  await vscode.commands.executeCommand("gitInsights.fileHistory");
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
  console.log("Git Insights: extension host smoke tests passed");
}
