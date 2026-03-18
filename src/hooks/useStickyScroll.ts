import { type RefObject, useEffect, useRef } from "react";

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
 * Returns a ref that resolves to the nearest scrollable ancestor of `anchorRef`.
 * Useful when the component doesn't own its scroll container (e.g. page content
 * inside a layout's `<main overflow-auto>`).
 */
export function useScrollParent(
  anchorRef: RefObject<HTMLElement | null>,
): RefObject<HTMLElement | null> {
  const scrollParentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    scrollParentRef.current = anchor ? findScrollParent(anchor) : null;
  }, [anchorRef]);

  return scrollParentRef;
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
