// What a masked amount looks like (spec 016, contracts/ui-contract.md §3): a fixed row of dots and the currency code, so the figure, its sign and its
// size are not shown, but a screen with several currencies stays readable.

export const MASK = '••••';

/** "•••• USD". The currency code is kept (spec 016, clarification 2). */
export const maskedMoney = (currency: string): string => `${MASK} ${currency}`;

/** The width of a masked amount, in a class (the strict CSP forbids inline styles). Wide enough for a typical figure with its sign and currency code ("+1,234.56 USD"), so revealing one does not move its neighbours. */
export const MASK_WIDTH_CLASS = 'inline-block min-w-[14ch] text-end';
