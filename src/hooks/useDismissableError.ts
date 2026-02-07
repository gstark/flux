import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_DISMISS_MS = 8000;

/**
 * Hook for error state that auto-dismisses after 8 seconds.
 * Returns the current error message, a function to show an error
 * (accepts unknown for catch blocks), and a function to clear it.
 */
export function useDismissableError() {
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showError = useCallback((err: unknown) => {
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred";
    setError(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setError(null), AUTO_DISMISS_MS);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { error, showError, clearError } as const;
}
