/**
 * Shared outlet context between viewer index (browse) and page reader routes.
 */
export type ViewerOutletContext = {
  selectedConnector: string | undefined;
  setSelectedConnector: (id: string | undefined) => void;
};
