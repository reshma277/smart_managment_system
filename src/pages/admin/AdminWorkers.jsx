import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';
import '../../styles/citizen-tracking.css';

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
        // 1. Fetch all workers from profiles
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

        // 2. Fetch all reports to aggregate workloads
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

    // Supabase Realtime subscription for workers and reports
    const profilesChannel = supabase
      .channel('admin-workers-profiles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          fetchWorkersAndWorkloads();
        }
      )
      .subscribe();

    const reportsChannel = supabase
      .channel('admin-workers-reports')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
        },
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
      // Safely update ONLY is_active, preserving the role intact per security guidelines
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
    // Search term filter
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchName = (w.full_name || '').toLowerCase().includes(query);
      const matchEmail = (w.email || '').toLowerCase().includes(query);
      const matchId = (w.id || '').toLowerCase().includes(query);
      const matchPhone = (w.phone_number || '').toLowerCase().includes(query);
      if (!matchName && !matchEmail && !matchId && !matchPhone) return false;
    }

    // Status filter
    if (statusFilter === 'active' && w.is_active === false) return false;
    if (statusFilter === 'inactive' && w.is_active !== false) return false;

    // Workload filter
    if (workloadFilter === 'busy' && w.activeWorkload === 0) return false;
    if (workloadFilter === 'available' && w.activeWorkload > 0) return false;

    return true;
  });

  // Compute summary stats
  const totalWorkersCount = workers.length;
  const activeWorkersCount = workers.filter((w) => w.is_active !== false).length;
  const inactiveWorkersCount = workers.filter((w) => w.is_active === false).length;
  const totalActiveTasksAcrossWorkers = enrichedWorkers.reduce((acc, w) => acc + w.activeWorkload, 0);

  const selectedWorker = selectedWorkerId
    ? enrichedWorkers.find((w) => w.id === selectedWorkerId)
    : null;

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* Header Breadcrumb & Title */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <nav className="details-breadcrumb-nav" aria-label="Breadcrumb" style={{ marginBottom: '0.5rem' }}>
              <Link to="/admin" className="btn-back-crumb">
                &larr; Admin Console
              </Link>
            </nav>
            <h1>Municipal Field Staff Management</h1>
            <p>Monitor field worker roster, duty availability, assigned workloads, and active dispatches.</p>
          </div>

          <div className="tracking-actions-bar">
            <Link
              to="/admin/reports"
              className="btn-form-cancel"
              style={{ padding: '0.6rem 1.1rem', fontSize: '0.875rem', textDecoration: 'none' }}
            >
              Manage Incidents &rarr;
            </Link>
            <button
              type="button"
              className="btn-form-cancel"
              onClick={handleRetry}
              disabled={loading}
              style={{ padding: '0.6rem 1rem', fontSize: '0.875rem' }}
              title="Refresh staff data"
            >
              <span>🔄</span> Refresh
            </button>
          </div>
        </header>

        {/* Global Feedback Banner */}
        {actionFeedback && (
          <div
            style={{
              padding: '0.85rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              background: actionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: actionFeedback.type === 'success' ? '#047857' : '#dc2626',
              border: `1px solid ${actionFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
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

        {/* 1. Worker Operations Overview Cards */}
        <section aria-labelledby="staff-metrics-heading">
          <h2 id="staff-metrics-heading" className="sr-only">Staff Statistics</h2>
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-title">Total Staff Roster</span>
                <span className="admin-stat-card-icon" aria-hidden="true">👷</span>
              </div>
              <p className="admin-stat-card-value">{totalWorkersCount}</p>
              <p className="admin-stat-card-desc">Registered municipal field personnel</p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-title">Active / On-Duty</span>
                <span className="admin-stat-card-icon" aria-hidden="true">🟢</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#059669' }}>
                {activeWorkersCount}
              </p>
              <p className="admin-stat-card-desc">Available for incident dispatch</p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-title">Inactive / Off-Duty</span>
                <span className="admin-stat-card-icon" aria-hidden="true">⚪</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#6b7280' }}>
                {inactiveWorkersCount}
              </p>
              <p className="admin-stat-card-desc">Paused or off-shift workers</p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-title">Active Operations</span>
                <span className="admin-stat-card-icon" aria-hidden="true">⚡</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#d97706' }}>
                {totalActiveTasksAcrossWorkers}
              </p>
              <p className="admin-stat-card-desc">Assigned, accepted & in-progress</p>
            </div>
          </div>
        </section>

        {/* 2. Toolbar: Search & Filters */}
        <section className="admin-toolbar-card" aria-label="Staff filters">
          <div className="admin-search-row">
            <div className="admin-search-input-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search staff by name, email, phone, or staff ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search field staff"
              />
            </div>

            {searchTerm && (
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => setSearchTerm('')}
                style={{ padding: '0.6rem 0.9rem', fontSize: '0.85rem' }}
              >
                Clear Search
              </button>
            )}
          </div>

          <div className="admin-filters-grid">
            <div className="filter-group">
              <label htmlFor="filter-worker-status" className="filter-label">Availability Status</label>
              <select
                id="filter-worker-status"
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Staff</option>
                <option value="active">Active (On-Duty)</option>
                <option value="inactive">Inactive (Off-Duty)</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-worker-workload" className="filter-label">Workload Filter</label>
              <select
                id="filter-worker-workload"
                className="filter-select"
                value={workloadFilter}
                onChange={(e) => setWorkloadFilter(e.target.value)}
              >
                <option value="all">All Workloads</option>
                <option value="busy">Active Dispatches (&gt;0 tasks)</option>
                <option value="available">Idle / Free (0 tasks)</option>
              </select>
            </div>

            <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setWorkloadFilter('all');
                }}
                style={{ padding: '0.55rem', fontSize: '0.825rem' }}
              >
                Reset Filters
              </button>
            </div>
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading field worker roster...</p>
            <p className="state-desc">Synchronizing profiles and active incident dispatches.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Staff Roster</p>
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

        {/* Empty State: No workers at all */}
        {!loading && !error && workers.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">👷</span>
            <h2 className="state-title">No Field Workers Registered</h2>
            <p className="state-desc">When users register or are designated with the worker role, they will appear here.</p>
          </div>
        )}

        {/* Filtered Empty State */}
        {!loading && !error && workers.length > 0 && filteredWorkers.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔍</span>
            <p className="state-title">No staff members match your criteria</p>
            <p className="state-desc">Try clearing your search query or adjusting status/workload filters.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setWorkloadFilter('all');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Workers Table */}
        {!loading && !error && filteredWorkers.length > 0 && (
          <div className="admin-table-card">
            <div className="admin-table-wrapper">
              <table className="admin-table" aria-label="Field Staff Roster Table">
                <thead>
                  <tr>
                    <th scope="col">Staff Member</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Duty Status</th>
                    <th scope="col">Active Tasks</th>
                    <th scope="col">Lifecycle Breakdown</th>
                    <th scope="col">Resolved</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((worker) => {
                    const isSelected = selectedWorkerId === worker.id;
                    const isOnDuty = worker.is_active !== false;
                    const isToggling = togglingWorkerId === worker.id;

                    return (
                      <tr
                        key={worker.id}
                        style={{
                          background: isSelected ? 'rgba(170, 59, 255, 0.05)' : undefined,
                        }}
                      >
                        <td>
                          <div className="report-title-cell">
                            <span className="report-title-text" style={{ fontSize: '0.95rem' }}>
                              {worker.full_name}
                            </span>
                            <span className="report-address-sub" title={worker.id}>
                              ID: <code>#{worker.id.slice(0, 8)}</code>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <span style={{ color: 'var(--text-h)' }}>{worker.email}</span>
                            {worker.phone_number && (
                              <span style={{ color: 'var(--text)', opacity: 0.8 }}>
                                📞 {worker.phone_number}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className="worker-badge-pill"
                            style={{
                              fontSize: '0.75rem',
                              background: isOnDuty ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                              color: isOnDuty ? '#059669' : '#6b7280',
                              borderColor: isOnDuty ? 'rgba(16, 185, 129, 0.35)' : 'rgba(107, 114, 128, 0.35)',
                            }}
                          >
                            <span aria-hidden="true">{isOnDuty ? '🟢' : '⚪'}</span>
                            {isOnDuty ? 'Active (On-Duty)' : 'Inactive (Off-Duty)'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '0.95rem',
                              color: worker.activeWorkload > 0 ? '#d97706' : 'var(--text)',
                            }}
                          >
                            {worker.activeWorkload} {worker.activeWorkload === 1 ? 'task' : 'tasks'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span
                              style={{
                                fontSize: '0.725rem',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                background: 'rgba(59, 130, 246, 0.1)',
                                color: '#2563eb',
                                border: '1px solid rgba(59, 130, 246, 0.25)',
                              }}
                              title="Assigned (Awaiting Worker)"
                            >
                              Assigned: {worker.assignedCount}
                            </span>
                            <span
                              style={{
                                fontSize: '0.725rem',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                background: 'rgba(217, 119, 6, 0.1)',
                                color: '#b45309',
                                border: '1px solid rgba(217, 119, 6, 0.25)',
                              }}
                              title="Accepted (En Route)"
                            >
                              Accepted: {worker.acceptedCount}
                            </span>
                            <span
                              style={{
                                fontSize: '0.725rem',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                background: 'rgba(168, 85, 247, 0.1)',
                                color: '#7e22ce',
                                border: '1px solid rgba(168, 85, 247, 0.25)',
                              }}
                              title="In Progress (Active Cleanup)"
                            >
                              In Progress: {worker.inProgressCount}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#059669' }}>
                            {worker.resolvedCount}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn-assign-row"
                              onClick={() => setSelectedWorkerId(isSelected ? null : worker.id)}
                              style={{
                                background: isSelected ? '#aa3bff' : undefined,
                                color: isSelected ? '#ffffff' : undefined,
                              }}
                              title="View assigned incident dispatches"
                            >
                              {isSelected ? 'Hide Tasks' : `Tasks (${worker.totalCount})`}
                            </button>

                            <button
                              type="button"
                              className="btn-form-cancel"
                              onClick={() => handleToggleWorkerStatus(worker)}
                              disabled={isToggling}
                              style={{
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.775rem',
                                color: isOnDuty ? '#dc2626' : '#059669',
                                borderColor: isOnDuty ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)',
                              }}
                              title={isOnDuty ? 'Set worker as off-duty' : 'Set worker as on-duty'}
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
          </div>
        )}

        {/* 3. Expandable / Detailed Worker Task Drawer */}
        {selectedWorker && (
          <section
            className="details-section-card"
            style={{ marginTop: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}
            aria-labelledby="worker-detail-heading"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h2 id="worker-detail-heading" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-h)' }}>
                  <span aria-hidden="true">📋</span> Assigned Tasks: {selectedWorker.full_name}
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.825rem', color: 'var(--text)' }}>
                  Total historical and active reports assigned: <strong>{selectedWorker.totalCount}</strong> ({selectedWorker.activeWorkload} active)
                </p>
              </div>

              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => setSelectedWorkerId(null)}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                Close Task View &times;
              </button>
            </div>

            {selectedWorker.assignedReports.length === 0 ? (
              <div className="state-box" style={{ padding: '2rem 1rem' }}>
                <span className="state-icon" aria-hidden="true">🎉</span>
                <p className="state-title">No Incident Reports Currently Assigned</p>
                <p className="state-desc">This worker has zero dispatches on their schedule.</p>
                <Link
                  to="/admin/reports"
                  className="btn-form-submit state-action-btn"
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Assign Incidents in Reports Console
                </Link>
              </div>
            ) : (
              <div className="admin-table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <table className="admin-table" aria-label="Worker Assigned Reports">
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Title & Location</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last Updated</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWorker.assignedReports.map((r) => {
                      const updatedDate = new Date(r.updated_at || r.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      });

                      return (
                        <tr
                          key={r.id}
                          onClick={() => navigate(`/admin/reports/${r.id}`)}
                          title={`View incident ${r.id}`}
                        >
                          <td>
                            <span className="report-card-ref-badge" title={r.id}>
                              #{r.id.slice(0, 8)}
                            </span>
                          </td>
                          <td>
                            <div className="report-title-cell">
                              <span className="report-title-text">{r.title}</span>
                              <span className="report-address-sub" title={r.address}>
                                📍 {r.address || 'GPS Coordinates Recorded'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`severity-badge severity-${r.severity}`}>
                              {r.severity}
                            </span>
                          </td>
                          <td>
                            <ReportStatusBadge status={r.status} size="small" />
                          </td>
                          <td>
                            <time dateTime={r.updated_at || r.created_at} style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                              {updatedDate}
                            </time>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="report-card-link-text" style={{ fontSize: '0.8rem' }}>
                              Inspect &rarr;
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
