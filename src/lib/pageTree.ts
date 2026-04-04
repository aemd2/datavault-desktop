/**
 * Build a Notion-like hierarchy from flat `notion_pages` rows (parent_id edges).
 * Pages whose parent isn’t another synced page become top-level roots (workspace / DB parents).
 */

export type PageTreeNode = {
  id: string;
  title: string | null;
  parent_id: string | null;
  children: PageTreeNode[];
};

export function buildPageTree(
  pages: { id: string; title: string | null; parent_id: string | null }[],
): PageTreeNode[] {
  const idSet = new Set(pages.map((p) => p.id));
  const byParent = new Map<string | null, typeof pages>();

  for (const p of pages) {
    const parentKey =
      p.parent_id && idSet.has(p.parent_id) ? p.parent_id : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(p);
    byParent.set(parentKey, list);
  }

  function walk(parentKey: string | null): PageTreeNode[] {
    const list = byParent.get(parentKey) ?? [];
    return list
      .slice()
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }))
      .map((p) => ({
        id: p.id,
        title: p.title,
        parent_id: p.parent_id,
        children: walk(p.id),
      }));
  }

  return walk(null);
}
