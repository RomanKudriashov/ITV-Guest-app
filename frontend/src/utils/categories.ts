import type { Category } from '@/api/types';

export interface FlatCategory {
  category: Category;
  depth: number;
}

/** Depth-first flattening of the category tree for rendering / selects. */
export function flattenCategories(tree: Category[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const category of tree) {
    result.push({ category, depth });
    if (category.children?.length) {
      result.push(...flattenCategories(category.children, depth + 1));
    }
  }
  return result;
}

export function findCategory(tree: Category[], id: string): Category | null {
  for (const category of tree) {
    if (category.id === id) return category;
    const found = category.children?.length ? findCategory(category.children, id) : null;
    if (found) return found;
  }
  return null;
}

/** Siblings of a node (the children array it belongs to). */
export function siblingsOf(tree: Category[], parentId: string | null): Category[] {
  if (parentId === null) return tree;
  const parent = findCategory(tree, parentId);
  return parent?.children ?? [];
}

/** Ids of a node and everything below it — used to forbid cyclic re-parenting. */
export function subtreeIds(category: Category): string[] {
  const ids = [category.id];
  for (const child of category.children ?? []) ids.push(...subtreeIds(child));
  return ids;
}

/** Replaces the children array of `parentId` (null = roots) with `next`. */
export function replaceSiblings(
  tree: Category[],
  parentId: string | null,
  next: Category[],
): Category[] {
  if (parentId === null) return next;
  return tree.map((category) => {
    if (category.id === parentId) return { ...category, children: next };
    if (category.children?.length) {
      return { ...category, children: replaceSiblings(category.children, parentId, next) };
    }
    return category;
  });
}

export function totalItemsCount(category: Category): number {
  let total = category.items_count ?? 0;
  for (const child of category.children ?? []) total += totalItemsCount(child);
  return total;
}
