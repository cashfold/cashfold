import { createLogger, type LogEntry, type Logger, type LogSink } from '@cashfold/core';

// The app logs to two places only: the browser console (warnings and errors, for developers) and an in-memory
// ring buffer (for a diagnostics screen). Nothing is persisted or sent anywhere (FR-016). Entries are already
// sanitised by the core logger before they reach a sink.

export function createConsoleSink(): LogSink {
  return (entry) => {
    if (entry.level === 'warn') console.warn(entry.event, entry.fields);
    else if (entry.level === 'error') console.error(entry.event, entry.fields);
  };
}

export interface RingSink {
  readonly sink: LogSink;
  entries(): readonly LogEntry[];
  clear(): void;
}

export function createRingSink(capacity: number): RingSink {
  let buffer: LogEntry[] = [];
  return {
    sink(entry) {
      buffer = [...buffer, entry].slice(-capacity);
    },
    entries: () => buffer,
    clear() {
      buffer = [];
    },
  };
}

export function createAppLogger(sinks: readonly LogSink[]): Logger {
  return createLogger({ sink: (entry) => sinks.forEach((s) => s(entry)) });
}
