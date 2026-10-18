import * as vscode from "vscode";
import { remoteCommitUrl as resolveRemoteCommitUrl } from "./git";

export function remoteCommitUrl(
  resource: vscode.Uri,
  remote: string,
  sha: string,
): string | undefined {
  const projectUrl = vscode.workspace
    .getConfiguration("gitInsights", resource)
    .get<unknown>("gitlab.projectUrl", "");
  return resolveRemoteCommitUrl(remote, sha, projectUrl);
}
