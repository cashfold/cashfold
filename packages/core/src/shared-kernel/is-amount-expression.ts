// Whether a typed amount is a sum (spec 020). Kept in its own tiny module so the screens can ask on every keystroke without loading the evaluator,
// which is a separate chunk (`amount-expression.ts`, loaded by the ledger once it is in use).

const OPERATORS = new Set(['+', '-', '\u2212', '*', '\u00d7', 'x', 'X', '/', '\u00f7', '(', ')']);

/** Whether the text is a sum: an operator other than one leading sign, or a bracket. A plain or signed number is not, and keeps the rules of a plain amount. */
export function isAmountExpression(text: string): boolean {
  const body = text.trim();
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (!OPERATORS.has(ch)) continue;
    if (i === 0 && (ch === '+' || ch === '-' || ch === '\u2212')) continue;
    return true;
  }
  return false;
}
