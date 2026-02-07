export function Sidebar() {
  return (
    <ul className="menu min-h-full w-64 bg-base-200 p-4">
      <li>
        <button type="button" className="menu-active">
          <i className="fa-solid fa-circle-dot" aria-hidden="true" />
          Issues
        </button>
      </li>
    </ul>
  );
}
