// Shared class strings for the design system: one focus ring and one transition for all controls.

/** 2 px accent ring with 2 px offset on keyboard focus (§15.11). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Hover/press feedback timing (§15.10 motion). */
export const transition = "transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out";

/** Disabled look shared by every control. */
export const disabledStyle = "disabled:opacity-45 disabled:cursor-not-allowed aria-disabled:opacity-45";
