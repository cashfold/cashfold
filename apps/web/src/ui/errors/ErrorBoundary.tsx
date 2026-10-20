'use client';

import { Component, type ReactNode } from 'react';
import { createAppLogger, createConsoleSink } from '../../adapters/logger';

const log = createAppLogger([createConsoleSink()]);

/** Catches render errors. Logs only the error's name, never its message, and offers a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode; title: string; reload: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    log.error('ui.render_crashed', { error });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-prose p-6">
        <h1 className="text-xl font-semibold">{this.props.title}</h1>
        <button type="button" className="mt-4 rounded-ui bg-primary px-4 py-2 text-on-primary" onClick={() => location.reload()}>
          {this.props.reload}
        </button>
      </div>
    );
  }
}
