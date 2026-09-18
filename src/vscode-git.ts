import type * as vscode from "vscode";
// The subset of the built-in Git extension API this adapter actually consumes.
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { readonly onDidChange: vscode.Event<void> };
}
export interface BuiltinGitApi {
  readonly git: { readonly path: string };
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
}
export interface BuiltinGitExtension {
  getAPI(version: 1): BuiltinGitApi;
}
