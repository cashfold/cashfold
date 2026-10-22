'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { REDIRECTS, redirectTarget } from './routes';

/**
 * The page behind an old address (FR-006): it sends the person to the new place, keeping the query string, and offers a plain link without
 * scripts. The static export has no server redirect, so this is a tiny client page; no old screen is rendered here.
 */
export function RedirectStub({ from }: { from: string }) {
  const router = useRouter();
  const target = redirectTarget(from, '') ?? '/overview/';
  useEffect(() => {
    router.replace(redirectTarget(from, window.location.search) ?? target);
  }, [router, from, target]);
  return (
    <noscript>
      <a href={target}>{target}</a>
    </noscript>
  );
}

export { REDIRECTS };
