import { createHandoff } from './handoff';

// A backup opened from the file manager waits here until the restore form is on screen and takes it: the form shows it as chosen and asks for the
// passphrase. Nothing is restored until the person has typed it and chosen to restore.
export const restoreHandoff = createHandoff<File>();
