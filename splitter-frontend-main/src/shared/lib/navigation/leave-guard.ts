/**
 * When leaving a screen must be confirmed (swipe back, back button, programmatic back). Pure.
 * Unsaved input or work in progress blocks; a finished save, or an explicit "leave now" (after submitting), does not.
 */
export interface LeaveState { dirty: boolean; busy?: boolean; saved?: boolean; allowOnce?: boolean }

export function shouldConfirmLeave(s: LeaveState): boolean {
  if (s.allowOnce || s.saved) return false;
  return s.dirty || !!s.busy;
}
