const STATUS_CONFIG = {
  Reported: {
    label: 'Reported',
    className: 'status-badge-reported',
    icon: '📝',
    description: 'Incident submitted and queued for municipal review.',
  },
  Assigned: {
    label: 'Assigned',
    className: 'status-badge-assigned',
    icon: '👤',
    description: 'Assigned to a municipal field worker.',
  },
  Accepted: {
    label: 'Accepted',
    className: 'status-badge-accepted',
    icon: '👍',
    description: 'Field worker accepted and scheduled cleanup.',
  },
  'In Progress': {
    label: 'In Progress',
    className: 'status-badge-inprogress',
    icon: '🔄',
    description: 'Cleanup team actively working at incident location.',
  },
  Resolved: {
    label: 'Resolved',
    className: 'status-badge-resolved',
    icon: '✅',
    description: 'Sanitation completed and resolution verified.',
  },
  Cancelled: {
    label: 'Cancelled',
    className: 'status-badge-cancelled',
    icon: '❌',
    description: 'Report cancelled or closed.',
  },
};

export default function ReportStatusBadge({ status, showIcon = true, size = 'medium' }) {
  const config = STATUS_CONFIG[status] || {
    label: status || 'Unknown',
    className: 'status-badge-unknown',
    icon: '❓',
    description: 'Status unknown',
  };

  return (
    <span
      className={`report-status-badge ${config.className} size-${size}`}
      title={config.description}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && <span className="status-icon" aria-hidden="true">{config.icon}</span>}
      <span className="status-text">{config.label}</span>
    </span>
  );
}
