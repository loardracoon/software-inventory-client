import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { RequireAuth } from "@/features/auth/require-auth";
import { LoginPage } from "@/pages/login-page";
import { NotFoundPage } from "@/pages/not-found-page";

// One chunk per screen: the chart library only loads with the Overview.
const OverviewPage = lazy(() => import("@/pages/overview-page").then((m) => ({ default: m.OverviewPage })));
const ComputersPage = lazy(() => import("@/pages/computers-page").then((m) => ({ default: m.ComputersPage })));
const ComputerDetailPage = lazy(() => import("@/pages/computer-detail-page").then((m) => ({ default: m.ComputerDetailPage })));
const SoftwarePage = lazy(() => import("@/pages/software-page").then((m) => ({ default: m.SoftwarePage })));
const SoftwareTitlePage = lazy(() => import("@/pages/software-title-page").then((m) => ({ default: m.SoftwareTitlePage })));
const ChangesPage = lazy(() => import("@/pages/changes-page").then((m) => ({ default: m.ChangesPage })));
const ScansPage = lazy(() => import("@/pages/scans-page").then((m) => ({ default: m.ScansPage })));
const SettingsPage = lazy(() => import("@/pages/settings-page").then((m) => ({ default: m.SettingsPage })));

function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex items-center gap-3 py-12 text-text-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Loading
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Page><OverviewPage /></Page>} />
        <Route path="computers" element={<Page><ComputersPage /></Page>} />
        <Route path="computers/:id" element={<Page><ComputerDetailPage /></Page>} />
        <Route path="software" element={<Page><SoftwarePage /></Page>} />
        <Route path="software/:titleId" element={<Page><SoftwareTitlePage /></Page>} />
        <Route path="changes" element={<Page><ChangesPage /></Page>} />
        <Route path="scans" element={<Page><ScansPage /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
