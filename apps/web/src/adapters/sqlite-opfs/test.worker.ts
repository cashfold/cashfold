import { scenarios, type ScenarioContext, type ScenarioName } from './test-scenarios.js';

// Hosts scenarios in a dedicated worker, which is where OPFS access handles are available.
self.onmessage = async (ev: MessageEvent<{ scenario: ScenarioName; ctx: ScenarioContext }>) => {
  try {
    const result = await scenarios[ev.data.scenario](ev.data.ctx);
    self.postMessage({ ok: true, result });
  } catch (e) {
    self.postMessage({ ok: false, error: `${(e as Error).stack ?? e}` });
  }
};
