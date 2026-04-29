import type { ConnectorRow } from "@/hooks/useConnectors";

/**
 * Shared outlet context between viewer index (browse) and page reader routes.
 * Now supports multiple connector types (Notion, Trello, etc.) for dynamic UI/copy.
 * selectedConnector is the ID; we derive type from the connectors list.
 */
export type ViewerOutletContext = {
  selectedConnector: string | undefined;
  setSelectedConnector: (id: string | undefined) => void;
  /**
   * Lower-case connector type, e.g. "notion", "trello", "asana".
   * When the user has selected "All workspaces" this will be "all".
   */
  connectorType?: string;
  /** Human readable name e.g. "Trello" or workspace name. */
  connectorLabel?: string;
  /** Full list of connectors — used to render the "All workspaces" overview. */
  connectors?: ConnectorRow[];
};
