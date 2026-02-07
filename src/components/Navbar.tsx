import { useRouteContext } from "@tanstack/react-router";
import { FontAwesomeIcon, faBars } from "./Icon";
import { OrchestratorStatus } from "./OrchestratorStatus";

export function Navbar() {
  const { projectId } = useRouteContext({ from: "__root__" });

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
      <div className="navbar-end pr-4">
        <OrchestratorStatus projectId={projectId} />
      </div>
    </div>
  );
}
