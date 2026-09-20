import { useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import ReportStatusBadge from '../citizen/ReportStatusBadge';
import '../../styles/admin-map.css';

// Fix Vite asset paths for Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

// Default center for municipal area
const DEFAULT_CENTER = [17.6868, 83.2185];
const DEFAULT_ZOOM = 12;

const GARBAGE_TYPE_LABELS = {
  general: 'General Waste',
  household: 'Household Waste',
  commercial: 'Commercial Waste',
  construction: 'Construction / Debris',
  organic: 'Organic / Food Waste',
  plastic: 'Plastic / Recyclable',
  electronic: 'Electronic (E-waste)',
  hazardous: 'Hazardous / Biohazard',
  other: 'Other / Mixed Waste',
};

/**
 * Robust coordinate extractor for PostGIS Point format (GeoJSON or WKT string)
 */
function parseWorkerCoordinates(currentLocation) {
  if (!currentLocation) return null;

  // Case 1: GeoJSON Point object { type: 'Point', coordinates: [lng, lat] }
  if (typeof currentLocation === 'object' && Array.isArray(currentLocation.coordinates)) {
    const [lng, lat] = currentLocation.coordinates;
    if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }

  // Case 2: WKT String "POINT(lng lat)" or "SRID=4326;POINT(lng lat)"
  if (typeof currentLocation === 'string') {
    const match = currentLocation.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      const lng = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

/**
 * Custom Report Pin Leaflet Icon
 */
function createReportIcon(report) {
  const sev = (report.severity || 'medium').toLowerCase();
  const status = report.status || 'Reported';

  let sevSymbol = '📍';
  if (sev === 'critical') sevSymbol = '🚨';
  else if (sev === 'high') sevSymbol = '⚡';
  else if (sev === 'medium') sevSymbol = '📌';
  else if (sev === 'low') sevSymbol = '📍';

  let statusBadgeHtml = '';
  if (status === 'Reported' && !report.assigned_worker_id) {
    statusBadgeHtml = '<span class="marker-status-badge status-badge-unassigned" title="Unassigned">⚠️</span>';
  } else if (status === 'Assigned' || status === 'Accepted') {
    statusBadgeHtml = '<span class="marker-status-badge status-badge-assigned" title="Assigned">👤</span>';
  } else if (status === 'In Progress') {
    statusBadgeHtml = '<span class="marker-status-badge status-badge-inprogress" title="In Progress">🔄</span>';
  } else if (status === 'Resolved') {
    statusBadgeHtml = '<span class="marker-status-badge status-badge-resolved" title="Resolved">✓</span>';
  }

  const pulseRingHtml = sev === 'critical' ? '<div class="marker-pulse-ring"></div>' : '';

  return L.divIcon({
    className: 'report-map-marker-container',
    html: `
      <div class="report-map-marker marker-sev-${sev}" role="img" aria-label="Incident: ${report.title}">
        <div class="marker-pin-body">
          ${pulseRingHtml}
          <span class="marker-inner-content">${sevSymbol}</span>
          ${statusBadgeHtml}
        </div>
      </div>
    `,
    iconSize: [36, 42],
    iconAnchor: [18, 40],
    popupAnchor: [0, -38],
  });
}

/**
 * Custom Worker Avatar Leaflet Icon
 */
function createWorkerIcon(worker) {
  const name = worker.full_name || 'Worker';
  const shortName = name.split(' ')[0];

  return L.divIcon({
    className: 'worker-map-marker-container',
    html: `
      <div class="worker-map-marker" role="img" aria-label="Field Worker: ${name}">
        <div class="worker-marker-avatar">
          <div class="worker-marker-duty-halo"></div>
          <span>👷</span>
        </div>
        <span class="worker-marker-name-tag">${shortName}</span>
      </div>
    `,
    iconSize: [42, 52],
    iconAnchor: [21, 48],
    popupAnchor: [0, -46],
  });
}

/**
 * Auto-fit map bounds to encompass visible markers
 */
function MapBoundsController({ markers, defaultCenter = DEFAULT_CENTER }) {
  const map = useMap();
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (!map) return;

    if (!markers || markers.length === 0) {
      if (!initialFitDone.current) {
        map.setView(defaultCenter, DEFAULT_ZOOM);
        initialFitDone.current = true;
      }
      return;
    }

    const latLngs = markers.map((m) => [m.lat, m.lng]);
    try {
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 15,
          animate: true,
        });
      }
    } catch {
      // Gracefully maintain current view on invalid bounds
    }
  }, [markers, map, defaultCenter]);

  return null;
}

