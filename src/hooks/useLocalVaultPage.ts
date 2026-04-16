import { useQuery } from "@tanstack/react-query";

/**
 * Read a page's Markdown content from the local vault (Electron only).
 * Returns the raw .md string, or null if not found.
 */
export function useLocalVaultPage(connectorId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: ["vault-page", connectorId, pageId],
    enabled: !!connectorId && !!pageId && !!window.electronAPI?.vault,
    queryFn: async () => {
      const vault = window.electronAPI?.vault;
      if (!vault || !connectorId || !pageId) return null;
      return vault.readFile(`${connectorId}/pages/${pageId}.md`);
    },
    staleTime: 5 * 60 * 1000, // 5 min — local files don't change often
  });
}
