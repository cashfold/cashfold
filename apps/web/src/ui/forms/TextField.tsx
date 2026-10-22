'use client';

import type { ComponentProps, ReactNode } from 'react';
import { InputField } from './Field';

interface Props extends Omit<ComponentProps<typeof InputField>, 'label' | 'hint' | 'error' | 'className'> {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
}

/** A labelled input whose hint and error are announced with it (kit-based; see forms/Field). */
export function TextField({ label, hint, error, ...input }: Props) {
  return <InputField className="mt-4" label={label} hint={hint} error={error} {...input} />;
}

export const buttonClass = 'rounded-lg bg-(--primary) px-4 py-2 font-medium text-(--on-primary) disabled:opacity-60';
export const secondaryButtonClass = 'rounded-lg border border-zinc-950/15 px-4 py-2 font-medium dark:border-white/20';
