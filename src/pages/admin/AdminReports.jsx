import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
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

const STATUS_OPTIONS = [
  'all',
  'Reported',
  'Assigned',
  'Accepted',
  'In Progress',
  'Resolved',
  'Cancelled',
];

export default function AdminReports() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Search & filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [garbageTypeFilter, setGarbageTypeFilter] = useState('all');
  const [assignmentFilter, setAssignmentFilter] = useState('all');

  // Assignment modal state
  const [assigningReport, setAssigningReport] = useState(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const [isSubmittingAssignment, setIsSubmittingAssignment] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchReportsAndProfiles() {
      try {
        // 1. Fetch all reports accessible to admin
        const { data: reportsData, error: reportsErr } = await supabase
          .from('reports')
          .select('id, title, garbage_type, severity, status, address, assigned_worker_id, citizen_id, created_at, updated_at')
          .order('created_at', { ascending: false });

        if (reportsErr) {
          console.error('Admin reports fetch error:', reportsErr);
          if (isMounted) setError('Unable to load reports. Please verify database connection and permissions.');
          return;
        }

        const rawReports = reportsData || [];

        // 2. Fetch all profiles for worker & citizen lookups
        const profileIds = [
          ...new Set([
            ...rawReports.map((r) => r.citizen_id).filter(Boolean),
            ...rawReports.map((r) => r.assigned_worker_id).filter(Boolean),
          ]),
        ];

        let profileMap = {};
        if (profileIds.length > 0) {
          try {
            const { data: profileRows } = await supabase
              .from('public_profiles')
              .select('id, full_name, role, is_active')
              .in('id', profileIds);

            if (profileRows) {
              profileMap = profileRows.reduce((acc, p) => {
                acc[p.id] = p;
                return acc;
              }, {});
            }
          } catch (pErr) {
            console.warn('Profiles lookup error:', pErr);
          }
        }

        // 3. Fetch active workers list for assignment
        let workerList = [];
        try {
          const { data: activeWorkers } = await supabase
            .from('profiles')
            .select('id, full_name, role, is_active')
            .eq('role', 'worker')
            .order('full_name', { ascending: true });

          workerList = activeWorkers || [];
        } catch (wErr) {
          console.warn('Worker list fetch error:', wErr);
        }

        if (isMounted) {
          const enriched = rawReports.map((r) => ({
            ...r,
            citizen: profileMap[r.citizen_id] || null,
            assignedWorker: profileMap[r.assigned_worker_id] || null,
          }));

          setReports(enriched);
          setWorkers(workerList);
          setError(null);
        }
      } catch (err) {
        console.error('Exception in AdminReports:', err);
        if (isMounted) setError('Network error while retrieving reports.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchReportsAndProfiles();

    // Supabase Realtime channel for reports
    const channel = supabase
      .channel('admin-reports-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
        },
        () => {
          fetchReportsAndProfiles();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [refreshKey]);

  // Open worker assignment modal
  const openAssignModal = (e, report) => {
    e.stopPropagation();
    setAssigningReport(report);
    setSelectedWorkerId(report.assigned_worker_id || '');
    setAssignmentNotes('');
    setAssignmentFeedback(null);
  };

  // Close worker assignment modal
  const closeAssignModal = () => {
    if (isSubmittingAssignment) return;
    setAssigningReport(null);
    setSelectedWorkerId('');
    setAssignmentNotes('');
    setAssignmentFeedback(null);
  };

  // Execute worker assignment via existing RPC
  const handleExecuteAssignment = async (e) => {
    e.preventDefault();
    if (!assigningReport || !selectedWorkerId || isSubmittingAssignment) return;

    setIsSubmittingAssignment(true);
    setAssignmentFeedback(null);

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('assign_report_to_worker', {
        p_report_id: assigningReport.id,
        p_worker_id: selectedWorkerId,
        p_notes: assignmentNotes.trim() || null,
      });

      if (rpcErr) {
        console.error('assign_report_to_worker error:', rpcErr);
        setAssignmentFeedback({
          type: 'error',
          message: rpcErr.message || 'Worker assignment failed.',
        });
      } else if (rpcRes?.success === false) {
        setAssignmentFeedback({
          type: 'error',
          message: rpcRes.message || 'Assignment failed. Check worker status or report lifecycle.',
        });
      } else {
        // Success
        setAssignmentFeedback({
          type: 'success',
          message: 'Worker assigned successfully! Incident status updated to Assigned.',
        });

        // Refresh reports list
        setTimeout(() => {
          closeAssignModal();
          setRefreshKey((k) => k + 1);
        }, 1200);
      }
    } catch (err) {
      console.error('Assignment exception:', err);
      setAssignmentFeedback({
        type: 'error',
        message: 'Network error occurred during assignment.',
      });
    } finally {
      setIsSubmittingAssignment(false);
    }
  };

  // Filtered reports computation
  const filteredReports = reports.filter((r) => {
    // 1. Search term filter (title, ID, address)
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchTitle = (r.title || '').toLowerCase().includes(query);
      const matchId = (r.id || '').toLowerCase().includes(query);
      const matchAddress = (r.address || '').toLowerCase().includes(query);
      if (!matchTitle && !matchId && !matchAddress) return false;
    }

    // 2. Status filter
    if (statusFilter !== 'all' && r.status !== statusFilter) {
      return false;
    }

    // 3. Severity filter
    if (severityFilter !== 'all' && r.severity !== severityFilter) {
      return false;
    }

    // 4. Garbage type filter
    if (garbageTypeFilter !== 'all' && r.garbage_type !== garbageTypeFilter) {
      return false;
    }

    // 5. Assignment filter
    if (assignmentFilter === 'assigned' && !r.assigned_worker_id) {
      return false;
    }
    if (assignmentFilter === 'unassigned' && r.assigned_worker_id) {
      return false;
    }

    return true;
  });

  // Calculate status counts
  const statusCounts = STATUS_OPTIONS.reduce((acc, st) => {
    if (st === 'all') {
      acc[st] = reports.length;
    } else {
      acc[st] = reports.filter((r) => r.status === st).length;
    }
    return acc;
  }, {});

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <nav className="details-breadcrumb-nav" aria-label="Breadcrumb" style={{ marginBottom: '0.5rem' }}>
              <Link to="/admin" className="btn-back-crumb">
                &larr; Admin Console
              </Link>
            </nav>
            <h1>Municipal Incident Management</h1>
            <p>Inspect city-wide waste submissions, filter by dispatch status, and assign field staff.</p>
          </div>

          <div className="tracking-actions-bar">
            <Link
              to="/admin"
              className="btn-form-cancel"
              style={{ padding: '0.6rem 1.1rem', fontSize: '0.875rem', textDecoration: 'none' }}
            >
              Console Dashboard
            </Link>
          </div>
        </header>

        {/* Toolbar: Search & Multi-Filter Card */}
        <section className="admin-toolbar-card" aria-label="Incident filters">
          {/* Search Row */}
          <div className="admin-search-row">
            <div className="admin-search-input-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search by report title, address, or reference ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search reports"
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

          {/* Status Pills */}
          <div className="tracking-filter-bar" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
            <div className="filter-pills" role="tablist" aria-label="Filter by lifecycle status">
              {STATUS_OPTIONS.map((st) => (
                <button
                  key={st}
                  type="button"
                  role="tab"
                  className={`filter-pill-btn ${statusFilter === st ? 'active' : ''}`}
                  onClick={() => setStatusFilter(st)}
                  aria-selected={statusFilter === st}
                >
                  {st === 'all' ? 'All Incidents' : st}
                  <span className="filter-pill-count">{statusCounts[st] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Secondary Dropdown Filters */}
          <div className="admin-filters-grid">
            {/* Severity Filter */}
            <div className="filter-group">
              <label htmlFor="filter-severity" className="filter-label">Severity</label>
              <select
                id="filter-severity"
                className="filter-select"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="all">All Severities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Garbage Type Filter */}
            <div className="filter-group">
              <label htmlFor="filter-garbage" className="filter-label">Waste Type</label>
              <select
                id="filter-garbage"
                className="filter-select"
                value={garbageTypeFilter}
                onChange={(e) => setGarbageTypeFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                {Object.entries(GARBAGE_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Dispatch Assignment Filter */}
            <div className="filter-group">
              <label htmlFor="filter-assignment" className="filter-label">Dispatch Status</label>
              <select
                id="filter-assignment"
                className="filter-select"
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
              >
                <option value="all">All Assignments</option>
                <option value="unassigned">Unassigned Only</option>
                <option value="assigned">Assigned to Worker</option>
              </select>
            </div>

            {/* Clear Filters Reset */}
            <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setSeverityFilter('all');
                  setGarbageTypeFilter('all');
                  setAssignmentFilter('all');
                }}
                style={{ padding: '0.55rem', fontSize: '0.825rem' }}
              >
                Reset All Filters
              </button>
            </div>
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading municipal reports...</p>
            <p className="state-desc">Fetching incident data and worker rosters.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Reports</p>
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

        {/* Empty State: No reports at all */}
        {!loading && !error && reports.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">📋</span>
            <h2 className="state-title">No Incident Reports in Database</h2>
            <p className="state-desc">Reports filed by citizens will appear here for administrative dispatch.</p>
          </div>
        )}

        {/* Filtered Empty State */}
        {!loading && !error && reports.length > 0 && filteredReports.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔍</span>
            <p className="state-title">No matching reports found</p>
            <p className="state-desc">Try clearing your search query or selecting a different status filter.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setSeverityFilter('all');
                setGarbageTypeFilter('all');
                setAssignmentFilter('all');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Reports Table */}
        {!loading && !error && filteredReports.length > 0 && (
          <div className="admin-table-card">
            <div className="admin-table-wrapper">
              <table className="admin-table" aria-label="Municipal Incident Management Table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Title & Location</th>
                    <th scope="col">Citizen</th>
                    <th scope="col">Garbage Type</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assigned Worker</th>
                    <th scope="col">Date Filed</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((report) => {
                    const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    });

                    const canAssign = report.status === 'Reported';

                    return (
                      <tr
                        key={report.id}
                        onClick={() => navigate(`/admin/reports/${report.id}`)}
                        title={`Click to inspect details for ${report.title}`}
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
                          {report.citizen ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-h)', fontWeight: 500 }}>
                              {report.citizen.full_name}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text)', opacity: 0.7 }}>
                              Citizen User
                            </span>
                          )}
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
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                            {canAssign && (
                              <button
                                type="button"
                                className="btn-assign-row"
                                onClick={(e) => openAssignModal(e, report)}
                                title="Assign to a field worker"
                              >
                                Assign
                              </button>
                            )}

                            <span className="report-card-link-text" style={{ fontSize: '0.8rem', marginLeft: '0.3rem' }}>
                              Details &rarr;
                            </span>
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

        {/* Worker Assignment Modal */}
        {assigningReport && (
          <div className="assign-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="assign-modal-title">
            <div className="assign-modal-box">
              <div className="assign-modal-header">
                <h3 id="assign-modal-title">Assign Incident to Worker</h3>
                <button
                  type="button"
                  className="btn-close-modal"
                  onClick={closeAssignModal}
                  disabled={isSubmittingAssignment}
                  aria-label="Close modal"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleExecuteAssignment}>
                <div className="assign-modal-body">
                  <div>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--text-h)' }}>
                      {assigningReport.title}
                    </strong>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text)' }}>
                      📍 {assigningReport.address} &bull; Ref: <code>#{assigningReport.id.slice(0, 8)}</code>
                    </p>
                  </div>

                  {/* Worker Selection List */}
                  <div className="filter-group">
                    <label className="filter-label">Select Active Field Worker</label>
                    {workers.length === 0 ? (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                        No worker accounts found in the system.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                        {workers.map((w) => {
                          const isSelected = selectedWorkerId === w.id;
                          return (
                            <div
                              key={w.id}
                              className={`worker-select-item ${isSelected ? 'selected' : ''}`}
                              onClick={() => setSelectedWorkerId(w.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  setSelectedWorkerId(w.id);
                                }
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-h)' }}>
                                  {w.full_name}
                                </span>
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text)' }}>
                                  ({w.role})
                                </span>
                              </div>
                              <span
                                className="worker-badge-pill"
                                style={{
                                  fontSize: '0.7rem',
                                  background: w.is_active !== false ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                                  color: w.is_active !== false ? '#059669' : '#6b7280',
                                  borderColor: w.is_active !== false ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)',
                                }}
                              >
                                {w.is_active !== false ? 'Available' : 'Inactive'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Optional Dispatch Notes */}
                  <div className="filter-group">
                    <label htmlFor="assignment-notes" className="filter-label">Dispatch Notes (Optional)</label>
                    <textarea
                      id="assignment-notes"
                      className="filter-select"
                      rows={3}
                      placeholder="Add specific collection instructions for the worker..."
                      value={assignmentNotes}
                      onChange={(e) => setAssignmentNotes(e.target.value)}
                      disabled={isSubmittingAssignment}
                    />
                  </div>

                  {/* Feedback Message */}
                  {assignmentFeedback && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        background: assignmentFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: assignmentFeedback.type === 'success' ? '#047857' : '#dc2626',
                        border: `1px solid ${assignmentFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      }}
                      role="alert"
                    >
                      {assignmentFeedback.message}
                    </div>
                  )}
                </div>

                <div className="assign-modal-footer">
                  <button
                    type="button"
                    className="btn-form-cancel"
                    onClick={closeAssignModal}
                    disabled={isSubmittingAssignment}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-form-submit"
                    disabled={!selectedWorkerId || isSubmittingAssignment}
                    style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem' }}
                  >
                    {isSubmittingAssignment ? 'Assigning...' : 'Confirm Assignment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
