import { uuidV5, type Id } from '../../shared-kernel/id';
import type { Direction } from './category';

// The default category set (contracts/default-categories.md): original to Cashfold, two levels, created once when
// a Fold is created as ordinary editable records. Ids are UUIDv5(fold_id, key) so a fresh Fold gets the same ids
// on every device and two devices creating the set concurrently converge on the same records.

interface Root {
  readonly key: string;
  readonly direction: Direction;
  readonly name: string;
  readonly children: readonly string[];
}

const ROOTS: readonly Root[] = [
  { key: 'expense.food', direction: 'expense', name: 'Food & Drink', children: ['Groceries', 'Restaurants', 'Coffee & Snacks'] },
  { key: 'expense.home', direction: 'expense', name: 'Home', children: ['Rent or Mortgage', 'Utilities', 'Maintenance', 'Furnishings'] },
  { key: 'expense.transport', direction: 'expense', name: 'Transport', children: ['Fuel', 'Public Transit', 'Taxi & Rideshare', 'Parking', 'Vehicle Maintenance'] },
  { key: 'expense.health', direction: 'expense', name: 'Health', children: ['Doctor', 'Pharmacy', 'Insurance', 'Fitness'] },
  { key: 'expense.personal', direction: 'expense', name: 'Personal', children: ['Clothing', 'Beauty & Care', 'Gifts'] },
  { key: 'expense.leisure', direction: 'expense', name: 'Leisure', children: ['Entertainment', 'Hobbies', 'Subscriptions', 'Travel'] },
  { key: 'expense.family', direction: 'expense', name: 'Family', children: ['Childcare', 'Education', 'Pets'] },
  { key: 'expense.finance', direction: 'expense', name: 'Finance', children: ['Fees & Charges', 'Taxes', 'Loan Interest'] },
  { key: 'expense.other', direction: 'expense', name: 'Other', children: [] },
  { key: 'income.work', direction: 'income', name: 'Work', children: ['Salary', 'Bonus', 'Freelance'] },
  { key: 'income.investment', direction: 'income', name: 'Investments', children: ['Interest', 'Dividends'] },
  { key: 'income.other', direction: 'income', name: 'Other income', children: ['Refunds', 'Gifts Received', 'Reimbursements'] },
];

export const slug = (text: string): string => text.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface DefaultCategory {
  readonly key: string;
  readonly id: Id;
  readonly parentId: Id | null;
  readonly direction: Direction;
  readonly name: string;
  /** Index into the app's category colour tokens. */
  readonly color: number;
  readonly sortOrder: number;
}

const PALETTE_SIZE = 12;

/**
 * The set for one Fold. Ids and keys come from the English names and never change; `names` (key to display name) lets the app create the
 * records in the person's language. A key it does not mention, or a blank name, keeps the English one. `core` holds no translations itself.
 */
export function defaultCategories(fold: Id, names: Readonly<Record<string, string>> = {}): readonly DefaultCategory[] {
  const nameOf = (key: string, english: string): string => {
    const given = names[key]?.trim();
    return given === undefined || given === '' ? english : given;
  };
  const out: DefaultCategory[] = [];
  ROOTS.forEach((root, rootIndex) => {
    const rootId = uuidV5(fold, root.key);
    const color = rootIndex % PALETTE_SIZE;
    out.push({ key: root.key, id: rootId, parentId: null, direction: root.direction, name: nameOf(root.key, root.name), color, sortOrder: rootIndex });
    root.children.forEach((child, i) => {
      const key = `${root.key}.${slug(child)}`;
      out.push({ key, id: uuidV5(fold, key), parentId: rootId, direction: root.direction, name: nameOf(key, child), color, sortOrder: i });
    });
  });
  return out;
}
