import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Walk up the DOM to find the nearest ancestor with overflow scroll/auto. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Sticky auto-scroll: scrolls to the bottom when `trigger` changes,
 * but only if the user was already at (or near) the bottom.
 *
 * Manual scrolling away from the bottom disengages auto-scroll.
 * Scrolling back to the bottom re-engages it.
 *
 * @param scrollRef - Ref to the scrollable container element.
 * @param trigger  - Value that changes when new content arrives (e.g. last event id).
 * @param threshold - Pixel tolerance for "at bottom" detection. Default 40.
 */
export function useStickyScroll(
  scrollRef: RefObject<HTMLElement | null>,
  trigger: unknown,
  threshold = 40,
) {
  const isSticky = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      const target = el as HTMLElement;
      const atBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight <
        threshold;
      isSticky.current = atBottom;
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollRef, threshold]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger is the intentional dependency for scrolling on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (isSticky.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [trigger]);
}

/**
 * Sticky auto-scroll that finds and uses the nearest scrollable ancestor.
 *
 * Returns a callback ref to attach to any element inside the scroll container.
 * When the element mounts, the hook finds the nearest scrollable ancestor and
 * binds the sticky scroll behavior to it.
 *
 * @param trigger  - Value that changes when new content arrives.
 * @param threshold - Pixel tolerance for "at bottom" detection. Default 40.
 */
export function useStickyScrollParent(trigger: unknown, threshold = 40) {
  const isSticky = useRef(true);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  const callbackRef = useCallback((node: HTMLElement | null) => {
    setScrollParent(node ? findScrollParent(node) : null);
  }, []);

  useEffect(() => {
    if (!scrollParent) return;

    function handleScroll() {
      const el = scrollParent as HTMLElement;
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isSticky.current = atBottom;
    }

    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollParent.removeEventListener("scroll", handleScroll);
  }, [scrollParent, threshold]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger is the intentional dependency for scrolling on new content
  useEffect(() => {
    if (isSticky.current && scrollParent) {
      scrollParent.scrollTop = scrollParent.scrollHeight;
    }
  }, [trigger]);

  return callbackRef;
}
