import { uuidV5, type Id } from '../../shared-kernel/id';
import type { Direction } from './category';

// The default category set (contracts/default-categories.md): original to Cashfold, two levels, created once when
// a Fold is created as ordinary editable records. Ids are UUIDv5(fold_id, key) so a fresh Fold gets the same ids
// on every device and two devices creating the set concurrently converge on the same records.

interface Root {
  readonly key: string;
  readonly direction: Direction;
  readonly name: string;
  readonly icon: string;
  readonly children: readonly string[];
}

const ROOTS: readonly Root[] = [
  { key: 'expense.food', direction: 'expense', name: 'Food & Drink', icon: 'utensils', children: ['Groceries', 'Restaurants', 'Coffee & Snacks'] },
  { key: 'expense.home', direction: 'expense', name: 'Home', icon: 'home', children: ['Rent or Mortgage', 'Utilities', 'Maintenance', 'Furnishings'] },
  { key: 'expense.transport', direction: 'expense', name: 'Transport', icon: 'bus', children: ['Fuel', 'Public Transit', 'Taxi & Rideshare', 'Parking', 'Vehicle Maintenance'] },
  { key: 'expense.health', direction: 'expense', name: 'Health', icon: 'heart', children: ['Doctor', 'Pharmacy', 'Insurance', 'Fitness'] },
  { key: 'expense.personal', direction: 'expense', name: 'Personal', icon: 'user', children: ['Clothing', 'Beauty & Care', 'Gifts'] },
  { key: 'expense.leisure', direction: 'expense', name: 'Leisure', icon: 'ticket', children: ['Entertainment', 'Hobbies', 'Subscriptions', 'Travel'] },
  { key: 'expense.family', direction: 'expense', name: 'Family', icon: 'users', children: ['Childcare', 'Education', 'Pets'] },
  { key: 'expense.finance', direction: 'expense', name: 'Finance', icon: 'landmark', children: ['Fees & Charges', 'Taxes', 'Loan Interest'] },
  { key: 'expense.other', direction: 'expense', name: 'Other', icon: 'tag', children: [] },
  { key: 'income.work', direction: 'income', name: 'Work', icon: 'briefcase', children: ['Salary', 'Bonus', 'Freelance'] },
  { key: 'income.investment', direction: 'income', name: 'Investments', icon: 'trending-up', children: ['Interest', 'Dividends'] },
  { key: 'income.other', direction: 'income', name: 'Other income', icon: 'coins', children: ['Refunds', 'Gifts Received', 'Reimbursements'] },
];

export const slug = (text: string): string => text.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface DefaultCategory {
  readonly key: string;
  readonly id: Id;
  readonly parentId: Id | null;
  readonly direction: Direction;
  readonly name: string;
  readonly icon: string;
  /** Index into the app's category colour tokens. */
  readonly color: number;
  readonly sortOrder: number;
}

const PALETTE_SIZE = 12;

export function defaultCategories(fold: Id): readonly DefaultCategory[] {
  const out: DefaultCategory[] = [];
  ROOTS.forEach((root, rootIndex) => {
    const rootId = uuidV5(fold, root.key);
    const color = rootIndex % PALETTE_SIZE;
    out.push({ key: root.key, id: rootId, parentId: null, direction: root.direction, name: root.name, icon: root.icon, color, sortOrder: rootIndex });
    root.children.forEach((child, i) => {
      const key = `${root.key}.${slug(child)}`;
      out.push({ key, id: uuidV5(fold, key), parentId: rootId, direction: root.direction, name: child, icon: root.icon, color, sortOrder: i });
    });
  });
  return out;
}
