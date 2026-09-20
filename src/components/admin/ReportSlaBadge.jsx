import { useMemo } from 'react';
import { getReportOverallSla, formatSlaDuration } from '../../utils/sla';

export default function ReportSlaBadge({ report, size = 'medium', showLabel = true }) {
  const sla = useMemo(() => {
    return getReportOverallSla(report);
  }, [report]);

  if (!sla || !report) return null;

  const { overallState, activeSla, isTerminal } = sla;

  // Terminal state treatment
  if (isTerminal) {
    if (report.status === 'Resolved') {
      const isLate = sla.resolutionSla?.state === 'breached';
      return (
        <span
          className={`sla-badge sla-${isLate ? 'breached' : 'within'} size-${size}`}
          title={`Incident resolved in ${formatSlaDuration(sla.resolutionSla?.elapsedMinutes)} (Target: ${formatSlaDuration(sla.resolutionSla?.targetMinutes)})`}
          role="status"
          aria-label={`SLA: Resolved ${isLate ? 'Late' : 'On Time'}`}
        >
          <span aria-hidden="true">{isLate ? '⚠️' : '✅'}</span>
          {showLabel && (
            <span>
              {isLate ? 'Resolved (Late)' : 'SLA Met'} ({formatSlaDuration(sla.resolutionSla?.elapsedMinutes)})
            </span>
          )}
        </span>
      );
    }
    return null;
  }

  // Active operational SLA
  let icon = '⏱️';
  let label = 'Within SLA';
  if (overallState === 'breached') {
    icon = '🚨';
    label = 'SLA Breached';
  } else if (overallState === 'approaching') {
    icon = '⚠️';
    label = 'SLA Approaching';
  }

  const elapsedText = formatSlaDuration(activeSla?.elapsedMinutes);
  const targetText = formatSlaDuration(activeSla?.targetMinutes);
  const slaTypeLabel = activeSla?.type === 'assignment' ? 'Assign' : 'Resolution';

  return (
    <span
      className={`sla-badge sla-${overallState} size-${size}`}
      title={`${label}: ${slaTypeLabel} target is ${targetText}. Elapsed: ${elapsedText} (${activeSla?.percentElapsed}%).`}
      role="status"
      aria-label={`${label} - ${slaTypeLabel}: ${elapsedText} of ${targetText}`}
    >
      <span aria-hidden="true" className="sla-badge-icon">{icon}</span>
      {showLabel && (
        <span className="sla-badge-text">
          <strong>{label}</strong>
          {size !== 'small' && (
            <span className="sla-badge-metrics">
              {' '}({elapsedText} / {targetText})
            </span>
          )}
        </span>
      )}
    </span>
  );
}
