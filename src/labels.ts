export const labelKeys = [
  "File",
  "Line",
  "Refresh",
  "Pin",
  "Unpin",
  "Open diff",
  "Copy SHA",
  "Open on remote",
  "Today",
  "This week",
  "Last week",
  "Over a week ago",
  "Over a month ago",
  "Author",
  "Files changed",
  "Loading…",
  "No history found.",
  "Open a tracked file to see its history.",
  "Save",
  "Open as text",
  "Move up",
  "Move down",
  "Action",
  "Commit",
  "Rebase editor",
  "Save the plan, then close this tab to let Git continue.",
  "Advanced rebase commands require the text editor.",
  "History limit reached. Increase the limit in settings to see more.",
  "Commit or discard changes before viewing line history.",
  "Squash or fixup requires a preceding commit.",
  "The document changed. Review the updated plan and try again.",
] as const;
export type LabelKey = (typeof labelKeys)[number];
export type Labels = Readonly<Record<LabelKey, string>>;
export function translateLabels(translate: (key: LabelKey) => string): Labels {
  // Object.fromEntries loses literal keys; all keys originate from the closed tuple above.
  return Object.fromEntries(labelKeys.map((key) => [key, translate(key)])) as Labels;
}
