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

/**
 * Sentiment and the follow-up flag are extracted/edited independently, so
 * they can drift out of sync (Claude, an importer, or a manual edit setting
 * sentiment to "needs_follow_up" without also flipping the checkbox) -- a
 * call that reads as needing follow-up should always actually get a
 * Follow-ups page task, so treat the sentiment as authoritative here.
 */
export function withFollowUpConsistency(followUpRequired: boolean, sentiment: string | null | undefined): boolean {
  return followUpRequired || sentiment === 'needs_follow_up';
}
