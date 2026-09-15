import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';
import '../../styles/citizen-tracking.css';

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

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const [stats, setStats] = useState({
    totalReports: 0,
    reported: 0,
    assigned: 0,
    accepted: 0,
    inProgress: 0,
    resolved: 0,
    cancelled: 0,
    totalWorkers: 0,
    activeWorkers: 0,
    totalCitizens: 0,
  });

  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [refreshKey, setRefreshKey] = useState(0);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Administrator';
  const displayEmail = profile?.email || user?.email || '';

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        // 1. Fetch report status distribution in a single atomic query
        const { data: reportRows, error: reportsErr } = await supabase
          .from('reports')
          .select('status');

        if (reportsErr) {
          console.error('Error fetching report stats:', reportsErr);
          if (isMounted) setError('Unable to load municipal incident metrics. Please verify network or access permissions.');
          return;
        }

        const reportsList = reportRows || [];
        const reportCounts = {
          totalReports: reportsList.length,
          reported: reportsList.filter((r) => r.status === 'Reported').length,
          assigned: reportsList.filter((r) => r.status === 'Assigned').length,
          accepted: reportsList.filter((r) => r.status === 'Accepted').length,
          inProgress: reportsList.filter((r) => r.status === 'In Progress').length,
          resolved: reportsList.filter((r) => r.status === 'Resolved').length,
          cancelled: reportsList.filter((r) => r.status === 'Cancelled').length,
        };

        // 2. Fetch worker staffing counts (permitted under profiles_select_owner_or_admin)
        let totalWorkersCount = 0;
        let activeWorkersCount = 0;

        try {
          const { data: workerProfiles, error: workerErr } = await supabase
            .from('profiles')
            .select('id, is_active')
            .eq('role', 'worker');

          if (!workerErr && workerProfiles) {
            totalWorkersCount = workerProfiles.length;
            activeWorkersCount = workerProfiles.filter((w) => w.is_active !== false).length;
          }
        } catch (wErr) {
          console.warn('Worker profiles fetch error:', wErr);
        }

        // 3. Fetch citizen roster count (permitted under profiles_select_owner_or_admin)
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

        // 4. Fetch 10 most recent reports with assigned worker lookup
        const { data: recentList, error: recentErr } = await supabase
          .from('reports')
          .select('id, title, garbage_type, severity, status, address, assigned_worker_id, created_at')
          .order('created_at', { ascending: false })
          .limit(10);

        if (recentErr) {
          console.error('Error fetching recent reports:', recentErr);
          if (isMounted) setError('Unable to load recent incident feed.');
          return;
        }

        // 5. Look up worker public names for assigned reports
        let enrichedReports = recentList || [];
        const workerIds = [...new Set(enrichedReports.map((r) => r.assigned_worker_id).filter(Boolean))];

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

              enrichedReports = enrichedReports.map((r) => ({
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
            ...reportCounts,
            totalWorkers: totalWorkersCount,
            activeWorkers: activeWorkersCount,
            totalCitizens: totalCitizensCount,
          });
          setRecentReports(enrichedReports);
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

    // Supabase Realtime: subscribe to all report changes for live incident counters
    const reportsChannel = supabase
      .channel('admin-dash-reports')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
        },
        () => {
          loadDashboardData();
        }
      )
      .subscribe();

    // Supabase Realtime: subscribe to profile changes for live worker and citizen counts
    const profilesChannel = supabase
      .channel('admin-dash-profiles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
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
        {/* Hero Banner */}
        <section className="admin-hero-card" aria-label="Administrator Overview">
          <div className="admin-hero-top">
            <div className="admin-header-info">
              <div className="admin-header-icon" aria-hidden="true">
                🛡️
              </div>
              <div className="admin-header-text">
                <h1>Municipal Operations Console</h1>
                <div className="admin-meta">
                  <span className="admin-badge-pill">
                    <span aria-hidden="true">🏛️</span> Administrator
                  </span>
                  <span>{displayName}</span>
                  {displayEmail && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text)', opacity: 0.85 }}>
                      ({displayEmail})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="admin-hero-actions">
              <Link
                to="/admin/reports"
                className="btn-form-submit"
                style={{ padding: '0.55rem 1rem', fontSize: '0.875rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>📋</span> Manage All Reports
              </Link>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={handleRetry}
                disabled={loading}
                style={{ padding: '0.55rem 1rem', fontSize: '0.875rem' }}
                title="Refresh dashboard metrics"
              >
                <span>🔄</span> {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text)', borderTop: '1px solid var(--border)', paddingTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>Real-time municipal dispatch & staff metrics.</span>
            <span>Last synchronized: {lastRefreshed.toLocaleTimeString()}</span>
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '36px', height: '36px' }} />
            <p className="state-title">Loading Municipal Operations Console...</p>
            <p className="state-desc">Aggregating real-time incident reports, worker roster, and citizen metrics.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Unable to Load Operations Console</p>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Content View */}
        {!loading && !error && (
          <>
            {/* 1. Core Summary Cards: Reports, Active Queue, Workers, Citizens */}
            <section aria-labelledby="core-metrics-heading">
              <div className="admin-section-header">
                <div>
                  <h2 id="core-metrics-heading" className="admin-section-title">
                    <span aria-hidden="true">📊</span> System Overview
                  </h2>
                  <p className="admin-section-subtitle">City-wide waste statistics and municipal staffing levels</p>
                </div>
              </div>

              <div className="admin-stats-grid">
                {/* Total Reports */}
                <div className="admin-stat-card">
                  <div className="admin-stat-card-header">
                    <span className="admin-stat-card-label">Total Reports</span>
                    <span className="admin-stat-card-icon" aria-hidden="true">📋</span>
                  </div>
                  <p className="admin-stat-card-value">{stats.totalReports}</p>
                  <p className="admin-stat-card-desc">All incidents recorded city-wide</p>
                </div>

                {/* Active Incidents */}
                <div className="admin-stat-card">
                  <div className="admin-stat-card-header">
                    <span className="admin-stat-card-label">Active Incidents</span>
                    <span className="admin-stat-card-icon" aria-hidden="true">⚡</span>
                  </div>
                  <p className="admin-stat-card-value" style={{ color: '#d97706' }}>
                    {stats.reported + stats.assigned + stats.accepted + stats.inProgress}
                  </p>
                  <p className="admin-stat-card-desc">Reported, assigned, or in progress</p>
                </div>

                {/* Field Workers */}
                <div className="admin-stat-card">
                  <div className="admin-stat-card-header">
                    <span className="admin-stat-card-label">Field Workers</span>
                    <span className="admin-stat-card-icon" aria-hidden="true">👷</span>
                  </div>
                  <p className="admin-stat-card-value" style={{ color: '#7e22ce' }}>
                    {stats.totalWorkers}
                  </p>
                  <p className="admin-stat-card-desc">
                    <strong>{stats.activeWorkers}</strong> on-duty / active staff
                  </p>
                </div>

                {/* Registered Citizens */}
                <div className="admin-stat-card">
                  <div className="admin-stat-card-header">
                    <span className="admin-stat-card-label">Registered Citizens</span>
                    <span className="admin-stat-card-icon" aria-hidden="true">👥</span>
                  </div>
                  <p className="admin-stat-card-value" style={{ color: '#059669' }}>
                    {stats.totalCitizens}
                  </p>
                  <p className="admin-stat-card-desc">Verified community accounts</p>
                </div>
              </div>
            </section>

            {/* 2. Report Status Breakdown: 6 Status Pillars */}
            <section aria-labelledby="status-breakdown-heading">
              <div className="admin-section-header">
                <div>
                  <h2 id="status-breakdown-heading" className="admin-section-title">
                    <span aria-hidden="true">📈</span> Incident Lifecycle Breakdown
                  </h2>
                  <p className="admin-section-subtitle">Real-time status tracking across municipal dispatch stages</p>
                </div>
              </div>

              <div className="status-breakdown-grid">
                <div className="status-mini-card status-reported">
                  <span className="status-mini-label">Reported</span>
                  <p className="status-mini-count">{stats.reported}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Awaiting Worker</span>
                </div>

                <div className="status-mini-card status-assigned">
                  <span className="status-mini-label">Assigned</span>
                  <p className="status-mini-count">{stats.assigned}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Routed to Staff</span>
                </div>

                <div className="status-mini-card status-accepted">
                  <span className="status-mini-label">Accepted</span>
                  <p className="status-mini-count">{stats.accepted}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Worker En Route</span>
                </div>

                <div className="status-mini-card status-inprogress">
                  <span className="status-mini-label">In Progress</span>
                  <p className="status-mini-count">{stats.inProgress}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Active Cleanup</span>
                </div>

                <div className="status-mini-card status-resolved">
                  <span className="status-mini-label">Resolved</span>
                  <p className="status-mini-count">{stats.resolved}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Verified Complete</span>
                </div>

                <div className="status-mini-card status-cancelled">
                  <span className="status-mini-label">Cancelled</span>
                  <p className="status-mini-count">{stats.cancelled}</p>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text)' }}>Closed / Retracted</span>
                </div>
              </div>
            </section>

            {/* 3. Recent Reports Table */}
            <section aria-labelledby="recent-reports-heading">
              <div className="admin-section-header">
                <div>
                  <h2 id="recent-reports-heading" className="admin-section-title">
                    <span aria-hidden="true">📋</span> Most Recent Incident Reports
                  </h2>
                  <p className="admin-section-subtitle">
                    Latest submissions received by municipal dispatch (showing up to 10 incidents)
                  </p>
                </div>
                <Link
                  to="/admin/reports"
                  className="btn-form-cancel"
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.825rem', textDecoration: 'none' }}
                >
                  View All Reports &rarr;
                </Link>
              </div>

              {recentReports.length === 0 ? (
                <div className="state-box" style={{ padding: '3rem 1.5rem' }}>
                  <span className="state-icon" aria-hidden="true">🗑️</span>
                  <h3 className="state-title">No Incident Reports Filed</h3>
                  <p className="state-desc">When citizens submit uncollected garbage reports, they will appear here in real time.</p>
                </div>
              ) : (
                <div className="admin-table-card">
                  <div className="admin-table-wrapper">
                    <table className="admin-table" aria-label="Recent Reports Table">
                      <thead>
                        <tr>
                          <th scope="col">Reference</th>
                          <th scope="col">Incident & Location</th>
                          <th scope="col">Garbage Type</th>
                          <th scope="col">Severity</th>
                          <th scope="col">Status</th>
                          <th scope="col">Assigned Worker</th>
                          <th scope="col">Date Filed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentReports.map((report) => {
                          const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });

                          return (
                            <tr
                              key={report.id}
                              onClick={() => navigate(`/admin/reports/${report.id}`)}
                              title={`View report ${report.id}`}
                            >
                              <td>
                                <span className="report-card-ref-badge" title={report.id}>
                                  #{report.id.slice(0, 8)}
                                </span>
                              </td>
                              <td>
                                <div className="report-title-cell">
                                  <span className="report-title-text">{report.title}</span>
                                  <span className="report-address-sub" title={report.address}>
                                    📍 {report.address || 'GPS Coordinates Recorded'}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className="tag-garbage-type">
                                  {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                                </span>
                              </td>
                              <td>
                                <span className={`severity-badge severity-${report.severity}`}>
                                  {report.severity}
                                </span>
                              </td>
                              <td>
                                <ReportStatusBadge status={report.status} size="small" />
                              </td>
                              <td>
                                {report.assignedWorker ? (
                                  <span className="worker-cell-badge">
                                    <span aria-hidden="true">👤</span> {report.assignedWorker.full_name}
                                  </span>
                                ) : (
                                  <span className="unassigned-badge">Unassigned</span>
                                )}
                              </td>
                              <td>
                                <time dateTime={report.created_at} style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                  {createdDate}
                                </time>
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
