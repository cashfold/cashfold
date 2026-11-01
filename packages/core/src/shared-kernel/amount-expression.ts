import { readDecimal, type AmountTextError, type Separators } from './amount-text';
import { exponentOf, type CurrencyCode } from './currency';
import { divRoundHalfEven, money, type Money } from './money';
import { err, ok, type Result } from './result';

// Sums in an amount field (spec 020): "12.50 + 3.20 * 2 + 4". Numbers are read with the language's marks, the arithmetic is exact (a value is a fraction
// of two bigints, so 10 / 3 * 3 is exactly 10), and the result is rounded once, at the end, half to even, to the currency's minor units (constitution VI).
// Nothing here uses floating point, `eval` or a library.

export const MAX_EXPRESSION_LENGTH = 200;
export const MAX_BRACKET_DEPTH = 20;

const ADD = new Set(['+']);
const SUBTRACT = new Set(['-', '−']);
const MULTIPLY = new Set(['*', '×', 'x', 'X']);
const DIVIDE = new Set(['/', '÷']);
const isOperatorChar = (ch: string): boolean => ADD.has(ch) || SUBTRACT.has(ch) || MULTIPLY.has(ch) || DIVIDE.has(ch) || ch === '(' || ch === ')';

export { isAmountExpression } from './is-amount-expression';

