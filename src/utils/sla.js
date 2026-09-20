/**
 * CleanAlert Municipal Operations SLA Constants & Calculation Engine
 * 
 * Municipal SLA Thresholds (Documented Defaults):
 * - CRITICAL: Assignment target = 15 minutes, Resolution target = 2 hours (120 mins)
 * - HIGH:     Assignment target = 30 minutes, Resolution target = 4 hours (240 mins)
 * - MEDIUM:   Assignment target = 2 hours (120 mins), Resolution target = 8 hours (480 mins)
 * - LOW:      Assignment target = 4 hours (240 mins), Resolution target = 24 hours (1440 mins)
 */

export const SLA_CONFIG = {
  critical: {
    label: 'Critical',
    assignmentMinutes: 15,
    resolutionMinutes: 120,
    assignmentTargetMinutes: 15,
    resolutionTargetMinutes: 120, // 2 hours
  },
  high: {
    label: 'High',
    assignmentMinutes: 30,
    resolutionMinutes: 240,
    assignmentTargetMinutes: 30,
    resolutionTargetMinutes: 240, // 4 hours
  },
  medium: {
    label: 'Medium',
    assignmentMinutes: 120,
    resolutionMinutes: 480,
    assignmentTargetMinutes: 120, // 2 hours
    resolutionTargetMinutes: 480, // 8 hours
  },
  low: {
    label: 'Low',
    assignmentMinutes: 240,
    resolutionMinutes: 1440,
    assignmentTargetMinutes: 240, // 4 hours
    resolutionTargetMinutes: 1440, // 24 hours
  },
};

/**
 * Evaluates SLA state based on elapsed and target minutes.
 * - Within: elapsed < 75% of target
 * - Approaching: 75% <= elapsed < 100% of target
 * - Breached: elapsed >= target (100%)
 */
export function evaluateSlaThreshold(elapsedMinutes, targetMinutes) {
  const elapsed = Math.max(0, Math.round(elapsedMinutes));
  const target = Math.max(1, Math.round(targetMinutes));
  const remainingMinutes = target - elapsed;
  const percentElapsed = Math.round((elapsed / target) * 100);

  let state = 'within';
  if (elapsed >= target) {
    state = 'breached';
  } else if (percentElapsed >= 75) {
    state = 'approaching';
  }

  return {
    state, // 'within' | 'approaching' | 'breached'
    elapsedMinutes: elapsed,
    targetMinutes: target,
    remainingMinutes,
    percentElapsed,
  };
}

/**
 * Calculates Assignment SLA:
 * From created_at -> assigned_at.
 * If assigned_at is null and not yet assigned, calculates elapsed time from created_at until now.
 */
export function getReportAssignmentSla(report, now = new Date()) {
  if (!report || !report.created_at) return null;
  const sev = (report.severity || 'medium').toLowerCase();
  const config = SLA_CONFIG[sev] || SLA_CONFIG.medium;
  const targetMinutes = config.assignmentTargetMinutes;

  const createdAt = new Date(report.created_at).getTime();
  const assignedAt = report.assigned_at ? new Date(report.assigned_at).getTime() : null;
  const endTime = assignedAt || (now instanceof Date ? now.getTime() : new Date(now).getTime());

  const elapsedMs = Math.max(0, endTime - createdAt);
  const elapsedMinutes = elapsedMs / (1000 * 60);

  const isAssigned = !!report.assigned_at || (report.status !== 'Reported' && !!report.assigned_worker_id);

  return {
    ...evaluateSlaThreshold(elapsedMinutes, targetMinutes),
    isCompleted: isAssigned,
    type: 'assignment',
    severity: sev,
  };
}

/**
 * Calculates Resolution SLA:
 * From created_at -> resolved_at.
 * If unresolved, calculates elapsed time from created_at until now.
 */
export function getReportResolutionSla(report, now = new Date()) {
  if (!report || !report.created_at) return null;
  const sev = (report.severity || 'medium').toLowerCase();
  const config = SLA_CONFIG[sev] || SLA_CONFIG.medium;
  const targetMinutes = config.resolutionTargetMinutes;

  const createdAt = new Date(report.created_at).getTime();
  const resolvedAt = report.resolved_at ? new Date(report.resolved_at).getTime() : null;
  const endTime = resolvedAt || (now instanceof Date ? now.getTime() : new Date(now).getTime());

  const elapsedMs = Math.max(0, endTime - createdAt);
  const elapsedMinutes = elapsedMs / (1000 * 60);

  const isResolved = report.status === 'Resolved' || !!report.resolved_at;

  return {
    ...evaluateSlaThreshold(elapsedMinutes, targetMinutes),
    isCompleted: isResolved,
    type: 'resolution',
    severity: sev,
  };
}

/**
 * Overall Operational SLA for an active report.
 * - If still 'Reported' (unassigned): primary operational risk is Assignment SLA.
 * - If Assigned / Accepted / In Progress: primary operational risk is Resolution SLA.
 * - Overall state is 'breached' if either is breached, 'approaching' if either is approaching.
 */
export function getReportOverallSla(report, now = new Date()) {
  if (!report || !report.created_at) return null;

  const assignmentSla = getReportAssignmentSla(report, now);
  const resolutionSla = getReportResolutionSla(report, now);

  const isTerminal = report.status === 'Resolved' || report.status === 'Cancelled';
  const isUnassigned = report.status === 'Reported' && !report.assigned_worker_id;

  // Active primary SLA depends on lifecycle stage
  const activeSla = isUnassigned ? assignmentSla : resolutionSla;

  let overallState = 'within';
  if (!isTerminal) {
    if (assignmentSla.state === 'breached' || resolutionSla.state === 'breached') {
      overallState = 'breached';
    } else if (assignmentSla.state === 'approaching' || resolutionSla.state === 'approaching') {
      overallState = 'approaching';
    }
  }

  return {
    state: overallState,
    overallState, // 'within' | 'approaching' | 'breached'
    elapsedMinutes: activeSla.elapsedMinutes,
    targetMinutes: activeSla.targetMinutes,
    remainingMinutes: activeSla.remainingMinutes,
    percentElapsed: activeSla.percentElapsed,
    activeSla,
    assignmentSla,
    resolutionSla,
    isTerminal,
  };
}

/**
 * Formats a duration in minutes into a human-readable string (e.g., "15m", "2h 30m", "1d 4h")
 */
export function formatSlaDuration(minutes) {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return '—';
  const mins = Math.round(minutes);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
