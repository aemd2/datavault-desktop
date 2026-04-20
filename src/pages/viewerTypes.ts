/**
 * Shared outlet context between viewer index (browse) and page reader routes.
 * Now supports multiple connector types (Notion, Trello, etc.) for dynamic UI/copy.
 * selectedConnector is the ID; we derive type from the connectors list.
 */
export type ViewerOutletContext = {
  selectedConnector: string | undefined;
  setSelectedConnector: (id: string | undefined) => void;
  /** "notion", "trello", etc. Used to change titles, copy, and rendered components. */
  connectorType?: string;
  /** Human readable name e.g. "Trello" or workspace name. */
  connectorLabel?: string;
};
