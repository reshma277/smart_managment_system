import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import DispatchMap from '../../components/admin/DispatchMap';
import { getReportOverallSla } from '../../utils/sla';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';

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

function formatDuration(ms) {
  if (!ms || ms <= 0 || Number.isNaN(ms)) return '—';
  const minutes = Math.round(ms / (1000 * 60));
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export default function AdminDashboard() {
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    totalReports: 0,
    activeReports: 0,
    resolvedReports: 0,
    criticalHighReports: 0,
    slaApproaching: 0,
    slaBreached: 0,
    reported: 0,
    assigned: 0,
    accepted: 0,
    inProgress: 0,
    resolved: 0,
    totalWorkers: 0,
    activeWorkers: 0,
    assignedTasks: 0,
    totalCitizens: 0,
  });

  const [garbageTypeCounts, setGarbageTypeCounts] = useState([]);
  const [workerSnapshot, setWorkerSnapshot] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const [mapReports, setMapReports] = useState([]);
  const [mapWorkers, setMapWorkers] = useState([]);
  const [durations, setDurations] = useState({
    avgAssignment: '—',
    avgCleanup: '—',
    avgResolution: '—',
    assignmentCount: 0,
    cleanupCount: 0,
    resolutionCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        // 1. Fetch report distribution, severity, and milestone timestamps in a single atomic query
        const { data: reportRows, error: reportsErr } = await supabase
          .from('reports')
          .select('id, title, status, severity, garbage_type, latitude, longitude, address, assigned_worker_id, created_at, assigned_at, in_progress_at, resolved_at');

        if (reportsErr) {
          console.error('Error fetching report stats:', reportsErr);
          if (isMounted) setError('Unable to load municipal incident metrics. Please check network connectivity or access permissions.');
          return;
        }

        const reportsList = reportRows || [];
        const reportedCount = reportsList.filter((r) => r.status === 'Reported').length;
        const assignedCount = reportsList.filter((r) => r.status === 'Assigned').length;
        const acceptedCount = reportsList.filter((r) => r.status === 'Accepted').length;
        const inProgressCount = reportsList.filter((r) => r.status === 'In Progress').length;
        const resolvedCount = reportsList.filter((r) => r.status === 'Resolved').length;
        const activeCount = reportedCount + assignedCount + acceptedCount + inProgressCount;
        const criticalHighCount = reportsList.filter(
          (r) => (r.severity === 'critical' || r.severity === 'high') && r.status !== 'Resolved' && r.status !== 'Cancelled'
        ).length;

        // SLA performance aggregation across active reports
        let slaApproachingCount = 0;
        let slaBreachedCount = 0;
        reportsList.forEach((r) => {
          if (r.status !== 'Resolved' && r.status !== 'Cancelled') {
            const overallSla = getReportOverallSla(r);
            if (overallSla.state === 'breached') {
              slaBreachedCount += 1;
            } else if (overallSla.state === 'approaching') {
              slaApproachingCount += 1;
            }
          }
        });

        // Garbage type distribution breakdown
        const typeMap = {};
        reportsList.forEach((r) => {
          const type = r.garbage_type || 'general';
          typeMap[type] = (typeMap[type] || 0) + 1;
        });

        const typeList = Object.entries(typeMap)
          .map(([key, count]) => ({
            key,
            label: GARBAGE_TYPE_LABELS[key] || key,
            count,
            percentage: reportsList.length > 0 ? Math.round((count / reportsList.length) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        // 2. Fetch worker roster and workload distribution
        let totalWorkersCount = 0;
        let activeWorkersCount = 0;
        let enrichedWorkers = [];

        try {
          const { data: workerProfiles, error: workerErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, is_active, current_location, last_location_updated_at')
            .eq('role', 'worker');

          if (!workerErr && workerProfiles) {
            totalWorkersCount = workerProfiles.length;
            activeWorkersCount = workerProfiles.filter((w) => w.is_active !== false).length;

            // Map workload per worker
            const workerActiveMap = {};
            const workerInProgressMap = {};
            reportsList.forEach((r) => {
              if (r.assigned_worker_id && r.status !== 'Resolved' && r.status !== 'Cancelled') {
                workerActiveMap[r.assigned_worker_id] = (workerActiveMap[r.assigned_worker_id] || 0) + 1;
                if (r.status === 'In Progress') {
                  workerInProgressMap[r.assigned_worker_id] = (workerInProgressMap[r.assigned_worker_id] || 0) + 1;
                }
              }
            });

            enrichedWorkers = workerProfiles.map((w) => ({
              ...w,
              activeTasks: workerActiveMap[w.id] || 0,
              inProgressTasks: workerInProgressMap[w.id] || 0,
            })).sort((a, b) => b.activeTasks - a.activeTasks);
          }
        } catch (wErr) {
          console.warn('Worker profiles fetch error:', wErr);
        }

        // 3. Fetch citizen roster count
        let totalCitizensCount = 0;
        try {
          const { count: cCount, error: cErr } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'citizen');

          if (!cErr && typeof cCount === 'number') {
            totalCitizensCount = cCount;
          }
        } catch (cErr) {
          console.warn('Citizen count fetch error:', cErr);
        }

        // 4. Fetch most recent reports with assigned worker lookup
        const { data: recentList, error: recentErr } = await supabase
          .from('reports')
          .select('id, title, garbage_type, severity, status, address, assigned_worker_id, created_at')
          .order('created_at', { ascending: false })
          .limit(8);

        if (recentErr) {
          console.error('Error fetching recent reports:', recentErr);
          if (isMounted) setError('Unable to load recent incident feed.');
          return;
        }

        let enrichedRecent = recentList || [];
        const workerIds = [...new Set(enrichedRecent.map((r) => r.assigned_worker_id).filter(Boolean))];

        if (workerIds.length > 0) {
          try {
            const { data: workers } = await supabase
              .from('public_profiles')
              .select('id, full_name, role')
              .in('id', workerIds);

            if (workers) {
              const workerMap = workers.reduce((acc, w) => {
                acc[w.id] = w;
                return acc;
              }, {});

              enrichedRecent = enrichedRecent.map((r) => ({
                ...r,
                assignedWorker: workerMap[r.assigned_worker_id] || null,
              }));
            }
          } catch (workerMapErr) {
            console.warn('Worker name enrichment error:', workerMapErr);
          }
        }

        if (isMounted) {
          setStats({
            totalReports: reportsList.length,
            activeReports: activeCount,
            resolvedReports: resolvedCount,
            criticalHighReports: criticalHighCount,
            slaApproaching: slaApproachingCount,
            slaBreached: slaBreachedCount,
            reported: reportedCount,
            assigned: assignedCount,
            accepted: acceptedCount,
            inProgress: inProgressCount,
            resolved: resolvedCount,
            totalWorkers: totalWorkersCount,
            activeWorkers: activeWorkersCount,
            assignedTasks: assignedCount + acceptedCount + inProgressCount,
            totalCitizens: totalCitizensCount,
          });

          // Calculate operational turnaround & duration metrics from real timestamps
          let totalAssignmentMs = 0;
          let countAssignment = 0;
          let totalCleanupMs = 0;
          let countCleanup = 0;
          let totalResolutionMs = 0;
          let countResolution = 0;

          reportsList.forEach((r) => {
            if (r.created_at && r.assigned_at) {
              const diff = new Date(r.assigned_at) - new Date(r.created_at);
              if (diff >= 0) {
                totalAssignmentMs += diff;
                countAssignment += 1;
              }
            }
            if (r.in_progress_at && r.resolved_at) {
              const diff = new Date(r.resolved_at) - new Date(r.in_progress_at);
              if (diff >= 0) {
                totalCleanupMs += diff;
                countCleanup += 1;
              }
            }
            if (r.created_at && r.resolved_at) {
              const diff = new Date(r.resolved_at) - new Date(r.created_at);
              if (diff >= 0) {
                totalResolutionMs += diff;
                countResolution += 1;
              }
            }
          });

          setDurations({
            avgAssignment: countAssignment > 0 ? formatDuration(totalAssignmentMs / countAssignment) : '—',
            avgCleanup: countCleanup > 0 ? formatDuration(totalCleanupMs / countCleanup) : '—',
            avgResolution: countResolution > 0 ? formatDuration(totalResolutionMs / countResolution) : '—',
            assignmentCount: countAssignment,
            cleanupCount: countCleanup,
            resolutionCount: countResolution,
          });

          setGarbageTypeCounts(typeList);
          setWorkerSnapshot(enrichedWorkers.slice(0, 5));
          setRecentReports(enrichedRecent);
          setMapReports(reportsList);
          setMapWorkers(enrichedWorkers);
          setLastRefreshed(new Date());
          setError(null);
        }
      } catch (err) {
        console.error('Admin dashboard fetch exception:', err);
        if (isMounted) setError('Network error occurred while synchronizing operations data.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDashboardData();

    // Supabase Realtime: subscribe to reports changes
    const reportsChannel = supabase
      .channel('admin-dash-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        () => {
          loadDashboardData();
        }
      )
      .subscribe();

    // Supabase Realtime: subscribe to profile changes
    const profilesChannel = supabase
      .channel('admin-dash-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          loadDashboardData();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(profilesChannel);
    };
  }, [refreshKey]);

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* SECTION 1 — MUNICIPAL COMMAND HEADER */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">MUNICIPAL COMMAND</span>
              <span className="admin-role-badge">
                <span aria-hidden="true">🏛️</span> Dispatch Console
              </span>
            </div>
            <h1 className="admin-title">Municipal Operations</h1>
            <p className="admin-subtitle">
              Monitor incidents, dispatch workers, and oversee cleanup operations.
            </p>
          </div>

          <div className="admin-header-actions">
            <Link to="/admin/map" className="btn-admin-primary">
              🗺️ Dispatch Map &rarr;
            </Link>
            <Link to="/admin/reports" className="btn-admin-secondary">
              Manage Reports
            </Link>
            <Link to="/admin/workers" className="btn-admin-secondary">
              Field Workers
            </Link>
            <Link to="/admin/schedules" className="btn-admin-secondary">
              Schedules
            </Link>
            <Link to="/admin/fleet" className="btn-admin-secondary">
              🚛 Fleet
            </Link>
            <button
              type="button"
              className="btn-admin-secondary btn-admin-sm"
              onClick={handleRetry}
              disabled={loading}
              title={`Last synchronized: ${lastRefreshed.toLocaleTimeString()}`}
            >
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>
        </header>

        {/* Loading State */}
        {loading && (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="admin-state-title">Loading Municipal Operations...</p>
            <p className="admin-state-desc">Synchronizing real-time field metrics, dispatch queue, and staffing levels.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Unable to Load Operations Data</p>
            <p className="admin-state-desc">{error}</p>
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* SECTION 2 — SIMPLE KPI ROW (6 METRICS: 3x2) */}
            <section aria-label="Municipal Key Performance Indicators">
              <div className="admin-kpi-grid">
                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">Open Incidents</span>
                    <span className="admin-kpi-indicator warning" aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val">{stats.activeReports}</p>
                  <p className="admin-kpi-sub">Awaiting remediation or active</p>
                </article>

                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">SLA Approaching</span>
                    <span className="admin-kpi-indicator" style={{ background: '#D97706' }} aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val" style={{ color: '#D97706' }}>{stats.slaApproaching}</p>
                  <p className="admin-kpi-sub">Near breach threshold (&ge;75%)</p>
                </article>

                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">SLA Breached</span>
                    <span className="admin-kpi-indicator danger" aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val" style={{ color: 'var(--admin-critical)' }}>{stats.slaBreached}</p>
                  <p className="admin-kpi-sub">Exceeded response or resolution</p>
                </article>

                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">Avg. Assignment Time</span>
                    <span className="admin-kpi-indicator info" aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val">{durations.avgAssignment}</p>
                  <p className="admin-kpi-sub">
                    {durations.assignmentCount > 0 ? `${durations.assignmentCount} verified dispatches` : 'Awaiting data'}
                  </p>
                </article>

                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">Avg. Resolution Time</span>
                    <span className="admin-kpi-indicator success" aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val">{durations.avgResolution}</p>
                  <p className="admin-kpi-sub">
                    {durations.resolutionCount > 0 ? `${durations.resolutionCount} completed cleanups` : 'Awaiting data'}
                  </p>
                </article>

                <article className="admin-kpi-card">
                  <div className="admin-kpi-header">
                    <span className="admin-kpi-label">Resolved Incidents</span>
                    <span className="admin-kpi-indicator success" aria-hidden="true" />
                  </div>
                  <p className="admin-kpi-val">{stats.resolvedReports}</p>
                  <p className="admin-kpi-sub">{stats.totalReports} total filed reports</p>
                </article>
              </div>
            </section>

            {/* OPERATIONAL TURNAROUND & EFFICIENCY METRICS */}
            <section className="admin-section" aria-labelledby="efficiency-metrics-heading">
              <div className="admin-section-header-row">
                <div className="admin-section-title-wrap">
                  <h2 id="efficiency-metrics-heading">Response &amp; Resolution Times</h2>
                  <p>Turnaround intervals calculated from verified milestone timestamps.</p>
                </div>
              </div>

              <div className="admin-efficiency-grid">
                <article className="admin-efficiency-card">
                  <div className="efficiency-card-head">
                    <span className="efficiency-icon" aria-hidden="true">⏱️</span>
                    <span className="efficiency-label">Avg. Time to Assignment</span>
                  </div>
                  <p className="efficiency-val">{durations.avgAssignment}</p>
                  <span className="efficiency-sub">
                    {durations.assignmentCount > 0
                      ? `From reported to worker assigned (${durations.assignmentCount} incidents)`
                      : 'Awaiting verified assignment data'}
                  </span>
                </article>

                <article className="admin-efficiency-card">
                  <div className="efficiency-card-head">
                    <span className="efficiency-icon" aria-hidden="true">🧹</span>
                    <span className="efficiency-label">Avg. Cleanup Duration</span>
                  </div>
                  <p className="efficiency-val">{durations.avgCleanup}</p>
                  <span className="efficiency-sub">
                    {durations.cleanupCount > 0
                      ? `From in-progress start to resolved (${durations.cleanupCount} cleanups)`
                      : 'Awaiting in-progress cleanup data'}
                  </span>
                </article>

                <article className="admin-efficiency-card">
                  <div className="efficiency-card-head">
                    <span className="efficiency-icon" aria-hidden="true">✅</span>
                    <span className="efficiency-label">Avg. Total Resolution</span>
                  </div>
                  <p className="efficiency-val">{durations.avgResolution}</p>
                  <span className="efficiency-sub">
                    {durations.resolutionCount > 0
                      ? `From filing to final certification (${durations.resolutionCount} resolved)`
                      : 'Awaiting certified completion data'}
                  </span>
                </article>
              </div>
            </section>

            {/* SECTION 3 — OPERATIONS OVERVIEW: REPORT STATUS BREAKDOWN */}
            <section className="admin-section" aria-labelledby="status-overview-heading">
              <div className="admin-section-header-row">
                <div className="admin-section-title-wrap">
                  <h2 id="status-overview-heading">Operations Overview</h2>
                  <p>Real-time lifecycle distribution across municipal cleanup stages.</p>
                </div>
              </div>

              <div className="admin-status-strip">
                <div className="status-step-box">
                  <span className="status-step-label">Reported</span>
                  <p className="status-step-count">{stats.reported}</p>
                  <span className="status-step-desc">Awaiting worker assignment</span>
                </div>

                <div className="status-step-box">
                  <span className="status-step-label">Assigned</span>
                  <p className="status-step-count">{stats.assigned}</p>
                  <span className="status-step-desc">Routed to field operator</span>
                </div>

                <div className="status-step-box">
                  <span className="status-step-label">Accepted</span>
                  <p className="status-step-count">{stats.accepted}</p>
                  <span className="status-step-desc">Staff en-route to site</span>
                </div>

                <div className="status-step-box">
                  <span className="status-step-label">In Progress</span>
                  <p className="status-step-count">{stats.inProgress}</p>
                  <span className="status-step-desc">Active remediation on-site</span>
                </div>

                <div className="status-step-box">
                  <span className="status-step-label">Resolved</span>
                  <p className="status-step-count">{stats.resolved}</p>
                  <span className="status-step-desc">Verified cleanup certified</span>
                </div>
              </div>
            </section>

            {/* OPERATIONAL DISPATCH MAP PREVIEW CARD */}
            <section className="admin-section" aria-labelledby="dispatch-preview-heading">
              <div className="admin-section-header-row">
                <div className="admin-section-title-wrap">
                  <h2 id="dispatch-preview-heading">Operational Dispatch Map Preview</h2>
                  <p>Live geospatial overview of active municipal incidents and deployed field personnel.</p>
                </div>
                <Link to="/admin/map" className="btn-admin-primary btn-admin-sm" id="btn-open-dispatch-map">
                  🗺️ OPEN DISPATCH MAP &rarr;
                </Link>
              </div>

              <DispatchMap
                reports={mapReports.filter((r) => r.status !== 'Resolved' && r.status !== 'Cancelled')}
                workers={mapWorkers}
                compact={true}
                height="280px"
              />
            </section>

            {/* SECTION 4 & 5 — SPLIT VIEW: GARBAGE TYPE BREAKDOWN & WORKER OPERATIONS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }} className="admin-split-grid">
              {/* Reports by Garbage Type */}
              <section className="admin-section" aria-labelledby="garbage-types-heading">
                <div className="admin-section-header-row">
                  <div className="admin-section-title-wrap">
                    <h2 id="garbage-types-heading">Reports by Garbage Type</h2>
                    <p>What types of incidents are we receiving?</p>
                  </div>
                </div>

                <div className="admin-card">
                  {garbageTypeCounts.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-text-body)' }}>No reports recorded yet.</p>
                  ) : (
                    <div className="garbage-dist-grid" style={{ gridTemplateColumns: '1fr' }}>
                      {garbageTypeCounts.map((type) => (
                        <div key={type.key} className="garbage-dist-item">
                          <div className="garbage-dist-header">
                            <span>{type.label}</span>
                            <span><strong>{type.count}</strong> ({type.percentage}%)</span>
                          </div>
                          <div className="garbage-dist-track">
                            <div
                              className="garbage-dist-fill"
                              style={{ width: `${Math.max(type.percentage, 4)}%` }}
                              aria-valuenow={type.percentage}
                              aria-valuemin="0"
                              aria-valuemax="100"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Worker Operations Snapshot */}
              <section className="admin-section" aria-labelledby="worker-ops-heading">
                <div className="admin-section-header-row">
                  <div className="admin-section-title-wrap">
                    <h2 id="worker-ops-heading">Worker Operations</h2>
                    <p>Workforce availability and field workload snapshot.</p>
                  </div>
                  <Link to="/admin/workers" className="btn-admin-secondary btn-admin-sm">
                    View Roster &rarr;
                  </Link>
                </div>

                <div className="admin-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-bg)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--admin-border)' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>Active Workers</span>
                      <p style={{ margin: '0.1rem 0 0 0', fontSize: '1.25rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>{stats.activeWorkers}</p>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>Assigned Tasks</span>
                      <p style={{ margin: '0.1rem 0 0 0', fontSize: '1.25rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>{stats.assignedTasks}</p>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)', textTransform: 'uppercase' }}>In Progress</span>
                      <p style={{ margin: '0.1rem 0 0 0', fontSize: '1.25rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>{stats.inProgress}</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {workerSnapshot.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-text-body)' }}>No active field workers registered.</p>
                    ) : (
                      workerSnapshot.map((w) => (
                        <div
                          key={w.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '8px',
                            border: '1px solid var(--admin-border-subtle)',
                            background: '#FFFFFF',
                            fontSize: '0.85rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span className={`duty-pill ${w.is_active !== false ? 'on-duty' : 'off-duty'}`}>
                              {w.is_active !== false ? '🟢 ON' : '⚪ OFF'}
                            </span>
                            <span style={{ fontWeight: 700, color: 'var(--admin-text-h)' }}>{w.full_name}</span>
                          </div>
                          <span style={{ color: 'var(--admin-text-body)', fontSize: '0.8rem' }}>
                            <strong>{w.activeTasks}</strong> open task{w.activeTasks === 1 ? '' : 's'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* SECTION 6 — RECENT INCIDENTS */}
            <section className="admin-section" aria-labelledby="recent-incidents-heading">
              <div className="admin-section-header-row">
                <div className="admin-section-title-wrap">
                  <h2 id="recent-incidents-heading">Recent Incidents</h2>
                  <p>Latest incident reports received by municipal dispatch.</p>
                </div>
                <Link to="/admin/reports" className="btn-admin-secondary btn-admin-sm">
                  View All Reports ({stats.totalReports}) &rarr;
                </Link>
              </div>

              {recentReports.length === 0 ? (
                <div className="admin-state-box">
                  <span className="admin-state-icon" aria-hidden="true">📋</span>
                  <h3 className="admin-state-title">No Incident Reports Filed</h3>
                  <p className="admin-state-desc">When citizens submit reports, they will appear here in real time.</p>
                </div>
              ) : (
                <div className="admin-table-card">
                  <div className="admin-table-wrapper">
                    <table className="admin-table" aria-label="Recent Municipal Reports">
                      <thead>
                        <tr>
                          <th scope="col">Severity</th>
                          <th scope="col">ID</th>
                          <th scope="col">Title &amp; Location</th>
                          <th scope="col">Category</th>
                          <th scope="col">Status</th>
                          <th scope="col">Assigned Worker</th>
                          <th scope="col">Time</th>
                          <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentReports.map((report) => {
                          const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          return (
                            <tr
                              key={report.id}
                              onClick={() => navigate(`/admin/reports/${report.id}`)}
                              title={`Inspect incident ${report.id}`}
                              style={{ cursor: 'pointer' }}
                            >
                              <td>
                                <span className={`admin-severity-badge severity-${(report.severity || 'medium').toLowerCase()}`}>
                                  {report.severity?.toUpperCase() || 'MEDIUM'}
                                </span>
                              </td>
                              <td>
                                <span className="ref-id-badge">#{report.id.slice(0, 8)}</span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--admin-text-h)' }}>{report.title}</span>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                                    📍 {report.address || 'Coordinates Recorded'}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                                  {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                                </span>
                              </td>
                              <td>
                                <ReportStatusBadge status={report.status} size="small" />
                              </td>
                              <td>
                                {report.assignedWorker ? (
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                                    👤 {report.assignedWorker.full_name}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--admin-warning)', fontStyle: 'italic' }}>
                                    Unassigned
                                  </span>
                                )}
                              </td>
                              <td>
                                <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)', whiteSpace: 'nowrap' }}>
                                  {createdDate}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-primary)' }}>
                                  VIEW &rarr;
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
