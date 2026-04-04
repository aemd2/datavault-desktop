import { Route, Routes } from "react-router-dom";
import { AuthGuard } from "@/components/AuthGuard";
import { ViewerLayout } from "@/pages/ViewerLayout";
import { ViewerBrowse } from "@/pages/ViewerBrowse";
import { ViewerPageRead } from "@/pages/ViewerPageRead";

/**
 * Authenticated /viewer/* — browse tree, read pages, download ZIP.
 */
const Viewer = () => (
  <AuthGuard>
    <Routes>
      <Route element={<ViewerLayout />}>
        <Route index element={<ViewerBrowse />} />
        <Route path="page/:pageId" element={<ViewerPageRead />} />
      </Route>
    </Routes>
  </AuthGuard>
);

export default Viewer;
