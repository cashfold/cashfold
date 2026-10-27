import { requestPersistence } from '../../adapters/storage-persistence';
import { createInstallCapture, type InstallCapture } from './install-capture';

// The page's one capture. It is imported first by app/providers.tsx, so its listener exists before the page's own code runs and the browser's early
// install event is not missed. When the app is installed it asks the browser again to keep its data (spec 009, FR-012): installed apps are granted this
// more readily. The answer is read where it is shown (Settings, Data and storage); nothing is stored or sent here.
export const pageCapture: InstallCapture | undefined = typeof window === 'undefined'
  ? undefined
  : createInstallCapture(window, { onInstalled: () => void requestPersistence().catch(() => undefined) });
