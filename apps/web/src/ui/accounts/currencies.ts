import { CURRENCY_EXPONENTS } from '@cashfold/core';

/** The currencies a person can pick for an account or a group, in code order. */
export const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).sort();
