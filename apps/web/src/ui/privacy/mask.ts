import { separatorsFor } from '../i18n/i18n';

// What a masked amount looks like (spec 016, contracts/ui-contract.md §3): a fixed placeholder of zeros in the shape of a figure, blurred, and the currency
// code. The zeros are the same for every amount, whatever its size, so nothing about the figure, its sign or how many digits it has can be read from them.
// The real figure is never formatted while masked.

/** "0,000.00" with the locale's own marks. A constant: it is not made from the figure it stands in for. */
export function maskedFigure(locale: string): string {
  const { group, decimal } = separatorsFor(locale);
  return `0${group}000${decimal}00`;
}

/** "0,000.00 USD", for the places that can only hold plain text. The currency code is kept (spec 016, clarification 2). */
export const maskedMoney = (currency: string, locale: string): string => `${maskedFigure(locale)} ${currency}`;

/**
 * How the zeros are drawn: as generated content from the `data-zeros` attribute, blurred, so they read as a hidden figure and not as a balance of nothing.
 * The blur is a fraction of the text size (0.4em), so it hides large figures as well as small ones. They are not a text node, so no digit is in the page text for a reader, a copy or a search to find, and the visible text matches the button's name
 * (WCAG 2.5.3). A class, because the strict CSP forbids inline styles.
 */
export const MASK_FIGURE_CLASS = 'inline-block blur-[0.4em] select-none before:content-[attr(data-zeros)]';

/** The width of a masked amount, in a class. Wide enough for a typical figure with its sign and currency code ("+1,234.56 USD"), so revealing one does not move its neighbours. */
export const MASK_WIDTH_CLASS = 'inline-block min-w-[14ch] text-end';
