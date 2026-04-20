import { QueryClient } from "@tanstack/react-query";

/**
 * Single shared QueryClient for the app so non-hook code (e.g. OAuth helpers)
 * can invalidate caches after mutations complete.
 */
export const queryClient = new QueryClient();
