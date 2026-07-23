export type StoreCategoryLike = {
  id: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
  siblingOrder: number;
  level: number;
  path: string;
  status: "ACTIVE" | "REMOVED";
};

export type CategoryTreeNode<T extends StoreCategoryLike> = T & {
  children: CategoryTreeNode<T>[];
  displayOrder: number;
};

/** Nests categories by `parentExternalId` and sorts siblings by `siblingOrder` (then name), matching the order shown on the eBay Store Categories page. */
export function buildCategoryTree<T extends StoreCategoryLike>(categories: T[]): CategoryTreeNode<T>[] {
  const nodesByExternalId = new Map<string, CategoryTreeNode<T>>(
    categories.map((category) => [
      category.externalId,
      { ...category, children: [], displayOrder: category.siblingOrder },
    ]),
  );
  const roots: CategoryTreeNode<T>[] = [];
  for (const node of nodesByExternalId.values()) {
    const parent = node.parentExternalId ? nodesByExternalId.get(node.parentExternalId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortAndNumber = (nodes: CategoryTreeNode<T>[]) => {
    nodes.sort((a, b) => a.siblingOrder - b.siblingOrder || a.name.localeCompare(b.name));
    nodes.forEach((node, index) => {
      node.displayOrder = index + 1;
      sortAndNumber(node.children);
    });
  };
  sortAndNumber(roots);
  return roots;
}

/**
 * Full breadcrumb ("Main Category - Sub Category - Third Category") for one
 * category id, walked live from `parentExternalId` links rather than trusted
 * from a stored `path` column — a `path` computed once at creation time can
 * go stale if a category is ever reparented, so this is guaranteed correct
 * regardless of that.
 */
export function categoryPathLabel<T extends StoreCategoryLike>(categories: T[], id: string | null, separator = " - "): string | null {
  if (!id) return null
  const byId = new Map(categories.map((category) => [category.id, category]))
  const byExternalId = new Map(categories.map((category) => [category.externalId, category]))
  const target = byId.get(id)
  if (!target) return null
  const names: string[] = []
  let current: T | undefined = target
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentExternalId ? byExternalId.get(current.parentExternalId) : undefined
  }
  return names.join(separator)
}

/** Flattens a category tree into the same top-to-bottom, parents-before-children order the hierarchy page renders, with a `depth` for indentation. */
export function flattenCategoryTree<T extends StoreCategoryLike>(
  nodes: CategoryTreeNode<T>[],
  depth = 0,
): Array<T & { depth: number }> {
  const result: Array<T & { depth: number }> = [];
  for (const node of nodes) {
    const { children, displayOrder: _displayOrder, ...rest } = node;
    result.push({ ...(rest as unknown as T), depth });
    result.push(...flattenCategoryTree(children, depth + 1));
  }
  return result;
}
