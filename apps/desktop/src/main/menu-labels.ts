import { SHELL_LANGUAGES, type ShellLanguage } from '@cashfold/platform';

// The words the shell itself shows: the text-field menu and the start-up error dialog. Everything else in the window is the web app's, which
// follows the language chosen there. The macOS app menu's items are roles, and the operating system already writes those.

export interface ShellLabels {
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly selectAll: string;
  // The tray or menu-bar item, the macOS dock menu and the Windows jump list (nothing here names a Fold or an amount).
  readonly trayShow: string;
  readonly trayAddTransaction: string;
  readonly trayLock: string;
  readonly trayQuit: string;
  readonly recentFolds: string;
  /** The accessible description of the taskbar count on Windows. */
  readonly badgeDescription: (count: number) => string;
  readonly notWritableTitle: string;
  readonly notWritableDetail: (folder: string) => string;
}

const LABELS: Readonly<Record<ShellLanguage, ShellLabels>> = {
  en: {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    trayShow: 'Show Cashfold',
    trayAddTransaction: 'Add transaction',
    trayLock: 'Lock',
    trayQuit: 'Quit',
    recentFolds: 'Recent Folds',
    badgeDescription: (count) => `${count} waiting for confirmation`,
    notWritableTitle: 'Cashfold cannot save your data here',
    notWritableDetail: (folder) =>
      `The folder that holds your data is not writable:\n\n${folder}\n\nYour data has not been changed. Check that the folder and its disk are not read-only and that you may write to them, then start Cashfold again.`,
  },
  uk: {
    cut: 'Вирізати',
    copy: 'Копіювати',
    paste: 'Вставити',
    selectAll: 'Вибрати все',
    trayShow: 'Показати Cashfold',
    trayAddTransaction: 'Додати транзакцію',
    trayLock: 'Заблокувати',
    trayQuit: 'Вийти',
    recentFolds: 'Останні простори',
    badgeDescription: (count) => `Очікують підтвердження: ${count}`,
    notWritableTitle: 'Cashfold не може зберегти ваші дані тут',
    notWritableDetail: (folder) =>
      `Папка з вашими даними недоступна для запису:\n\n${folder}\n\nВаші дані не змінено. Переконайтеся, що папка й диск не лише для читання і що у вас є право запису, а потім запустіть Cashfold знову.`,
  },
  pl: {
    cut: 'Wytnij',
    copy: 'Kopiuj',
    paste: 'Wklej',
    selectAll: 'Zaznacz wszystko',
    trayShow: 'Pokaż Cashfold',
    trayAddTransaction: 'Dodaj transakcję',
    trayLock: 'Zablokuj',
    trayQuit: 'Zakończ',
    recentFolds: 'Ostatnie przestrzenie',
    badgeDescription: (count) => `Oczekujące na potwierdzenie: ${count}`,
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
