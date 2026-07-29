/**
 * One source of truth for portal form-control geometry (UI-PATTERNS Rule 8,
 * ADR 0082). Every control — text input, select, submit button — shares one
 * height and one border weight so a row of mixed controls reads as a single
 * designed unit instead of three elements that each picked their own size.
 *
 * h-11 (44px) satisfies the WCAG 2.5.5 / HIG touch-target floor from the
 * design spec. w-full delegates width to the layout column: a select is
 * never intrinsic-width (sized to its longest option), which is what made
 * control stacks ragged before the kit existed.
 */
export const CONTROL_BASE =
  'h-11 w-full border-[3px] border-[color:var(--ss-color-text-primary)] bg-[color:var(--ss-color-background)] px-3 font-body text-body text-[color:var(--ss-color-text-primary)]'
