import { SHELL_LANGUAGES, type ShellLanguage } from '@cashfold/platform';

// The words the shell itself shows: the custom menu entries and the start-up error dialog. Everything else in the window is the web app's, which
// follows the language chosen there. Standard menu items (Undo, Copy, Quit...) are roles, and the operating system already writes those.

export interface ShellLabels {
  readonly file: string;
  readonly edit: string;
  readonly view: string;
  readonly window: string;
  readonly onGitHub: (app: string) => string;
  readonly releaseNotes: string;
  readonly reportProblem: string;
  readonly notWritableTitle: string;
  readonly notWritableDetail: (folder: string) => string;
}

const LABELS: Readonly<Record<ShellLanguage, ShellLabels>> = {
  en: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    onGitHub: (app) => `${app} on GitHub`,
    releaseNotes: 'Release notes',
    reportProblem: 'Report a problem',
    notWritableTitle: 'Cashfold cannot save your data here',
    notWritableDetail: (folder) =>
      `The folder that holds your data is not writable:\n\n${folder}\n\nYour data has not been changed. Check that the folder and its disk are not read-only and that you may write to them, then start Cashfold again.`,
  },
  uk: {
    file: 'Файл',
    edit: 'Редагування',
    view: 'Вигляд',
    window: 'Вікно',
    onGitHub: (app) => `${app} на GitHub`,
    releaseNotes: 'Примітки до випуску',
    reportProblem: 'Повідомити про проблему',
    notWritableTitle: 'Cashfold не може зберегти ваші дані тут',
    notWritableDetail: (folder) =>
      `Папка з вашими даними недоступна для запису:\n\n${folder}\n\nВаші дані не змінено. Переконайтеся, що папка й диск не лише для читання і що у вас є право запису, а потім запустіть Cashfold знову.`,
  },
  pl: {
    file: 'Plik',
    edit: 'Edycja',
    view: 'Widok',
    window: 'Okno',
    onGitHub: (app) => `${app} na GitHub`,
    releaseNotes: 'Informacje o wydaniu',
    reportProblem: 'Zgłoś problem',
    notWritableTitle: 'Cashfold nie może tutaj zapisać Twoich danych',
    notWritableDetail: (folder) =>
      `Folder z Twoimi danymi nie jest zapisywalny:\n\n${folder}\n\nTwoje dane nie zostały zmienione. Sprawdź, czy folder i dysk nie są tylko do odczytu oraz czy masz prawo zapisu, a następnie uruchom Cashfold ponownie.`,
  },
};

export const labelsFor = (language: ShellLanguage): ShellLabels => LABELS[language];

/** The first of the system's preferred languages that the shell has words for, else English. Used before any window (or saved choice) exists. */
export function languageFromSystem(preferred: readonly string[]): ShellLanguage {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    const match = SHELL_LANGUAGES.find((language) => language === base);
    if (match !== undefined) return match;
  }
  return 'en';
}
