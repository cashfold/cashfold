// An action of a row (a transaction, a transfer, an account). One list per row type serves both the "actions" button and the desktop app's
// right-click menu, so the two cannot differ (spec 006, FR-012).
export interface RowAction {
  /** Short and lower-case: it is also the id the native menu answers with. */
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}
