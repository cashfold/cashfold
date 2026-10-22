'use client';

import { Component, type ReactNode } from 'react';
import { createAppLogger, createConsoleSink } from '../../adapters/logger';
import { Button } from '../kit';

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
        <Button className="mt-4" type="button" onClick={() => location.reload()}>
          {this.props.reload}
        </Button>
      </div>
    );
  }
}
