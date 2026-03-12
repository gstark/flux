import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRotateLeft,
  faArrowUp,
  faBars,
  faBell,
  faBellSlash,
  faBolt,
  faCircle,
  faCircleCheck,
  faCircleDot,
  faCircleExclamation,
  faCircleMinus,
  faCirclePause,
  faCirclePlay,
  faCircleXmark,
  faChevronRight,
  faClockRotateLeft,
  faFire,
  faGear,
  faMagnifyingGlass,
  faMinus,
  faPaperPlane,
  faPen,
  faPlay,
  faPlus,
  faRobot,
  faScrewdriverWrench,
  faSkull,
  faSpinner,
  faStop,
  faTag,
  faTags,
  faTerminal,
  faTrash,
  faTriangleExclamation,
  faUser,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  FontAwesomeIcon,
  type FontAwesomeIconProps,
} from "@fortawesome/react-fontawesome";

/**
 * Maps FA CSS class names (e.g. "fa-circle-check") to icon definitions.
 * Used by components that store icon names in config objects.
 */
const ICON_MAP: Record<string, IconDefinition> = {
  "fa-arrow-down": faArrowDown,
  "fa-arrow-left": faArrowLeft,
  "fa-arrow-rotate-left": faArrowRotateLeft,
  "fa-arrow-up": faArrowUp,
  "fa-bars": faBars,
  "fa-bell": faBell,
  "fa-bell-slash": faBellSlash,
  "fa-bolt": faBolt,
  "fa-circle": faCircle,
  "fa-circle-check": faCircleCheck,
  "fa-circle-dot": faCircleDot,
  "fa-circle-exclamation": faCircleExclamation,
  "fa-circle-minus": faCircleMinus,
  "fa-circle-pause": faCirclePause,
  "fa-circle-play": faCirclePlay,
  "fa-circle-xmark": faCircleXmark,
  "fa-chevron-right": faChevronRight,
  "fa-clock-rotate-left": faClockRotateLeft,
  "fa-fire": faFire,
  "fa-gear": faGear,
  "fa-magnifying-glass": faMagnifyingGlass,
  "fa-minus": faMinus,
  "fa-paper-plane": faPaperPlane,
  "fa-pen": faPen,
  "fa-play": faPlay,
  "fa-plus": faPlus,
  "fa-robot": faRobot,
  "fa-screwdriver-wrench": faScrewdriverWrench,
  "fa-skull": faSkull,
  "fa-spinner": faSpinner,
  "fa-stop": faStop,
  "fa-tag": faTag,
  "fa-tags": faTags,
  "fa-terminal": faTerminal,
  "fa-trash": faTrash,
  "fa-triangle-exclamation": faTriangleExclamation,
  "fa-user": faUser,
  "fa-xmark": faXmark,
};

/**
 * Resolves an FA CSS class name (e.g. "fa-circle-check" or "fa-spinner fa-spin")
 * to an IconDefinition. Throws if the icon name is not in the map.
 */
export function resolveIcon(faClassName: string): {
  icon: IconDefinition;
  spin: boolean;
} {
  const parts = faClassName.split(" ");
  const spin = parts.includes("fa-spin");
  const name = parts.find((p) => p !== "fa-spin");
  if (!name) throw new Error(`Empty icon class: "${faClassName}"`);

  const icon = ICON_MAP[name];
  if (!icon) throw new Error(`Unknown icon class: "${name}"`);
  return { icon, spin };
}

/**
 * Drop-in replacement for `<i className="fa-solid fa-foo" />`.
 * Accepts either a direct IconDefinition or an FA CSS class name string.
 */
export function Icon({
  name,
  className,
  ...rest
}: {
  name: string;
  className?: string;
} & Omit<FontAwesomeIconProps, "icon">) {
  const { icon, spin } = resolveIcon(name);
  return (
    <FontAwesomeIcon
      icon={icon}
      spin={spin || rest.spin}
      className={className}
      aria-hidden="true"
      {...rest}
    />
  );
}

// Re-export individual icons for direct use with FontAwesomeIcon
export {
  FontAwesomeIcon,
  faArrowDown,
  faArrowLeft,
  faArrowRotateLeft,
  faArrowUp,
  faBars,
  faBell,
  faBellSlash,
  faBolt,
  faCircle,
  faCircleCheck,
  faCircleDot,
  faCircleExclamation,
  faCircleMinus,
  faCirclePause,
  faCirclePlay,
  faCircleXmark,
  faChevronRight,
  faClockRotateLeft,
  faFire,
  faGear,
  faMagnifyingGlass,
  faMinus,
  faPaperPlane,
  faPen,
  faPlay,
  faPlus,
  faRobot,
  faScrewdriverWrench,
  faSkull,
  faSpinner,
  faStop,
  faTag,
  faTags,
  faTerminal,
  faTrash,
  faTriangleExclamation,
  faUser,
  faXmark,
};
