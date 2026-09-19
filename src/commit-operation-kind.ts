export type OperationKind = "cherry-pick" | "reword";
export const isOperationKind = (value: unknown): value is OperationKind =>
  value === "cherry-pick" || value === "reword";
