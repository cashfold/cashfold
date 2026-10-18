'use client';

import { normaliseServerAddress } from '@cashfold/core';
import { useState } from 'react';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

/** The service address field. The default comes from the build (NEXT_PUBLIC_DEFAULT_SERVER) and is never hard-coded; the user can change it (FR-099). */
export function ServerAddress({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string | undefined }) {
  const { t } = useI18n();
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.trim() !== '' && !normaliseServerAddress(value).ok ? t('signup.error.invalid_server') : undefined;
  return (
    <TextField
      label={t('signup.server.label')} type="url" inputMode="url" autoComplete="url" required placeholder="https://relay.example.com"
      value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)}
      hint={t('signup.server.hint')} error={error ?? invalid}
    />
  );
}
