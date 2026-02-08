import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "flux-notifications-enabled";

type BrowserPermission = "default" | "granted" | "denied";

interface NotificationContextValue {
  /** User opted in via the toggle. */
  enabled: boolean;
  /** Browser supports the Notification API. */
  supported: boolean;
  /** enabled AND permission === "granted" — safe to fire. */
  ready: boolean;
  /** Current browser permission state. */
  permission: BrowserPermission;
  /** Toggle enabled on/off (requests permission on first enable). */
  toggle: () => void;
  /** Fire a browser notification (no-op if not ready). */
  notify: (
    title: string,
    options?: NotificationOptions,
  ) => Notification | undefined;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

/**
 * Provider that manages browser notification permission and preference.
 * Persists the user's opt-in choice in localStorage.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [permission, setPermission] = useState<BrowserPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  // Sync permission state on mount
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPermission(Notification.permission);
  }, []);

  const toggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable — keep in-memory state only
    }

    if (
      next &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      const result = await Notification.requestPermission();
      setPermission(result);
    }
  }, [enabled]);

  const notify = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!enabled) return;
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;

      return new Notification(title, options);
    },
    [enabled],
  );

  const supported = typeof Notification !== "undefined";
  const ready = enabled && permission === "granted";

  const value: NotificationContextValue = {
    enabled,
    supported,
    ready,
    permission,
    toggle,
    notify,
  };

  return createElement(NotificationContext.Provider, { value }, children);
}

/**
 * Access notification state. Must be used within a NotificationProvider.
 */
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications() must be used within a <NotificationProvider>",
    );
  }
  return ctx;
}