export default function DispatchMap({
  reports = [],
  workers = [],
  showWorkers = true,
  compact = false,
  height,
  onSelectReport,
}) {
  const navigate = useNavigate();

  // Filter valid report markers
  const validReports = useMemo(() => {
    return reports.filter((r) => {
      return (
        r &&
        typeof r.latitude === 'number' &&
        typeof r.longitude === 'number' &&
        !isNaN(r.latitude) &&
        !isNaN(r.longitude)
      );
    });
  }, [reports]);

  // Filter valid on-duty worker markers
  const validWorkers = useMemo(() => {
    if (!showWorkers) return [];
    return workers
      .filter((w) => w && w.is_active !== false)
      .map((w) => {
        const coords = parseWorkerCoordinates(w.current_location);
        return coords ? { ...w, coords } : null;
      })
      .filter(Boolean);
  }, [workers, showWorkers]);

  // Combined coordinates for bounds fitting
  const allMarkerPositions = useMemo(() => {
    const list = [];
    validReports.forEach((r) => list.push({ lat: r.latitude, lng: r.longitude }));
    validWorkers.forEach((w) => list.push({ lat: w.coords.lat, lng: w.coords.lng }));
    return list;
  }, [validReports, validWorkers]);

  const mapFrameClass = compact ? 'dispatch-map-frame dispatch-map-compact' : 'dispatch-map-frame';
  const customHeight = height ? { height } : undefined;

  return (
    <div className="dispatch-map-card">
      <div className={mapFrameClass} style={customHeight} aria-label="Municipal Dispatch Map">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={!compact}
          className="leaflet-map-element"
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />

          <MapBoundsController markers={allMarkerPositions} />

          {/* REPORT INCIDENT MARKERS */}
          {validReports.map((report) => {
            const reportIcon = createReportIcon(report);
            const createdDate = report.created_at
              ? new Date(report.created_at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Recently';

            const assignedName = report.assigned_worker?.full_name || report.assignedWorker?.full_name || null;
            const wasteTypeLabel = GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type || 'General Waste';
            const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${report.latitude},${report.longitude}`;

            return (
              <Marker
                key={`report-${report.id}`}
                position={[report.latitude, report.longitude]}
                icon={reportIcon}
                eventHandlers={{
                  click: () => {
                    if (onSelectReport) onSelectReport(report);
                  },
                }}
              >
                <Popup className="dispatch-leaflet-popup" autoPanPadding={[20, 20]}>
                  <div className="dispatch-popup-card">
                    <div className="dispatch-popup-header">
                      <div className="dispatch-popup-badges">
                        <span
                          className={`admin-severity-badge severity-${(report.severity || 'medium').toLowerCase()}`}
                        >
                          {(report.severity || 'MEDIUM').toUpperCase()}
                        </span>
                        <ReportStatusBadge status={report.status} size="small" />
                      </div>
                      <h3 className="dispatch-popup-title">{report.title}</h3>
                    </div>

                    <div className="dispatch-popup-body">
                      <div className="dispatch-popup-row">
                        <span className="dispatch-popup-icon" aria-hidden="true">🗑️</span>
                        <span><strong>Type:</strong> {wasteTypeLabel}</span>
                      </div>

                      <div className="dispatch-popup-row">
                        <span className="dispatch-popup-icon" aria-hidden="true">📍</span>
                        <span>
                          <strong>Location:</strong> {report.address || `${report.latitude.toFixed(4)}°, ${report.longitude.toFixed(4)}°`}
                        </span>
                      </div>

                      <div className="dispatch-popup-row">
                        <span className="dispatch-popup-icon" aria-hidden="true">🕒</span>
                        <span><strong>Reported:</strong> {createdDate}</span>
                      </div>

                      <div className="dispatch-popup-worker-box">
                        <div style={{ fontWeight: 700, marginBottom: '2px', color: 'var(--admin-text-h)' }}>
                          Assigned Staff:
                        </div>
                        {assignedName ? (
                          <span style={{ color: 'var(--admin-primary)', fontWeight: 600 }}>
                            👤 {assignedName}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--admin-warning, #B45309)', fontWeight: 600 }}>
                            ⚠️ Unassigned — Pending Dispatch
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="dispatch-popup-actions">
                      <a
                        href={navUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-popup-nav"
                        title="Open directions in Google Maps"
                        id={`nav-btn-${report.id}`}
                      >
                        🧭 NAVIGATE ↗
                      </a>
                      <button
                        type="button"
                        className="btn-popup-view"
                        onClick={() => navigate(`/admin/reports/${report.id}`)}
                        title="Inspect full incident report"
                        id={`view-btn-${report.id}`}
                      >
                        👁️ VIEW REPORT
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* ON-DUTY FIELD WORKER MARKERS */}
          {validWorkers.map((worker) => {
            const workerIcon = createWorkerIcon(worker);
            const activeLoad = worker.activeTasks ?? worker.active_tasks ?? 0;
            const lastUpdated = worker.last_location_updated_at
              ? new Date(worker.last_location_updated_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Recently synced';

            return (
              <Marker
                key={`worker-${worker.id}`}
                position={[worker.coords.lat, worker.coords.lng]}
                icon={workerIcon}
              >
                <Popup className="dispatch-leaflet-popup" autoPanPadding={[20, 20]}>
                  <div className="dispatch-popup-card">
                    <div className="worker-popup-header">
                      <h3 className="worker-popup-name">👷 {worker.full_name}</h3>
                      <span className="worker-popup-sub">🟢 On-Duty Municipal Field Staff</span>
                    </div>

                    <div className="dispatch-popup-body">
                      <div className="dispatch-popup-row">
                        <span className="dispatch-popup-icon" aria-hidden="true">📋</span>
                        <span>
                          <strong>Active Task Load:</strong> {activeLoad} assigned task{activeLoad === 1 ? '' : 's'}
                        </span>
                      </div>

                      {worker.currentAssignedTask && (
                        <div className="dispatch-popup-row">
                          <span className="dispatch-popup-icon" aria-hidden="true">🎯</span>
                          <span>
                            <strong>Current Assignment:</strong> {worker.currentAssignedTask}
                          </span>
                        </div>
                      )}

                      <div className="dispatch-popup-row">
                        <span className="dispatch-popup-icon" aria-hidden="true">📡</span>
                        <span>
                          <strong>GPS Status:</strong> Active (Synced {lastUpdated})
                        </span>
                      </div>
                    </div>

                    <div className="dispatch-popup-actions">
                      <button
                        type="button"
                        className="btn-popup-view"
                        style={{ width: '100%' }}
                        onClick={() => navigate('/admin/workers')}
                      >
                        👥 View Worker Roster
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* COMPACT MAP LEGEND BAR */}
      <div className="dispatch-map-legend-bar">
        <div className="dispatch-legend-items">
          <span className="dispatch-legend-item">
            <span className="dispatch-legend-icon legend-critical" aria-hidden="true">🚨</span>
            <span>Critical Priority</span>
          </span>
          <span className="dispatch-legend-item">
            <span className="dispatch-legend-icon legend-high" aria-hidden="true">⚡</span>
            <span>High Priority</span>
          </span>
          <span className="dispatch-legend-item">
            <span className="dispatch-legend-icon legend-medium" aria-hidden="true">📌</span>
            <span>Medium / Standard</span>
          </span>
          <span className="dispatch-legend-item">
            <span className="dispatch-legend-icon legend-low" aria-hidden="true">📍</span>
            <span>Low Priority</span>
          </span>
          <span className="dispatch-legend-item">
            <span className="dispatch-legend-icon legend-worker" aria-hidden="true">👷</span>
            <span>On-Duty Worker</span>
          </span>
        </div>

        <div style={{ fontWeight: 600, fontSize: '0.75rem', opacity: 0.85 }}>
          Showing {validReports.length} incident{validReports.length === 1 ? '' : 's'}
          {showWorkers ? ` • ${validWorkers.length} worker${validWorkers.length === 1 ? '' : 's'} located` : ''}
        </div>
      </div>
    </div>
  );
}
