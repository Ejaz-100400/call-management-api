/**
 * Follow-ups need a concrete due date to appear on the Follow-ups page --
 * when something is flagged as needing follow-up without a specific date
 * (common from messy historical notes or vague live-call requests like
 * "call me back sometime"), default to a few days out rather than silently
 * never creating the task.
 */
export function defaultFollowUpDueDate(from: Date = new Date()): Date {
  const due = new Date(from);
  due.setDate(due.getDate() + 3);
  return due;
}
