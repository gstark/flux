import { Link } from "@tanstack/react-router";
import {
  FontAwesomeIcon,
  faCircleDot,
  faClockRotateLeft,
  faGear,
  faTags,
  faTerminal,
} from "./Icon";

export function Sidebar() {
  return (
    <ul className="menu min-h-full w-64 bg-base-200 p-4">
      <li>
        <Link
          to="/issues"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faCircleDot} aria-hidden="true" />
          Issues
        </Link>
      </li>
      <li>
        <Link
          to="/labels"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faTags} aria-hidden="true" />
          Labels
        </Link>
      </li>
      <li>
        <Link
          to="/activity"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faTerminal} aria-hidden="true" />
          Activity
        </Link>
      </li>
      <li>
        <Link
          to="/sessions"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <FontAwesomeIcon icon={faClockRotateLeft} aria-hidden="true" />
          Sessions
        </Link>
      </li>
      <li>
        <Link
          to="/settings"
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
