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
    </ul>
  );
}
