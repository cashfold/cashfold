/** What survives switching between expense, income and transfer: the amount and the note typed so far. */
export interface Carry {
  amount: string;
  note: string;
}

// What a mode of the add sheet (transaction or transfer) tells the sheet around it.
export interface ModeReport {
  /** Whether the form holds something not saved yet (closing then asks first). */
  dirty(dirty: boolean): void;
  /** Whether a save is running (the Save button waits). */
  busy(busy: boolean): void;
  /** Whether the sheet shows the inline exchange-rate prompt instead of the form. */
  rateMode(on: boolean): void;
  /** The values worth keeping if the person switches to another mode; the sheet hands them to that mode when it opens. */
  carry(values: Carry): void;
  /** Saved: closes the sheet and announces `messageKey`. */
  done(messageKey: string): void;
}
