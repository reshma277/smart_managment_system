import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import ReportSlaBadge from '../../components/admin/ReportSlaBadge';
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

const STATUS_OPTIONS = [
  'all',
  'Reported',
  'Assigned',
  'Accepted',
  'In Progress',
  'Resolved',
  'Cancelled',
];

const SEVERITY_OPTIONS = ['all', 'critical', 'high', 'medium', 'low'];

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
  const [slaFilter, setSlaFilter] = useState('all');

  // Assignment modal state
  const [assigningReport, setAssigningReport] = useState(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const [isSubmittingAssignment, setIsSubmittingAssignment] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);

  // Auto-assignment state
  const [autoAssigningId, setAutoAssigningId] = useState(null);
  const [dispatchAlert, setDispatchAlert] = useState(null);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const handleAutoAssign = async (e, report) => {
    e.stopPropagation();
    if (autoAssigningId) return;

    setAutoAssigningId(report.id);
    setDispatchAlert(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('auto_assign_report', {
        p_report_id: report.id,
      });

      if (rpcErr) {
        console.error('auto_assign_report error:', rpcErr);
        setDispatchAlert({
          type: 'error',
          message: rpcErr.message || 'Auto-assignment failed.',
        });
      } else if (data?.success === false) {
        setDispatchAlert({
          type: 'error',
          message: data.code === 'NO_AVAILABLE_WORKER'
            ? 'No available on-duty worker found within operational range.'
            : (data.message || 'Auto-assignment rejected.'),
        });
      } else {
        setDispatchAlert({
          type: 'success',
          message: `Report #${report.id.slice(0, 8)} auto-assigned to ${data.worker_name || 'optimal field worker'}!`,
        });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Auto-assign exception:', err);
      setDispatchAlert({
        type: 'error',
        message: 'Network error occurred during auto-assignment.',
      });
    } finally {
      setAutoAssigningId(null);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchReportsAndProfiles() {
      try {
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

        let workerList = [];
        try {
          const { data: activeWorkers } = await supabase
            .from('profiles')
            .select('id, full_name, role, is_active')
            .eq('role', 'worker')
            .order('full_name', { ascending: true });

          const workerLoadMap = {};
          rawReports.forEach((r) => {
            if (r.assigned_worker_id && ['Assigned', 'Accepted', 'In Progress'].includes(r.status)) {
              workerLoadMap[r.assigned_worker_id] = (workerLoadMap[r.assigned_worker_id] || 0) + 1;
            }
          });

          workerList = (activeWorkers || []).map((w) => ({
            ...w,
            activeTasks: workerLoadMap[w.id] || 0,
          }));
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

    const channel = supabase
      .channel('admin-reports-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
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

  const openAssignModal = (e, report) => {
    e.stopPropagation();
    setAssigningReport(report);
    setSelectedWorkerId(report.assigned_worker_id || '');
    setAssignmentNotes('');
    setAssignmentFeedback(null);
  };

  const closeAssignModal = () => {
    if (isSubmittingAssignment) return;
    setAssigningReport(null);
    setSelectedWorkerId('');
    setAssignmentNotes('');
    setAssignmentFeedback(null);
  };

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
        setAssignmentFeedback({
          type: 'success',
          message: 'Worker assigned successfully! Incident status updated to Assigned.',
        });

        setTimeout(() => {
          closeAssignModal();
          setRefreshKey((k) => k + 1);
        }, 1100);
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
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchTitle = (r.title || '').toLowerCase().includes(query);
      const matchId = (r.id || '').toLowerCase().includes(query);
      const matchAddress = (r.address || '').toLowerCase().includes(query);
      const matchWorker = (r.assignedWorker?.full_name || '').toLowerCase().includes(query);
      if (!matchTitle && !matchId && !matchAddress && !matchWorker) return false;
    }

    if (statusFilter !== 'all' && r.status !== statusFilter) {
      return false;
    }

    if (severityFilter !== 'all' && (r.severity || 'medium').toLowerCase() !== severityFilter.toLowerCase()) {
      return false;
    }

    if (garbageTypeFilter !== 'all' && r.garbage_type !== garbageTypeFilter) {
      return false;
    }

    if (assignmentFilter === 'assigned' && !r.assigned_worker_id) {
      return false;
    }
    if (assignmentFilter === 'unassigned' && r.assigned_worker_id) {
      return false;
    }

    if (slaFilter !== 'all') {
      const overallSla = getReportOverallSla(r);
      if (overallSla.state !== slaFilter) {
        return false;
      }
    }

    return true;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setSeverityFilter('all');
    setGarbageTypeFilter('all');
    setAssignmentFilter('all');
    setSlaFilter('all');
  };

  const hasActiveFilters =
    searchTerm !== '' ||
    statusFilter !== 'all' ||
    severityFilter !== 'all' ||
    garbageTypeFilter !== 'all' ||
    assignmentFilter !== 'all' ||
    slaFilter !== 'all';

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* HEADER */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">MANAGE REPORTS</span>
              <span className="admin-role-badge">
                <span>{reports.length} Total Incidents</span>
              </span>
            </div>
            <h1 className="admin-title">Reports</h1>
            <p className="admin-subtitle">
              Review incidents, prioritize cleanup, and dispatch field workers.
            </p>
          </div>

          <div className="admin-header-actions">
            <Link to="/admin" className="btn-admin-secondary">
              &larr; Municipal Command
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

        {/* FILTER TOOLBAR */}
        <section className="admin-toolbar-card" aria-label="Report Filter Controls">
          <div className="admin-search-row">
            <div className="admin-search-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search by title, location, ID, or worker..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search incident reports"
              />
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-admin-secondary btn-admin-sm"
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="admin-filters-row">
            <div className="admin-filter-field">
              <label htmlFor="status-filter" className="admin-filter-label">Status</label>
              <select
                id="status-filter"
                className="admin-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'all' ? 'All Statuses' : opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-filter-field">
              <label htmlFor="severity-filter" className="admin-filter-label">Severity</label>
              <select
                id="severity-filter"
                className="admin-filter-select"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'all' ? 'All Severities' : opt.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-filter-field">
              <label htmlFor="type-filter" className="admin-filter-label">Garbage Type</label>
              <select
                id="type-filter"
                className="admin-filter-select"
                value={garbageTypeFilter}
                onChange={(e) => setGarbageTypeFilter(e.target.value)}
              >
                <option value="all">All Waste Types</option>
                {Object.entries(GARBAGE_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-filter-field">
              <label htmlFor="assignment-filter" className="admin-filter-label">Assignment</label>
              <select
                id="assignment-filter"
                className="admin-filter-select"
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
              >
                <option value="all">All Assignments</option>
                <option value="assigned">Assigned to Worker</option>
                <option value="unassigned">Unassigned (Action Needed)</option>
              </select>
            </div>

            <div className="admin-filter-field">
              <label htmlFor="sla-filter" className="admin-filter-label">SLA State</label>
              <select
                id="sla-filter"
                className="admin-filter-select"
                value={slaFilter}
                onChange={(e) => setSlaFilter(e.target.value)}
              >
                <option value="all">All SLA States</option>
                <option value="within">Within SLA</option>
                <option value="approaching">Approaching Breach</option>
                <option value="breached">SLA Breached</option>
              </select>
            </div>
          </div>
        </section>

        {/* LOADING STATE */}
        {loading && (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="admin-state-title">Loading Incident Reports...</p>
            <p className="admin-state-desc">Aggregating municipal incident data, worker dispatches, and citizen records.</p>
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Unable to Load Reports</p>
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

        {/* EMPTY & FILTERED EMPTY STATE */}
        {!loading && !error && filteredReports.length === 0 && (
          <div className="admin-state-box">
            <span className="admin-state-icon" aria-hidden="true">📋</span>
            <h2 className="admin-state-title">
              {reports.length === 0 ? 'No Reports Filed Yet' : 'No Reports Match Current Filters'}
            </h2>
            <p className="admin-state-desc">
              {reports.length === 0
                ? 'When citizens report uncollected waste, they will appear here in the dispatch queue.'
                : 'Try adjusting your search criteria, severity level, or status filters.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-admin-secondary btn-admin-sm"
                onClick={clearFilters}
              >
                Reset All Filters
              </button>
            )}
          </div>
        )}

        {/* DISPATCH FEEDBACK ALERT */}
        {dispatchAlert && (
          <div
            role="status"
            style={{
              padding: '0.75rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              background: dispatchAlert.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
              color: dispatchAlert.type === 'success' ? '#16A34A' : '#DC2626',
              border: `1px solid ${dispatchAlert.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
            }}
          >
            <span>{dispatchAlert.type === 'success' ? '⚡' : '⚠️'}</span>
            <span>{dispatchAlert.message}</span>
          </div>
        )}

        {/* REPORT LIST TABLE */}
        {!loading && !error && filteredReports.length > 0 && (
          <section className="admin-table-card" aria-label="Incident Reports Table">
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">ID</th>
                    <th scope="col">Title &amp; Location</th>
                    <th scope="col">Category</th>
                    <th scope="col">Status</th>
                    <th scope="col">SLA Status</th>
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
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <tr
                        key={report.id}
                        onClick={() => navigate(`/admin/reports/${report.id}`)}
                        title={`Inspect report ${report.id}`}
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
                          <span style={{ fontSize: '0.825rem', color: 'var(--admin-text-body)' }}>
                            {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                          </span>
                        </td>
                        <td>
                          <ReportStatusBadge status={report.status} size="small" />
                        </td>
                        <td>
                          <ReportSlaBadge report={report} size="small" />
                        </td>
                        <td>
                          {report.assignedWorker ? (
                            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--admin-text-h)' }}>
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
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                            {report.status === 'Reported' && (
                              <>
                                <button
                                  type="button"
                                  className="btn-admin-secondary btn-admin-sm"
                                  onClick={(e) => handleAutoAssign(e, report)}
                                  disabled={autoAssigningId === report.id}
                                  title="Automatically assign nearest available worker based on severity & load"
                                  style={{ borderColor: 'var(--admin-primary)', color: 'var(--admin-primary)', fontWeight: 700 }}
                                >
                                  {autoAssigningId === report.id ? '⚡ Assigning...' : '⚡ Auto-Assign'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-admin-primary btn-admin-sm"
                                  onClick={(e) => openAssignModal(e, report)}
                                  title="Dispatch field worker to this incident"
                                >
                                  Dispatch
                                </button>
                              </>
                            )}
                            <span style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--admin-primary)' }}>
                              VIEW &rarr;
                            </span>
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

        {/* WORKER ASSIGNMENT MODAL DIALOG */}
        {assigningReport && (
          <div
            className="admin-modal-overlay"
            onClick={closeAssignModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
          >
            <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h3 id="assign-modal-title">Dispatch Field Worker</h3>
                <button
                  type="button"
                  className="btn-admin-modal-close"
                  onClick={closeAssignModal}
                  aria-label="Close modal"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleExecuteAssignment}>
                <div className="admin-modal-body">
                  <div style={{ background: 'var(--admin-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-body)' }}>INCIDENT #{assigningReport.id.slice(0, 8)}</div>
                    <div style={{ fontWeight: 800, color: 'var(--admin-text-h)', marginTop: '0.2rem' }}>{assigningReport.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)', marginTop: '0.15rem' }}>📍 {assigningReport.address}</div>
                  </div>

                  <div className="admin-filter-field">
                    <label htmlFor="worker-select-input" className="admin-filter-label">
                      Select Available Field Operator *
                    </label>
                    <select
                      id="worker-select-input"
                      className="admin-filter-select"
                      value={selectedWorkerId}
                      onChange={(e) => setSelectedWorkerId(e.target.value)}
                      required
                      disabled={isSubmittingAssignment}
                    >
                      <option value="">Choose an active worker...</option>
                      {workers.map((w) => {
                        const dutyText = w.is_active === false ? 'Off-Duty' : 'On-Duty';
                        const taskCount = w.activeTasks ?? 0;
                        const taskText = `${taskCount} active ${taskCount === 1 ? 'task' : 'tasks'}`;
                        return (
                          <option key={w.id} value={w.id} disabled={w.is_active === false}>
                            {w.full_name} ({dutyText} · {taskText})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="admin-filter-field">
                    <label htmlFor="dispatch-notes-input" className="admin-filter-label">
                      Dispatch Instructions / Notes (Optional)
                    </label>
                    <textarea
                      id="dispatch-notes-input"
                      className="admin-search-input"
                      style={{ height: '70px', padding: '0.65rem 0.85rem' }}
                      placeholder="Special instructions or field access notes..."
                      value={assignmentNotes}
                      onChange={(e) => setAssignmentNotes(e.target.value)}
                      disabled={isSubmittingAssignment}
                    />
                  </div>

                  {assignmentFeedback && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.825rem',
                        fontWeight: 600,
                        background: assignmentFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                        color: assignmentFeedback.type === 'success' ? '#16A34A' : '#DC2626',
                        border: `1px solid ${assignmentFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
                      }}
                    >
                      {assignmentFeedback.message}
                    </div>
                  )}
                </div>

                <div className="admin-modal-footer">
                  <button
                    type="button"
                    className="btn-admin-secondary btn-admin-sm"
                    onClick={closeAssignModal}
                    disabled={isSubmittingAssignment}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-admin-primary btn-admin-sm"
                    disabled={!selectedWorkerId || isSubmittingAssignment}
                  >
                    {isSubmittingAssignment ? 'Dispatching...' : 'Confirm Assignment'}
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
