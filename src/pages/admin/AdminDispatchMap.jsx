import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import DispatchMap from '../../components/admin/DispatchMap';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';
import '../../styles/admin-map.css';

const STATUS_FILTERS = ['All', 'Reported', 'Assigned', 'Accepted', 'In Progress', 'Resolved'];
const SEVERITY_FILTERS = ['All', 'Critical', 'High', 'Medium', 'Low'];
const ASSIGNMENT_FILTERS = ['All', 'Unassigned', 'Assigned'];

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

export default function AdminDispatchMap() {
  const [reports, setReports] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [selectedReport, setSelectedReport] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filter States
  const [statusFilter, setStatusFilter] = useState('All');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [assignmentFilter, setAssignmentFilter] = useState('All');
  const [showWorkers, setShowWorkers] = useState(true);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  // Initial Load + Supabase Realtime Setup
  useEffect(() => {
    let isMounted = true;

    async function loadDispatchData() {
      try {
        // Atomic query for municipal reports with assigned worker names
        const { data: reportsData, error: reportsErr } = await supabase
          .from('reports')
          .select(`
            id,
            title,
            description,
            garbage_type,
            severity,
            status,
            latitude,
            longitude,
            address,
            photo_url,
            assigned_worker_id,
            created_at,
            assigned_at,
            assigned_worker:profiles!reports_assigned_worker_id_fkey(id, full_name, is_active)
          `)
          .order('created_at', { ascending: false });

        if (reportsErr) {
          console.error('Error fetching dispatch reports:', reportsErr);
          if (isMounted) setError('Could not load reports for dispatch map.');
          return;
        }

        // Query for field workers with operational location & duty status
        const { data: workersData, error: workersErr } = await supabase
          .from('profiles')
          .select('id, full_name, role, is_active, current_location, last_location_updated_at')
          .eq('role', 'worker');

        if (workersErr) {
          console.error('Error fetching workers for dispatch map:', workersErr);
        }

        const allReports = reportsData || [];
        const allWorkers = workersData || [];

        // Calculate active task workload for each worker
        const workerLoadMap = {};
        const workerCurrentTaskMap = {};

        allReports.forEach((r) => {
          if (
            r.assigned_worker_id &&
            (r.status === 'Assigned' || r.status === 'Accepted' || r.status === 'In Progress')
          ) {
            workerLoadMap[r.assigned_worker_id] = (workerLoadMap[r.assigned_worker_id] || 0) + 1;
            if (!workerCurrentTaskMap[r.assigned_worker_id]) {
              workerCurrentTaskMap[r.assigned_worker_id] = `${r.title} (${r.status})`;
            }
          }
        });

        const enrichedWorkers = allWorkers.map((w) => ({
          ...w,
          activeTasks: workerLoadMap[w.id] || 0,
          currentAssignedTask: workerCurrentTaskMap[w.id] || null,
        }));

        if (isMounted) {
          setReports(allReports);
          setWorkers(enrichedWorkers);
          setLastRefreshed(new Date());
          setError(null);
        }
      } catch (err) {
        console.error('Exception fetching dispatch data:', err);
        if (isMounted) setError('An unexpected network error occurred while updating the dispatch map.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDispatchData();

    // Supabase Realtime: subscribe to reports table
    const reportsChannel = supabase
      .channel('admin-dispatch-map-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        () => {
          loadDispatchData();
        }
      )
      .subscribe();

    // Supabase Realtime: subscribe to profiles table (duty status / GPS updates)
    const profilesChannel = supabase
      .channel('admin-dispatch-map-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          loadDispatchData();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(profilesChannel);
    };
  }, [refreshKey]);

  // Operational KPI Calculations
  const kpis = useMemo(() => {
    const active = reports.filter(
      (r) => r.status === 'Reported' || r.status === 'Assigned' || r.status === 'Accepted' || r.status === 'In Progress'
    ).length;

    const unassigned = reports.filter(
      (r) => r.status === 'Reported' && !r.assigned_worker_id
    ).length;

    const criticalHigh = reports.filter(
      (r) =>
        (r.severity === 'critical' || r.severity === 'high') &&
        r.status !== 'Resolved' &&
        r.status !== 'Cancelled'
    ).length;

    const onDutyWorkers = workers.filter((w) => w.is_active !== false).length;

    return {
      active,
      unassigned,
      criticalHigh,
      onDutyWorkers,
    };
  }, [reports, workers]);

  // Filtered reports calculation (pure client-side)
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      // Status filter
      if (statusFilter !== 'All' && r.status !== statusFilter) {
        return false;
      }

      // Severity filter
      if (severityFilter !== 'All' && (r.severity || '').toLowerCase() !== severityFilter.toLowerCase()) {
        return false;
      }

      // Assignment filter
      if (assignmentFilter === 'Unassigned') {
        if (r.assigned_worker_id || r.status !== 'Reported') return false;
      } else if (assignmentFilter === 'Assigned') {
        if (!r.assigned_worker_id && r.status === 'Reported') return false;
      }

      return true;
    });
  }, [reports, statusFilter, severityFilter, assignmentFilter]);

  const handleResetFilters = () => {
    setStatusFilter('All');
    setSeverityFilter('All');
    setAssignmentFilter('All');
    setShowWorkers(true);
    setSelectedReport(null);
  };

  return (
    <div className="dispatch-map-layout">
      <UserNavbar />

      <main className="dispatch-map-main" role="main">
        {/* SECTION 1: MUNICIPAL COMMAND HEADER */}
        <header className="dispatch-header">
          <div className="dispatch-header-info">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">MUNICIPAL COMMAND</span>
              <span className="admin-role-badge">
                <span aria-hidden="true">🗺️</span> Geospatial Dispatch Console
              </span>
            </div>
            <h1 className="admin-title">Operational Dispatch Map</h1>
            <p className="admin-subtitle">
              Live geographic overview of municipal garbage incidents, priority statuses, and field crew deployment.
            </p>
          </div>

          <div className="dispatch-header-actions">
            <Link to="/admin" className="btn-admin-secondary">
              &larr; Dashboard
            </Link>
            <Link to="/admin/reports" className="btn-admin-secondary">
              Report List
            </Link>
            <button
              type="button"
              className="btn-admin-secondary btn-admin-sm"
              onClick={handleRefresh}
              disabled={loading}
              title={`Last synchronized: ${lastRefreshed.toLocaleTimeString()}`}
            >
              {loading ? 'Refreshing...' : '🔄 Sync Live'}
            </button>
          </div>
        </header>

        {/* SECTION 2: OPERATIONAL KPI STRIP */}
        <section aria-label="Dispatch Operational Metrics">
          <div className="dispatch-kpi-grid">
            <article className="dispatch-kpi-card">
              <div className="dispatch-kpi-head">
                <span className="dispatch-kpi-label">Active Incidents</span>
                <span className="dispatch-kpi-dot active" aria-hidden="true" />
              </div>
              <p className="dispatch-kpi-val">{kpis.active}</p>
              <span className="dispatch-kpi-sub">Reported, assigned, or en-route</span>
            </article>

            <article className="dispatch-kpi-card">
              <div className="dispatch-kpi-head">
                <span className="dispatch-kpi-label">Unassigned Incidents</span>
                <span className="dispatch-kpi-dot unassigned" aria-hidden="true" />
              </div>
              <p className="dispatch-kpi-val">{kpis.unassigned}</p>
              <span className="dispatch-kpi-sub">Awaiting worker assignment</span>
            </article>

            <article className="dispatch-kpi-card">
              <div className="dispatch-kpi-head">
                <span className="dispatch-kpi-label">Critical / High Priority</span>
                <span className="dispatch-kpi-dot critical" aria-hidden="true" />
              </div>
              <p className="dispatch-kpi-val">{kpis.criticalHigh}</p>
              <span className="dispatch-kpi-sub">Urgent remediation needed</span>
            </article>

            <article className="dispatch-kpi-card">
              <div className="dispatch-kpi-head">
                <span className="dispatch-kpi-label">Workers On Duty</span>
                <span className="dispatch-kpi-dot workers" aria-hidden="true" />
              </div>
              <p className="dispatch-kpi-val">{kpis.onDutyWorkers}</p>
              <span className="dispatch-kpi-sub">Active field crew available</span>
            </article>
          </div>
        </section>

        {/* SECTION 3: INTERACTIVE FILTER BAR */}
        <section className="dispatch-filter-card" aria-label="Dispatch Map Filters">
          <div className="dispatch-filter-row">
            {/* Status Filters */}
            <div className="dispatch-filter-group">
              <span className="dispatch-filter-label">Status:</span>
              <div className="dispatch-filter-pills" role="radiogroup" aria-label="Filter by incident status">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`dispatch-filter-btn ${statusFilter === s ? 'active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                    aria-pressed={statusFilter === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Severity Filters */}
            <div className="dispatch-filter-group">
              <span className="dispatch-filter-label">Severity:</span>
              <div className="dispatch-filter-pills" role="radiogroup" aria-label="Filter by severity">
                {SEVERITY_FILTERS.map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    className={`dispatch-filter-btn ${severityFilter === sev ? 'active' : ''}`}
                    onClick={() => setSeverityFilter(sev)}
                    aria-pressed={severityFilter === sev}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Assignment Filters */}
            <div className="dispatch-filter-group">
              <span className="dispatch-filter-label">Assignment:</span>
              <div className="dispatch-filter-pills" role="radiogroup" aria-label="Filter by assignment">
                {ASSIGNMENT_FILTERS.map((asgn) => (
                  <button
                    key={asgn}
                    type="button"
                    className={`dispatch-filter-btn ${assignmentFilter === asgn ? 'active' : ''}`}
                    onClick={() => setAssignmentFilter(asgn)}
                    aria-pressed={assignmentFilter === asgn}
                  >
                    {asgn}
                  </button>
                ))}
              </div>
            </div>

            {/* Worker Layer Toggle */}
            <div className="dispatch-filter-group">
              <label className="dispatch-toggle-label">
                <input
                  type="checkbox"
                  checked={showWorkers}
                  onChange={(e) => setShowWorkers(e.target.checked)}
                  className="dispatch-toggle-checkbox"
                />
                <span>👷 Show On-Duty Workers</span>
              </label>
            </div>

            {/* Reset Filters */}
            <button
              type="button"
              className="dispatch-reset-btn"
              onClick={handleResetFilters}
              title="Reset all filters to default"
            >
              Reset Filters
            </button>
          </div>
        </section>

        {/* Error Alert */}
        {error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Dispatch Data Error</p>
            <p className="admin-state-desc">{error}</p>
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleRefresh}
            >
              Try Again
            </button>
          </div>
        )}

        {/* SECTION 4: MAIN DISPATCH MAP */}
        <section aria-label="Municipal Geographic Dispatch Map">
          <DispatchMap
            reports={filteredReports}
            workers={workers}
            showWorkers={showWorkers}
            onSelectReport={(r) => setSelectedReport(r)}
          />
        </section>

        {/* SECTION 5: SELECTED INCIDENT QUICK-ACTION DRAWER */}
        {selectedReport && (
          <section className="dispatch-selected-drawer" aria-labelledby="selected-incident-heading">
            <div className="selected-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  className={`admin-severity-badge severity-${(selectedReport.severity || 'medium').toLowerCase()}`}
                >
                  {(selectedReport.severity || 'MEDIUM').toUpperCase()}
                </span>
                <h2 id="selected-incident-heading" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                  {selectedReport.title}
                </h2>
                <ReportStatusBadge status={selectedReport.status} size="small" />
              </div>

              <button
                type="button"
                className="btn-admin-secondary btn-admin-sm"
                onClick={() => setSelectedReport(null)}
                aria-label="Close incident inspection card"
              >
                ✕ Close
              </button>
            </div>

            <div className="selected-drawer-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                <div>
                  <strong>Waste Category:</strong>{' '}
                  {GARBAGE_TYPE_LABELS[selectedReport.garbage_type] || selectedReport.garbage_type}
                </div>
                <div>
                  <strong>Address / Landmark:</strong>{' '}
                  📍 {selectedReport.address || `${selectedReport.latitude.toFixed(5)}°, ${selectedReport.longitude.toFixed(5)}°`}
                </div>
                {selectedReport.description && (
                  <div style={{ color: 'var(--admin-text-body)', fontStyle: 'italic', marginTop: '4px' }}>
                    &ldquo;{selectedReport.description}&rdquo;
                  </div>
                )}
                <div>
                  <strong>Assigned Worker:</strong>{' '}
                  {selectedReport.assigned_worker?.full_name ? (
                    <span style={{ color: 'var(--admin-primary)', fontWeight: 700 }}>
                      👤 {selectedReport.assigned_worker.full_name}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--admin-warning, #B45309)', fontWeight: 700 }}>
                      ⚠️ Unassigned — Available for Dispatch
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.65rem' }}>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedReport.latitude},${selectedReport.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-admin-primary"
                  style={{ textAlign: 'center', textDecoration: 'none' }}
                  id={`drawer-nav-${selectedReport.id}`}
                >
                  🧭 NAVIGATE TO INCIDENT ↗
                </a>
                <Link
                  to={`/admin/reports/${selectedReport.id}`}
                  className="btn-admin-secondary"
                  style={{ textAlign: 'center', textDecoration: 'none' }}
                  id={`drawer-view-${selectedReport.id}`}
                >
                  Inspect Full Report &rarr;
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
