import { VEHICLE_STATUS_CONFIG } from '../../utils/fleet';

export default function VehicleStatusBadge({ status, size = 'md' }) {
  const config = VEHICLE_STATUS_CONFIG[status] || {
    label: status || 'Unknown',
    color: '#6B7280',
    bg: 'rgba(107, 114, 128, 0.1)',
    border: '#E5E7EB',
    icon: '⚪',
  };

  const isSmall = size === 'sm';

  return (
    <span
      className={`vehicle-status-badge ${isSmall ? 'badge-sm' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: isSmall ? '2px 8px' : '4px 10px',
        borderRadius: '9999px',
        fontSize: isSmall ? '0.75rem' : '0.8125rem',
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        whiteSpace: 'nowrap',
      }}
      aria-label={`Vehicle status: ${config.label}`}
    >
      <span aria-hidden="true" style={{ fontSize: isSmall ? '0.65rem' : '0.75rem' }}>
        {config.icon}
      </span>
      <span>{config.label}</span>
    </span>
  );
}
