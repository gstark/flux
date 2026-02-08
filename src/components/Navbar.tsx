import { useRouteContext } from "@tanstack/react-router";
import { useNotifications } from "../hooks/useNotifications";
import {
  FontAwesomeIcon,
  faBars,
  faBell,
  faBellSlash,
  faMagnifyingGlass,
} from "./Icon";
import { OrchestratorStatus } from "./OrchestratorStatus";

const modKey = navigator.platform?.startsWith("Mac") ? "⌘" : "Ctrl+";

export function Navbar({ onSearchClick }: { onSearchClick?: () => void }) {
  const { projectId } = useRouteContext({ from: "__root__" });
  const { enabled, supported, toggle } = useNotifications();

  return (
    <div className="navbar w-full bg-base-300">
      <div className="flex-none lg:hidden">
        <label
          htmlFor="app-drawer"
          aria-label="open sidebar"
          className="btn btn-square btn-ghost"
        >
          <FontAwesomeIcon
            icon={faBars}
            className="text-xl"
            aria-hidden="true"
          />
        </label>
      </div>
      <div className="flex-1 px-4 font-bold text-lg">Flux</div>
      <div className="navbar-end flex items-center gap-2 pr-4">
        {onSearchClick && (
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-2"
            onClick={onSearchClick}
            title={`Search issues (${modKey}K)`}
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <kbd className="kbd kbd-xs">{modKey}K</kbd>
          </button>
        )}
        {supported && (
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${enabled ? "text-primary" : "text-base-content/40"}`}
            onClick={toggle}
            aria-label={
              enabled ? "Disable notifications" : "Enable notifications"
            }
            title={enabled ? "Notifications on" : "Notifications off"}
          >
            <FontAwesomeIcon
              icon={enabled ? faBell : faBellSlash}
              aria-hidden="true"
            />
          </button>
        )}
        <OrchestratorStatus projectId={projectId} />
      </div>
    </div>
  );
}
