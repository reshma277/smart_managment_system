import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';

export default function AdminWorkers() {
  const navigate = useNavigate();

  const [workers, setWorkers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | inactive
  const [workloadFilter, setWorkloadFilter] = useState('all'); // all | busy | available

  // Selected worker for detailed workload inspection
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);

  // Worker status toggle state
  const [togglingWorkerId, setTogglingWorkerId] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchWorkersAndWorkloads() {
      try {
        const { data: workerData, error: workerErr } = await supabase
          .from('profiles')
          .select('id, email, full_name, phone_number, role, avatar_url, is_active, last_location_updated_at, created_at')
          .eq('role', 'worker')
          .order('full_name', { ascending: true });

        if (workerErr) {
          console.error('Error fetching workers:', workerErr);
          if (isMounted) setError('Unable to load worker roster. Please verify database permissions.');
          return;
        }

        const { data: reportData, error: reportErr } = await supabase
          .from('reports')
          .select('id, title, status, severity, garbage_type, address, assigned_worker_id, created_at, updated_at')
          .not('assigned_worker_id', 'is', null)
          .order('updated_at', { ascending: false });

        if (reportErr) {
          console.warn('Error fetching reports for workload mapping:', reportErr);
        }

        if (isMounted) {
          setWorkers(workerData || []);
          setReports(reportData || []);
          setError(null);
        }
      } catch (err) {
        console.error('Exception in AdminWorkers:', err);
        if (isMounted) setError('Network error while retrieving worker roster.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchWorkersAndWorkloads();

    const profilesChannel = supabase
      .channel('admin-workers-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          fetchWorkersAndWorkloads();
        }
      )
      .subscribe();

    const reportsChannel = supabase
      .channel('admin-workers-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        () => {
          fetchWorkersAndWorkloads();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(reportsChannel);
    };
  }, [refreshKey]);

  // Handle worker active/inactive status toggle
  const handleToggleWorkerStatus = async (worker) => {
    if (togglingWorkerId) return;

    const newStatus = worker.is_active === false ? true : false;
    const actionName = newStatus ? 'activate' : 'deactivate';

    if (!window.confirm(`Are you sure you want to ${actionName} worker "${worker.full_name}"?`)) {
      return;
    }

    setTogglingWorkerId(worker.id);
    setActionFeedback(null);

    try {
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ is_active: newStatus })
        .eq('id', worker.id);

      if (updateErr) {
        console.error('Error toggling worker status:', updateErr);
        setActionFeedback({
          type: 'error',
          message: updateErr.message || `Failed to ${actionName} worker.`,
        });
      } else {
        setActionFeedback({
          type: 'success',
          message: `Worker "${worker.full_name}" is now ${newStatus ? 'Active (On-Duty)' : 'Inactive (Off-Duty)'}.`,
        });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Toggle status exception:', err);
      setActionFeedback({
        type: 'error',
        message: 'Network error occurred while updating worker status.',
      });
    } finally {
      setTogglingWorkerId(null);
    }
  };

  // Map reports by worker ID
  const reportsByWorker = reports.reduce((acc, r) => {
    if (r.assigned_worker_id) {
      if (!acc[r.assigned_worker_id]) {
        acc[r.assigned_worker_id] = [];
      }
      acc[r.assigned_worker_id].push(r);
    }
    return acc;
  }, {});

  // Compute enriched worker list with workload counts
  const enrichedWorkers = workers.map((w) => {
    const workerReports = reportsByWorker[w.id] || [];
    const assignedCount = workerReports.filter((r) => r.status === 'Assigned').length;
    const acceptedCount = workerReports.filter((r) => r.status === 'Accepted').length;
    const inProgressCount = workerReports.filter((r) => r.status === 'In Progress').length;
    const resolvedCount = workerReports.filter((r) => r.status === 'Resolved').length;
    const activeWorkload = assignedCount + acceptedCount + inProgressCount;

    return {
      ...w,
      assignedReports: workerReports,
      totalCount: workerReports.length,
      assignedCount,
      acceptedCount,
      inProgressCount,
      resolvedCount,
      activeWorkload,
    };
  });

  // Filtered workers list
  const filteredWorkers = enrichedWorkers.filter((w) => {
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchName = (w.full_name || '').toLowerCase().includes(query);
      const matchEmail = (w.email || '').toLowerCase().includes(query);
      const matchId = (w.id || '').toLowerCase().includes(query);
      const matchPhone = (w.phone_number || '').toLowerCase().includes(query);
      if (!matchName && !matchEmail && !matchId && !matchPhone) return false;
    }

    if (statusFilter === 'active' && w.is_active === false) return false;
    if (statusFilter === 'inactive' && w.is_active !== false) return false;

    if (workloadFilter === 'busy' && w.activeWorkload === 0) return false;
    if (workloadFilter === 'available' && w.activeWorkload > 0) return false;

    return true;
  });

  // Summary stats
  const totalWorkersCount = workers.length;
  const activeWorkersCount = workers.filter((w) => w.is_active !== false).length;
  const totalAssignedTasks = enrichedWorkers.reduce((acc, w) => acc + w.assignedCount + w.acceptedCount, 0);
  const totalInProgressTasks = enrichedWorkers.reduce((acc, w) => acc + w.inProgressCount, 0);

  const selectedWorker = selectedWorkerId
    ? enrichedWorkers.find((w) => w.id === selectedWorkerId)
    : null;

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* HEADER */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">FIELD WORKERS</span>
              <span className="admin-role-badge">
                <span>{totalWorkersCount} Registered Personnel</span>
              </span>
            </div>
            <h1 className="admin-title">Worker Management</h1>
            <p className="admin-subtitle">
              Monitor workforce availability and current cleanup workload.
            </p>
          </div>

          <div className="admin-header-actions">
            <Link to="/admin/reports" className="btn-admin-secondary">
              &larr; Manage Reports
            </Link>
            <button
              type="button"
              className="btn-admin-secondary btn-admin-sm"
              onClick={handleRetry}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>
        </header>

        {/* FEEDBACK BANNER */}
        {actionFeedback && (
          <div
            style={{
              padding: '0.85rem 1.25rem',
              borderRadius: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: actionFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
              color: actionFeedback.type === 'success' ? '#16A34A' : '#DC2626',
              border: `1px solid ${actionFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            role="alert"
          >
            <span>{actionFeedback.message}</span>
            <button
              type="button"
              onClick={() => setActionFeedback(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold' }}
            >
              &times;
            </button>
          </div>
        )}

        {/* 1. SUMMARY METRICS */}
        <section aria-label="Worker Fleet Metrics">
          <div className="admin-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <article className="admin-kpi-card">
              <div className="admin-kpi-header">
                <span className="admin-kpi-label">Total Workers</span>
                <span className="admin-kpi-indicator primary" aria-hidden="true" />
              </div>
              <p className="admin-kpi-val">{totalWorkersCount}</p>
              <p className="admin-kpi-sub">Registered field personnel</p>
            </article>

            <article className="admin-kpi-card">
              <div className="admin-kpi-header">
                <span className="admin-kpi-label">Active / On Duty</span>
                <span className="admin-kpi-indicator success" aria-hidden="true" />
              </div>
              <p className="admin-kpi-val">{activeWorkersCount}</p>
              <p className="admin-kpi-sub">Available for field dispatch</p>
            </article>

            <article className="admin-kpi-card">
              <div className="admin-kpi-header">
                <span className="admin-kpi-label">Assigned Tasks</span>
                <span className="admin-kpi-indicator warning" aria-hidden="true" />
              </div>
              <p className="admin-kpi-val">{totalAssignedTasks}</p>
              <p className="admin-kpi-sub">Pending start or en-route</p>
            </article>

            <article className="admin-kpi-card">
              <div className="admin-kpi-header">
                <span className="admin-kpi-label">In Progress</span>
                <span className="admin-kpi-indicator info" aria-hidden="true" />
              </div>
              <p className="admin-kpi-val">{totalInProgressTasks}</p>
              <p className="admin-kpi-sub">Active remediation on site</p>
            </article>
          </div>
        </section>

        {/* 2. TOOLBAR: SEARCH & FILTERS */}
        <section className="admin-toolbar-card" aria-label="Worker filter controls">
          <div className="admin-search-row">
            <div className="admin-search-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search staff by name, email, phone, or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search worker roster"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="admin-filter-field" style={{ minWidth: '150px' }}>
                <select
                  className="admin-filter-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by duty status"
                >
                  <option value="all">All Duty Statuses</option>
                  <option value="active">Active (On-Duty)</option>
                  <option value="inactive">Inactive (Off-Duty)</option>
                </select>
              </div>

              <div className="admin-filter-field" style={{ minWidth: '150px' }}>
                <select
                  className="admin-filter-select"
                  value={workloadFilter}
                  onChange={(e) => setWorkloadFilter(e.target.value)}
                  aria-label="Filter by workload"
                >
                  <option value="all">All Workloads</option>
                  <option value="busy">Busy (Active Tasks &gt; 0)</option>
                  <option value="available">Available (0 Tasks)</option>
                </select>
              </div>

              {(searchTerm || statusFilter !== 'all' || workloadFilter !== 'all') && (
                <button
                  type="button"
                  className="btn-admin-secondary btn-admin-sm"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setWorkloadFilter('all');
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </section>

        {/* LOADING & ERROR */}
        {loading && (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="admin-state-title">Loading Field Roster...</p>
            <p className="admin-state-desc">Aggregating field staff accounts and active dispatch schedules.</p>
          </div>
        )}

        {!loading && error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Unable to Load Worker Roster</p>
            <p className="admin-state-desc">{error}</p>
            <button type="button" className="btn-admin-primary" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        )}

        {/* WORKER ROSTER TABLE */}
        {!loading && !error && filteredWorkers.length === 0 && (
          <div className="admin-state-box">
            <span className="admin-state-icon" aria-hidden="true">👷</span>
            <h2 className="admin-state-title">No Workers Found</h2>
            <p className="admin-state-desc">
              {workers.length === 0
                ? 'No workers are currently registered in the municipal database.'
                : 'No staff match the current search or workload filters.'}
            </p>
          </div>
        )}

        {!loading && !error && filteredWorkers.length > 0 && (
          <section className="admin-table-card" aria-label="Worker Roster Table">
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Worker Name</th>
                    <th scope="col">Duty Status</th>
                    <th scope="col">Current Workload</th>
                    <th scope="col">Assigned Tasks</th>
                    <th scope="col">In-Progress Tasks</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((worker) => {
                    const isOnDuty = worker.is_active !== false;
                    const isSelected = selectedWorkerId === worker.id;
                    const isToggling = togglingWorkerId === worker.id;

                    return (
                      <tr key={worker.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                            <span style={{ fontWeight: 800, color: 'var(--admin-text-h)' }}>{worker.full_name}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>{worker.email}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`duty-pill ${isOnDuty ? 'on-duty' : 'off-duty'}`}>
                            {isOnDuty ? '🟢 Active (On-Duty)' : '⚪ Inactive (Off-Duty)'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: worker.activeWorkload > 0 ? 'var(--admin-text-h)' : 'var(--admin-text-body)' }}>
                            {worker.activeWorkload} active
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.85rem' }}>{worker.assignedCount + worker.acceptedCount}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.85rem', fontWeight: worker.inProgressCount > 0 ? 700 : 400, color: worker.inProgressCount > 0 ? 'var(--admin-warning)' : 'inherit' }}>
                            {worker.inProgressCount}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => setSelectedWorkerId(isSelected ? null : worker.id)}
                            >
                              {isSelected ? 'Close Tasks' : `Tasks (${worker.totalCount})`}
                            </button>

                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => handleToggleWorkerStatus(worker)}
                              disabled={isToggling}
                              style={{
                                color: isOnDuty ? '#DC2626' : '#16A34A',
                                borderColor: isOnDuty ? 'rgba(220, 38, 38, 0.3)' : 'rgba(22, 163, 74, 0.3)',
                              }}
                            >
                              {isToggling ? 'Updating...' : isOnDuty ? 'Set Off-Duty' : 'Set On-Duty'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 3. STREAMLINED WORKER TASK DRAWER */}
        {selectedWorker && (
          <section className="admin-card" aria-labelledby="worker-task-drawer-heading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h2 id="worker-task-drawer-heading" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--admin-text-h)' }}>
                  Assigned Dispatches: {selectedWorker.full_name}
                </h2>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.825rem', color: 'var(--admin-text-body)' }}>
                  Showing {selectedWorker.assignedReports.length} total tasks ({selectedWorker.activeWorkload} active)
                </p>
              </div>

              <button
                type="button"
                className="btn-admin-secondary btn-admin-sm"
                onClick={() => setSelectedWorkerId(null)}
              >
                Close Tasks &times;
              </button>
            </div>

            {selectedWorker.assignedReports.length === 0 ? (
              <div className="admin-state-box" style={{ padding: '2rem 1rem' }}>
                <span className="admin-state-icon" aria-hidden="true">✓</span>
                <p className="admin-state-title">No Incident Reports Assigned</p>
                <p className="admin-state-desc">This operator currently has zero assigned dispatches.</p>
              </div>
            ) : (
              <div className="admin-table-wrapper" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">ID</th>
                      <th scope="col">Title &amp; Address</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last Updated</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWorker.assignedReports.map((r) => {
                      const updatedDate = new Date(r.updated_at || r.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      });

                      return (
                        <tr
                          key={r.id}
                          onClick={() => navigate(`/admin/reports/${r.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <span className="ref-id-badge">#{r.id.slice(0, 8)}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                              <span style={{ fontWeight: 700, color: 'var(--admin-text-h)' }}>{r.title}</span>
                              <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                                📍 {r.address || 'Coordinates Recorded'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`admin-severity-badge severity-${(r.severity || 'medium').toLowerCase()}`}>
                              {r.severity?.toUpperCase() || 'MEDIUM'}
                            </span>
                          </td>
                          <td>
                            <ReportStatusBadge status={r.status} size="small" />
                          </td>
                          <td>
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>{updatedDate}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-primary)' }}>
                              INSPECT &rarr;
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
