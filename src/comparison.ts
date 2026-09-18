/** The current use case needs an action, not access to Git's internal revisions. */
export interface Comparison {
  open(): Promise<void>;
}
