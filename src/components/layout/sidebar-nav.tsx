import { NavLink } from "react-router";
import { SavedSearchNav } from "@/features/saved-searches/saved-search-nav";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

// The sidebar stays dark blue in both themes, as in the mock. The official Sophos logo goes above
// the product name once the brand asset is added (design/README.md › Component mapping).
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col gap-7 bg-dark-blue px-4 py-6">
      <div className="px-3">
        <span className="font-subtitle text-[15px] leading-tight text-white">Endpoint Inventory</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm no-underline transition-colors focus-visible:outline-cyber-blue",
                  isActive ? "bg-cyber-blue/12 font-semibold text-cyber-blue" : "text-neutral-300 hover:bg-white/6 hover:text-white",
                )
              }
            >
              <Icon className="size-5" aria-hidden="true" strokeWidth={1.5} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <SavedSearchNav onNavigate={onNavigate} />
    </nav>
  );
}
