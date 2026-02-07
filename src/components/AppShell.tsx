import { Outlet } from "@tanstack/react-router";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex flex-col">
        <Navbar />
        <main className="grow p-6">
          <Outlet />
        </main>
      </div>
      <div className="drawer-side">
        <label
          htmlFor="app-drawer"
          aria-label="close sidebar"
          className="drawer-overlay"
        />
        <Sidebar />
      </div>
    </div>
  );
}
