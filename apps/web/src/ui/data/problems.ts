/** Every reason a row of a CSV file can be refused, each with a sentence of its own (`data.import.problem.*`). */
export const IMPORT_PROBLEMS = ['bad_date', 'bad_time', 'bad_amount', 'amount_zero', 'both_income_and_expense', 'no_amount', 'wrong_currency', 'transfer_row', 'bad_type', 'too_long', 'before_opening', 'account_not_allowed', 'missing_cell'] as const;
