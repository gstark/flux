import { Link } from "@tanstack/react-router";

export function Sidebar() {
  return (
    <ul className="menu min-h-full w-64 bg-base-200 p-4">
      <li>
        <Link
          to="/issues"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <i className="fa-solid fa-circle-dot" aria-hidden="true" />
          Issues
        </Link>
      </li>
      <li>
        <Link
          to="/activity"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <i className="fa-solid fa-terminal" aria-hidden="true" />
          Activity
        </Link>
      </li>
      <li>
        <Link
          to="/sessions"
          activeProps={{ className: "menu-active" }}
          inactiveProps={{ className: "" }}
        >
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
          Sessions
        </Link>
      </li>
    </ul>
  );
}
