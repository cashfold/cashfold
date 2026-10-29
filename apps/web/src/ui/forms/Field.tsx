'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Description, ErrorMessage, Field, Input, Label, Select, Textarea } from '../kit';

// Labelled fields built from the kit (FR-010): the label above, the hint below, and an error that replaces the hint, is announced as an alert and
// is tied to the control (`aria-invalid`, `aria-describedby`, wired by Headless UI's Field).
type Shared = { label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string };
const note = (hint: ReactNode, error: ReactNode) => (error ? <ErrorMessage>{error}</ErrorMessage> : hint ? <Description>{hint}</Description> : null);

export function InputField({ label, hint, error, className, ...input }: Shared & Omit<ComponentProps<typeof Input>, 'className' | 'invalid'>) {
  return (
    <Field {...(className === undefined ? {} : { className })}>
      <Label>{label}</Label>
      <Input invalid={Boolean(error)} {...input} />
      {note(hint, error)}
    </Field>
  );
}

export function SelectField<T extends string | number>({ label, hint, error, className, children, ...select }: Shared & Omit<ComponentProps<typeof Select<T>>, 'className' | 'invalid'>) {
  return (
    <Field {...(className === undefined ? {} : { className })}>
      <Label>{label}</Label>
      <Select invalid={Boolean(error)} {...select}>{children}</Select>
      {note(hint, error)}
    </Field>
  );
}

export function TextareaField({ label, hint, error, className, ...area }: Shared & Omit<ComponentProps<typeof Textarea>, 'className' | 'invalid'>) {
  return (
    <Field {...(className === undefined ? {} : { className })}>
      <Label>{label}</Label>
      <Textarea invalid={Boolean(error)} {...area} />
      {note(hint, error)}
    </Field>
  );
}
