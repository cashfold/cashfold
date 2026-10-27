/** A drag that carries files (not text or a link dragged in the page). */
export const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** A file input handles a drop on itself; the guard must leave that alone. */
export const isFileInput = (target: EventTarget | null): boolean => target instanceof HTMLInputElement && target.type === 'file';
