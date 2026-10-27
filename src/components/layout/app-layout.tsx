import { useState } from "react";
import { Outlet } from "react-router";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { GlobalSearch } from "./global-search";
import { SidebarNav } from "./sidebar-nav";
import { TenantSwitcher } from "./tenant-switcher";
import { UserMenu } from "./user-menu";

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-svh bg-surface-subtle">
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-surface-raised px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-svh w-[232px] shrink-0 lg:block">
        <SidebarNav />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-[264px] border-0 bg-dark-blue p-0 text-white">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main sections of Endpoint Inventory</SheetDescription>
          <SidebarNav onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-page">
          <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3.5 sm:px-6">
            <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
              <Menu />
            </Button>
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <div className="hidden sm:block">
              <TenantSwitcher />
            </div>
            <ThemeToggle />
            <UserMenu />
          </div>
          <div className="px-4 pb-3 sm:hidden">
            <TenantSwitcher />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pt-8 pb-12 outline-none sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
