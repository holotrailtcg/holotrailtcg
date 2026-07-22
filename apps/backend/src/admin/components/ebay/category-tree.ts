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
