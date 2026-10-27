import { createHandoff } from './handoff';

// A CSV file dropped on the window, or opened from the file manager, waits here until the import panel is on screen and takes it: the panel then shows
// it as chosen, with its preview, and nothing is imported until the person says so.
export const importHandoff = createHandoff<File>();
