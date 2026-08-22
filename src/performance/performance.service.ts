import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDayIST } from '../common/timezone.util';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** [start, end) in IST for the given "YYYY-MM", defaulting to the current IST month. */
function monthRangeIST(month: string | undefined): { from: Date; to: Date; label: string } {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const [year, mon] = month
    ? month.split('-').map(Number)
    : [nowIst.getUTCFullYear(), nowIst.getUTCMonth() + 1];

  const pad = (n: number) => String(n).padStart(2, '0');
  const from = startOfDayIST(`${year}-${pad(mon)}-01`);
  const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${pad(mon + 1)}-01`;
  const to = startOfDayIST(nextMonth);
  return { from, to, label: `${year}-${pad(mon)}` };
}

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  async getEmployeeReport(month?: string) {
    const { from, to, label } = monthRangeIST(month);

    const [employees, coverage] = await Promise.all([
      this.prisma.employee.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      this.prisma.numberCoverage.findMany(),
    ]);

    const rows = await Promise.all(
      employees.map(async (emp) => {
        const [calls, followUps] = await Promise.all([
          this.prisma.call.findMany({
            where: { employeeId: emp.id, callDate: { gte: from, lt: to } },
            include: { extraction: true },
          }),
          this.prisma.followUp.findMany({
            where: { assignedTo: emp.id, createdAt: { gte: from, lt: to } },
          }),
        ]);

        return {
          employee: { id: emp.id, name: emp.name, role: emp.role },
          coverage: this.describeCoverage(
            emp.id,
            coverage.filter((c) => c.employeeId === emp.id),
          ),
          ...this.analyze(calls, followUps),
        };
      }),
    );

    return { month: label, employees: rows };
  }

  private describeCoverage(employeeId: string, rows: { phoneNumber: string; startHour: number | null; endHour: number | null; isBackup: boolean }[]) {
    const isBackup = rows.some((r) => r.isBackup);
    if (isBackup) {
      // A backup covers whatever line needs them, not one specific number --
      // showing a single row here would understate what they actually do.
      return { type: 'backup' as const, label: 'All lines (backup)' };
    }
    return {
      type: 'scheduled' as const,
      lines: rows.map((r) => ({
        phoneNumber: r.phoneNumber,
        window: r.startHour !== null && r.endHour !== null ? { startHour: r.startHour, endHour: r.endHour } : null,
      })),
    };
  }

  /**
   * Every score/pro/con here is derived directly from these four measured
   * rates -- nothing is AI-guessed or subjective. Kept deliberately simple
   * and explainable: an owner reviewing this monthly should be able to see
   * exactly which number produced which sentence below it.
   */
  private analyze(
    calls: { status: string; durationSeconds: number; extraction: { sentiment: string | null; customerName: string | null; carMake: string | null; carModel: string | null; productsDiscussed: unknown } | null }[],
    followUps: { status: string; dueDate: Date }[],
  ) {
    const totalCalls = calls.length;
    const completed = calls.filter((c) => c.status === 'completed');
    const failed = calls.filter((c) => c.status === 'failed');
    const completionRate = totalCalls > 0 ? completed.length / totalCalls : null;
    const avgDurationSeconds =
      completed.length > 0 ? Math.round(completed.reduce((s, c) => s + c.durationSeconds, 0) / completed.length) : null;

    const withSentiment = completed.filter((c) => c.extraction?.sentiment);
    const sentimentTotal = withSentiment.length;
    const interested = withSentiment.filter((c) => c.extraction!.sentiment === 'interested').length;
    const notInterested = withSentiment.filter((c) => c.extraction!.sentiment === 'not_interested').length;
    const needsFollowUp = withSentiment.filter((c) => c.extraction!.sentiment === 'needs_follow_up').length;
    const interestedRate = sentimentTotal > 0 ? interested / sentimentTotal : null;
    const notInterestedRate = sentimentTotal > 0 ? notInterested / sentimentTotal : null;

    const dataCaptured = completed.filter(
      (c) =>
        c.extraction?.customerName &&
        (c.extraction?.carMake || c.extraction?.carModel) &&
        Array.isArray(c.extraction?.productsDiscussed) &&
        (c.extraction!.productsDiscussed as unknown[]).length > 0,
    );
    const dataCaptureRate = completed.length > 0 ? dataCaptured.length / completed.length : null;

    const now = new Date();
    // A pending follow-up not yet at its due date hasn't had its chance to
    // be worked yet -- counting it as "not done" would penalize someone for
    // something due next week. Only follow-ups that are resolved OR already
    // past due count toward the rate.
    const followUpTotal = followUps.length;
    const followUpCompleted = followUps.filter((f) => f.status === 'completed').length;
    const followUpOverdue = followUps.filter((f) => f.status === 'pending' && f.dueDate < now).length;
    const followUpsHadTheirChance = followUps.filter((f) => f.status !== 'pending' || f.dueDate < now);
    const followUpRate =
      followUpsHadTheirChance.length > 0 ? followUpCompleted / followUpsHadTheirChance.length : null;

    let score: number | null = null;
    if (totalCalls > 0) {
      const sentimentScore = (interestedRate ?? 0.5) * 4;
      const followUpScore = (followUpRate ?? 0.5) * 3;
      const thoroughnessScore = (dataCaptureRate ?? 0.5) * 3;
      score = Math.min(10, Math.max(0, Math.round((sentimentScore + followUpScore + thoroughnessScore) * 10) / 10));
    }

    const pros: string[] = [];
    const cons: string[] = [];

    if (interestedRate !== null) {
      if (interestedRate >= 0.5) pros.push(`Strong customer rapport — ${pct(interestedRate)} of calls end "interested".`);
      if (notInterestedRate! >= 0.3) cons.push(`Higher-than-typical "not interested" outcomes — ${pct(notInterestedRate!)} of calls.`);
    }
    if (followUpRate !== null) {
      if (followUpRate >= 0.7) pros.push(`Follows through on commitments — ${pct(followUpRate)} of assigned follow-ups completed.`);
      if (followUpRate < 0.4) cons.push(`Follow-ups often left pending — only ${pct(followUpRate)} completed.`);
    } else if (totalCalls > 0) {
      cons.push(
        followUpTotal === 0
          ? 'No follow-ups assigned this period — hard to judge how commitments are tracked.'
          : "All of this period's follow-ups are still within their due date — too early to judge follow-through.",
      );
    }
    if (dataCaptureRate !== null) {
      if (dataCaptureRate >= 0.7)
        pros.push(`Thorough call notes — customer name, vehicle, and products captured on ${pct(dataCaptureRate)} of calls.`);
      if (dataCaptureRate < 0.4)
        cons.push(`Customer/vehicle details frequently left blank — only ${pct(dataCaptureRate)} of calls fully recorded.`);
    }
    if (completionRate !== null) {
      if (completionRate >= 0.85) pros.push(`High call completion rate — ${pct(completionRate)} of calls connect successfully.`);
      if (completionRate < 0.6)
        cons.push(`Lower call completion rate (${pct(completionRate)}) — may reflect availability/coverage rather than communication skill.`);
    }
    if (followUpOverdue > 0) cons.push(`${followUpOverdue} follow-up(s) currently overdue.`);

    if (pros.length === 0) pros.push(totalCalls === 0 ? 'No calls handled this period yet.' : 'Nothing stands out as a strength yet — check back after more calls this month.');
    if (cons.length === 0) cons.push(totalCalls === 0 ? 'No data to assess yet.' : 'No notable concerns this period.');

    return {
      score,
      metrics: {
        totalCalls,
        completedCalls: completed.length,
        failedCalls: failed.length,
        completionRate,
        avgDurationSeconds,
        interestedRate,
        notInterestedRate,
        needsFollowUpCount: needsFollowUp,
        sentimentSampleSize: sentimentTotal,
        dataCaptureRate,
        followUpTotal,
        followUpCompleted,
        followUpRate,
        followUpOverdue,
      },
      pros,
      cons,
    };
  }
}
