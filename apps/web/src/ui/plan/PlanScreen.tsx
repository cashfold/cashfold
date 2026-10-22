'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { Tabs } from '../kit';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import type { PlanView } from '../prefs/schema';
import { BudgetsView } from './BudgetsView';
import { GoalsView } from './GoalsView';
import { SchedulesView } from './SchedulesView';

const VIEWS: readonly PlanView[] = ['budgets', 'goals', 'schedules'];
const selectView = (p: { plan: { view: PlanView } }): PlanView => p.plan.view;

/** Budgets, Goals and Schedules as tabs of one section (FR-030). `?view=` selects; the last view is remembered on this device. */
export function PlanScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const requested = useSearchParams().get('view');
  const remembered = usePrefs(selectView);
  const view = VIEWS.find((v) => v === requested) ?? remembered;

  const change = (next: string) => {
    prefsStore.update((p) => (p.plan.view === next ? p : { ...p, plan: { view: next as PlanView } }));
    router.replace(`/plan/?view=${next}`);
  };

  return (
    <div>
      <Tabs
        value={view}
        onChange={change}
        label={t('plan.tab.label')}
        items={VIEWS.map((v) => ({ value: v, label: t(`plan.tab.${v}`) }))}
        className="mb-6"
      >
        {view === 'goals' ? <GoalsView /> : view === 'schedules' ? <SchedulesView /> : <BudgetsView />}
      </Tabs>
    </div>
  );
}
