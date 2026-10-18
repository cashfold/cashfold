'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
}

/** A labelled input whose hint and error are announced with it. */
export function TextField({ label, hint, error, ...input }: Props) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-medium">{label}</label>
      {hint ? <p id={`${id}-hint`} className="mt-1 text-sm text-muted">{hint}</p> : null}
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2 text-text"
        {...input}
      />
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export const buttonClass = 'rounded-ui bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-60';
export const secondaryButtonClass = 'rounded-ui border border-border-strong px-4 py-2 font-medium';
