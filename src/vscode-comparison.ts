import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { ComparisonPresentation } from "./git-comparison";
export function createComparisonPresenter(revisions: Map<string, string>) {
  return async (value: ComparisonPresentation): Promise<void> => {
    const uri = (text: string, side: "before" | "after") => {
      const key = vscode.Uri.from({
        scheme: "git-insights",
        path: `/${value.file}`,
        query: `${value.revision}-${side}-${randomBytes(6).toString("hex")}`,
      });
      revisions.set(key.toString(), text);
      return key;
    };
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri(value.before, "before"),
      uri(value.after, "after"),
      `${path.basename(value.file)} (${value.revision.slice(0, 8)})`,
    );
  };
}
