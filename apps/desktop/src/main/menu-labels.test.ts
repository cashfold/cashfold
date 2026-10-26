import { describe, expect, it } from 'vitest';
import { SHELL_LANGUAGES } from '@cashfold/platform';
import { problemMessage } from './data-folder';
import { labelsFor, languageFromSystem } from './menu-labels';

describe('the language the shell starts in', () => {
  it('is the first of the system languages it has words for', () => {
    expect(languageFromSystem(['pl-PL', 'en-US'])).toBe('pl');
    expect(languageFromSystem(['de-DE', 'uk'])).toBe('uk');
    expect(languageFromSystem(['uk_UA'])).toBe('uk');
    expect(languageFromSystem(['ru-RU', 'pl'])).toBe('pl');
  });

  it('is English for nothing it knows', () => {
    expect(languageFromSystem([])).toBe('en');
    expect(languageFromSystem(['de', 'fr', ''])).toBe('en');
  });
});

describe('the words the shell shows', () => {
  it('exist, and differ from English, in every language it offers', () => {
    const english = labelsFor('en');
    for (const language of SHELL_LANGUAGES.filter((l) => l !== 'en')) {
      const labels = labelsFor(language);
      for (const key of ['cut', 'copy', 'paste', 'selectAll', 'notWritableTitle'] as const) {
        expect(labels[key], `${language}.${key}`).toBeTruthy();
        expect(labels[key], `${language}.${key}`).not.toBe(english[key]);
      }
      expect(labels.notWritableDetail('/data')).toContain('/data');
    }
  });

  it('puts the folder in the start-up dialog, in the language it is asked for', () => {
    const message = problemMessage({ kind: 'not-writable' }, '/home/x/.config/Cashfold', 'pl');
    expect(message?.title).toBe('Cashfold nie może tutaj zapisać Twoich danych');
    expect(message?.detail).toContain('/home/x/.config/Cashfold');
    expect(problemMessage({ kind: 'not-writable' }, '/d')?.title).toBe('Cashfold cannot save your data here');
  });
});
