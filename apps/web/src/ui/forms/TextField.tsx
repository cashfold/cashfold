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
