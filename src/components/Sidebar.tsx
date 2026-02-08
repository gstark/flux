import { Link } from "@tanstack/react-router";
import { useProjectSlug } from "../hooks/useProjectId";
import {
  FontAwesomeIcon,
  faCircleDot,
  faClockRotateLeft,
  faGear,
  faTags,
  faTerminal,
} from "./Icon";

export function Sidebar() {
  const projectSlug = useProjectSlug();
  const params = { projectSlug };

  return (
    <ul className="menu min-h-full w-64 bg-base-200 p-4">
      <li>
        <Link
          to="/p/$projectSlug/issues"
          params={params}
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faCircleDot} aria-hidden="true" />
          Issues
        </Link>
      </li>
      <li>
        <Link
          to="/p/$projectSlug/labels"
          params={params}
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faTags} aria-hidden="true" />
          Labels
        </Link>
      </li>
      <li>
        <Link
          to="/p/$projectSlug/activity"
          params={params}
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faTerminal} aria-hidden="true" />
          Activity
        </Link>
      </li>
      <li>
        <Link
          to="/p/$projectSlug/sessions"
          params={params}
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faClockRotateLeft} aria-hidden="true" />
          Sessions
        </Link>
      </li>
      <li>
        <Link
          to="/p/$projectSlug/settings"
          params={params}
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faGear} aria-hidden="true" />
          Settings
        </Link>
      </li>
    </ul>
  );
}
