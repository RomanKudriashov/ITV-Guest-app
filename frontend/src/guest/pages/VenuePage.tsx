import { useParams } from 'react-router-dom';

import { CatalogPage } from './CatalogPage';

/**
 * Level 3 — a single venue's product catalog. It is the very same reference
 * catalog screen, only scoped to the venue's execution point via `point`.
 */
export function VenuePage() {
  const { code = '' } = useParams<{ code: string }>();
  return <CatalogPage type="product" point={code} />;
}
