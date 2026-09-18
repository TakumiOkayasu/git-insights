export const actions = ["pick", "reword", "edit", "squash", "fixup", "drop"] as const;
export type Action = (typeof actions)[number];
export interface TodoRow {
  id: number;
  action: Action;
  sha: string;
  message: string;
}
export interface Todo {
  rows: TodoRow[];
  lines: string[];
  slots: number[];
  eol: string;
  supported: boolean;
}
const aliases: Record<string, Action> = {
  p: "pick",
  r: "reword",
  e: "edit",
  s: "squash",
  f: "fixup",
  d: "drop",
};
export function parseTodo(text: string): Todo {
  const todo: Todo = {
    rows: [],
    lines: text.split(/\r?\n/),
    slots: [],
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    supported: true,
  };
  todo.lines.forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    const match = /^(\s*)(\S+)\s+([a-f0-9]{4,64})(?:\s+(.*))?$/.exec(line);
    const action = match && (aliases[match[2]] ?? match[2]);
    if (!match || !actions.includes(action as Action)) {
      todo.supported = false;
      return;
    }
    todo.slots.push(i);
    todo.rows.push({ id: i, action: action as Action, sha: match[3], message: match[4] ?? "" });
  });
  return todo;
}
export function serializeTodo(todo: Todo, rows: TodoRow[]): string {
  if (!todo.supported) throw new Error("Advanced rebase commands require the text editor.");
  if (rows.length !== todo.rows.length || new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Invalid rebase rows");
  let previous = false;
  const lines = [...todo.lines];
  rows.forEach((row, i) => {
    const original = todo.rows.find((r) => r.id === row.id);
    if (
      !original ||
      original.sha !== row.sha ||
      original.message !== row.message ||
      !actions.includes(row.action)
    )
      throw new Error("Invalid rebase row");
    if (["squash", "fixup"].includes(row.action) && !previous)
      throw new Error("Squash or fixup requires a preceding commit.");
    if (row.action !== "drop") previous = true;
    lines[todo.slots[i]] = `${row.action} ${row.sha}${row.message ? ` ${row.message}` : ""}`;
  });
  return lines.join(todo.eol);
}