interface Fraction {
  readonly n: bigint;
  readonly d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

function fraction(n: bigint, d: bigint): Fraction {
  const g = gcd(n, d);
  const sign = d < 0n ? -1n : 1n;
  return g === 0n ? { n: 0n, d: 1n } : { n: (sign * n) / g, d: (sign * d) / g };
}

type Token = { readonly kind: 'op'; readonly ch: string } | { readonly kind: 'num'; readonly value: Fraction };

type Node =
  | { readonly kind: 'num'; readonly value: Fraction }
  | { readonly kind: 'neg'; readonly of: Node }
  | { readonly kind: 'bin'; readonly op: '+' | '-' | '*' | '/'; readonly left: Node; readonly right: Node };

const INVALID = err('invalid_format', 'Not a valid amount');
type Failure = typeof INVALID;
const invalid = (): Failure => INVALID;

const isNumberChar = (ch: string, sep: Separators): boolean => /\d/.test(ch) || ch === sep.decimal || ch === sep.group || ch === '.' || ch === ',' || /\s/u.test(ch);

/** One operand, with today's typing leniency: any space for a space group mark, and one dot for the decimal comma (where a dot is not the group mark). */
function readOperand(raw: string, sep: Separators): Fraction | undefined {
  let text = raw.trim();
  if (text === '') return undefined;
  if (/^\s$/u.test(sep.group)) text = text.replace(/\s+/gu, sep.group);
  if (sep.decimal === ',' && sep.group !== '.' && !text.includes(',') && text.split('.').length === 2) text = text.replace('.', sep.decimal);
  const read = readDecimal(text, sep);
  if (read === undefined) return undefined;
  const digits = `${read.intDigits === '' ? '0' : read.intDigits}${read.frac}`;
  return fraction(BigInt(digits), 10n ** BigInt(read.frac.length));
}

function tokenise(text: string, sep: Separators): Token[] | undefined {
  const tokens: Token[] = [];
  let run = '';
  const flush = (): boolean => {
    if (run.trim() === '') {
      run = '';
      return true;
    }
    const value = readOperand(run, sep);
    run = '';
    if (value === undefined) return false;
    tokens.push({ kind: 'num', value });
    return true;
  };
  for (const ch of text) {
    if (isOperatorChar(ch)) {
      if (!flush()) return undefined;
      tokens.push({ kind: 'op', ch });
    } else if (isNumberChar(ch, sep)) {
      run += ch;
    } else {
      return undefined;
    }
  }
  return flush() ? tokens : undefined;
}

/** expr := term (('+' | '-') term)* ; term := unary (('*' | '/') unary)* ; unary := '-' primary | primary ; primary := number | '(' expr ')'. */
function parse(tokens: readonly Token[]): Node | undefined {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const opAt = (set: ReadonlySet<string>): string | undefined => {
    const t = peek();
    return t !== undefined && t.kind === 'op' && set.has(t.ch) ? t.ch : undefined;
  };

  const primary = (depth: number): Node | undefined => {
    const t = peek();
    if (t === undefined) return undefined;
    if (t.kind === 'num') {
      pos++;
      return t;
    }
    if (t.ch !== '(' || depth >= MAX_BRACKET_DEPTH) return undefined;
    pos++;
    const inner = expr(depth + 1);
    const close = peek();
    if (inner === undefined || close === undefined || close.kind !== 'op' || close.ch !== ')') return undefined;
    pos++;
    return inner;
  };
  const unary = (depth: number): Node | undefined => {
    if (opAt(SUBTRACT) !== undefined) {
      pos++;
      const of = primary(depth);
      return of === undefined ? undefined : { kind: 'neg', of };
    }
    return primary(depth);
  };
  const term = (depth: number): Node | undefined => {
    let left = unary(depth);
    for (;;) {
      if (left === undefined) return undefined;
      const mul = opAt(MULTIPLY) !== undefined;
      const div = opAt(DIVIDE) !== undefined;
      if (!mul && !div) return left;
      pos++;
      const right = unary(depth);
      if (right === undefined) return undefined;
      left = { kind: 'bin', op: mul ? '*' : '/', left, right };
    }
  };
  const expr = (depth: number): Node | undefined => {
    let left = term(depth);
    for (;;) {
      if (left === undefined) return undefined;
      const add = opAt(ADD) !== undefined;
      const sub = opAt(SUBTRACT) !== undefined;
      if (!add && !sub) return left;
      pos++;
      const right = term(depth);
      if (right === undefined) return undefined;
      left = { kind: 'bin', op: add ? '+' : '-', left, right };
    }
  };

  // A leading plus is allowed, as a plain amount allows one ("+5 + 1"); a plus anywhere else is not.
  if (opAt(ADD) !== undefined) pos++;
  const root = expr(0);
  return root !== undefined && pos === tokens.length ? root : undefined;
}

/** The exact value of the tree, or `undefined` for a division by zero. */
function value(node: Node): Fraction | undefined {
  if (node.kind === 'num') return node.value;
  if (node.kind === 'neg') {
    const v = value(node.of);
    return v === undefined ? undefined : { n: -v.n, d: v.d };
  }
  const a = value(node.left);
  const b = value(node.right);
  if (a === undefined || b === undefined) return undefined;
  switch (node.op) {
    case '+': return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
    case '-': return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
    case '*': return fraction(a.n * b.n, a.d * b.d);
    case '/': return b.n === 0n ? undefined : fraction(a.n * b.d, a.d * b.n);
  }
}

/**
 * Evaluates a sum exactly and rounds once, half to even, to the currency's minor units. Same `Result` as `parseAmountText`, plus `division_by_zero`.
 * Never throws. An operand may have more decimals than the currency: only the result is rounded.
 */
export function evaluateAmount(text: string, currency: CurrencyCode, sep: Separators): Result<Money, AmountTextError> {
  if (text.length > MAX_EXPRESSION_LENGTH) return invalid();
  const tokens = tokenise(text, sep);
  if (tokens === undefined || tokens.length === 0) return invalid();
  const tree = parse(tokens);
  if (tree === undefined) return invalid();
  const exact = value(tree);
  if (exact === undefined) return err('division_by_zero', 'Cannot divide by zero');
  const minor = divRoundHalfEven(exact.n * 10n ** BigInt(exponentOf(currency)), exact.d);
  const result = money(minor, currency);
  return result.ok ? ok(result.value) : result;
}
