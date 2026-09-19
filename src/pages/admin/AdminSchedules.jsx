import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';
import '../../styles/citizen-tracking.css';

const FREQUENCY_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-Weekly',
  monthly: 'Monthly',
};

const STATUS_CONFIG = {
  scheduled: {
    label: 'Scheduled',
    badgeClass: 'status-scheduled',
    bg: 'rgba(59, 130, 246, 0.1)',
    color: '#2563eb',
    border: 'rgba(59, 130, 246, 0.3)',
    icon: '📅',
  },
  in_progress: {
    label: 'In Progress',
    badgeClass: 'status-inprogress',
    bg: 'rgba(217, 119, 6, 0.1)',
    color: '#b45309',
    border: 'rgba(217, 119, 6, 0.3)',
    icon: '⚡',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'status-resolved',
    bg: 'rgba(16, 185, 129, 0.1)',
    color: '#047857',
    border: 'rgba(16, 185, 129, 0.3)',
    icon: '✅',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'status-cancelled',
    bg: 'rgba(239, 68, 68, 0.1)',
    color: '#dc2626',
    border: 'rgba(239, 68, 68, 0.3)',
    icon: '❌',
  },
};

export default function AdminSchedules() {
  const { user } = useAuth();

  const [schedules, setSchedules] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Search and filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [frequencyFilter, setFrequencyFilter] = useState('all');
  const [workerFilter, setWorkerFilter] = useState('all');

  // Action feedback banner
  const [actionFeedback, setActionFeedback] = useState(null);

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Form input state
  const [formData, setFormData] = useState({
    title: '',
    zone_name: '',
    frequency: 'weekly',
    scheduled_date: new Date().toISOString().slice(0, 10),
    scheduled_start_time: '08:00',
    scheduled_end_time: '12:00',
    assigned_worker_id: '',
    status: 'scheduled',
    notes: '',
  });

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchSchedulesAndWorkers() {
      try {
        // 1. Fetch all schedules from collection_schedules table
        const { data: scheduleData, error: scheduleErr } = await supabase
          .from('collection_schedules')
          .select('id, title, zone_name, frequency, scheduled_date, scheduled_start_time, scheduled_end_time, assigned_worker_id, status, notes, created_by, created_at, updated_at')
          .order('scheduled_date', { ascending: true })
          .order('scheduled_start_time', { ascending: true });

        if (scheduleErr) {
          console.error('Error fetching collection schedules:', scheduleErr);
          if (isMounted) setError('Unable to load collection schedules. Please verify database permissions.');
          return;
        }

        // 2. Fetch all field workers for assignment mapping
        const { data: workerData, error: workerErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone_number, is_active')
          .eq('role', 'worker')
          .order('full_name', { ascending: true });

        if (workerErr) {
          console.warn('Error fetching workers for schedules:', workerErr);
        }

        if (isMounted) {
          setSchedules(scheduleData || []);
          setWorkers(workerData || []);
          setError(null);
        }
      } catch (err) {
        console.error('Exception fetching schedules:', err);
        if (isMounted) setError('Network error while retrieving collection schedules.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchSchedulesAndWorkers();

    // Supabase Realtime subscription for collection_schedules
    const schedulesChannel = supabase
      .channel('admin-schedules-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collection_schedules',
        },
        () => {
          fetchSchedulesAndWorkers();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(schedulesChannel);
    };
  }, [refreshKey]);

  // Worker lookup map
  const workerMap = workers.reduce((acc, w) => {
    acc[w.id] = w;
    return acc;
  }, {});

  // Open modal for new schedule
  const handleOpenCreateModal = () => {
    setEditingSchedule(null);
    setFormError(null);
    setFormData({
      title: '',
      zone_name: '',
      frequency: 'weekly',
      scheduled_date: new Date().toISOString().slice(0, 10),
      scheduled_start_time: '08:00',
      scheduled_end_time: '12:00',
      assigned_worker_id: '',
      status: 'scheduled',
      notes: '',
    });
    setIsModalOpen(true);
  };

  // Open modal for editing schedule
  const handleOpenEditModal = (schedule) => {
    setEditingSchedule(schedule);
    setFormError(null);
    setFormData({
      title: schedule.title || '',
      zone_name: schedule.zone_name || '',
      frequency: schedule.frequency || 'weekly',
      scheduled_date: schedule.scheduled_date || new Date().toISOString().slice(0, 10),
      scheduled_start_time: (schedule.scheduled_start_time || '08:00').slice(0, 5),
      scheduled_end_time: (schedule.scheduled_end_time || '12:00').slice(0, 5),
      assigned_worker_id: schedule.assigned_worker_id || '',
      status: schedule.status || 'scheduled',
      notes: schedule.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (formSubmitting) return;
    setIsModalOpen(false);
    setEditingSchedule(null);
    setFormError(null);
  };

  // Save Schedule (Create or Update)
  const handleSaveSchedule = async (e) => {
    e.preventDefault();
    setFormError(null);

    const titleTrimmed = formData.title.trim();
    const zoneTrimmed = formData.zone_name.trim();

    if (!titleTrimmed) {
      setFormError('Please enter a descriptive schedule title.');
      return;
    }

    if (!zoneTrimmed) {
      setFormError('Please specify the collection zone or route name.');
      return;
    }

    if (!formData.scheduled_date) {
      setFormError('Please select a scheduled pickup date.');
      return;
    }

    if (!formData.scheduled_start_time || !formData.scheduled_end_time) {
      setFormError('Please specify both start and end times for collection.');
      return;
    }

    setFormSubmitting(true);

    try {
      const payload = {
        title: titleTrimmed,
        zone_name: zoneTrimmed,
        frequency: formData.frequency,
        scheduled_date: formData.scheduled_date,
        scheduled_start_time: formData.scheduled_start_time,
        scheduled_end_time: formData.scheduled_end_time,
        assigned_worker_id: formData.assigned_worker_id || null,
        status: formData.status,
        notes: formData.notes?.trim() || null,
      };

      if (editingSchedule) {
        // Update existing schedule
        const { error: updateErr } = await supabase
          .from('collection_schedules')
          .update(payload)
          .eq('id', editingSchedule.id);

        if (updateErr) {
          throw updateErr;
        }

        setActionFeedback({
          type: 'success',
          message: `Schedule "${titleTrimmed}" was updated successfully.`,
        });
      } else {
        // Create new schedule
        payload.created_by = user?.id || null;

        const { error: insertErr } = await supabase
          .from('collection_schedules')
          .insert([payload]);

        if (insertErr) {
          throw insertErr;
        }

        setActionFeedback({
          type: 'success',
          message: `New collection schedule "${titleTrimmed}" created successfully.`,
        });
      }

      setIsModalOpen(false);
      setEditingSchedule(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Error saving collection schedule:', err);
      setFormError(err.message || 'Failed to save schedule. Please check permissions.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Delete Schedule
  const handleDeleteSchedule = async (schedule) => {
    if (!window.confirm(`Are you sure you want to permanently delete the schedule "${schedule.title}"?`)) {
      return;
    }

    try {
      const { error: deleteErr } = await supabase
        .from('collection_schedules')
        .delete()
        .eq('id', schedule.id);

      if (deleteErr) {
        throw deleteErr;
      }

      setActionFeedback({
        type: 'success',
        message: `Schedule "${schedule.title}" has been deleted.`,
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Error deleting schedule:', err);
      setActionFeedback({
        type: 'error',
        message: err.message || 'Failed to delete schedule.',
      });
    }
  };

  // Quick Status Change (e.g., mark completed or cancel)
  const handleQuickStatusUpdate = async (schedule, newStatus) => {
    try {
      const { error: updateErr } = await supabase
        .from('collection_schedules')
        .update({ status: newStatus })
        .eq('id', schedule.id);

      if (updateErr) {
        throw updateErr;
      }

      setActionFeedback({
        type: 'success',
        message: `Schedule "${schedule.title}" status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}.`,
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Status update error:', err);
      setActionFeedback({
        type: 'error',
        message: err.message || 'Failed to update schedule status.',
      });
    }
  };

  // Filtered schedules calculation
  const filteredSchedules = schedules.filter((s) => {
    // Search query
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchTitle = (s.title || '').toLowerCase().includes(q);
      const matchZone = (s.zone_name || '').toLowerCase().includes(q);
      const matchNotes = (s.notes || '').toLowerCase().includes(q);
      const assignedWorker = workerMap[s.assigned_worker_id];
      const matchWorker = assignedWorker ? assignedWorker.full_name.toLowerCase().includes(q) : false;

      if (!matchTitle && !matchZone && !matchNotes && !matchWorker) {
        return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all' && s.status !== statusFilter) {
      return false;
    }

    // Frequency filter
    if (frequencyFilter !== 'all' && s.frequency !== frequencyFilter) {
      return false;
    }

    // Worker filter
    if (workerFilter === 'assigned' && !s.assigned_worker_id) return false;
    if (workerFilter === 'unassigned' && s.assigned_worker_id) return false;
    if (workerFilter !== 'all' && workerFilter !== 'assigned' && workerFilter !== 'unassigned') {
      if (s.assigned_worker_id !== workerFilter) return false;
    }

    return true;
  });

  // Metrics counters
  const totalCount = schedules.length;
  const scheduledCount = schedules.filter((s) => s.status === 'scheduled').length;
  const inProgressCount = schedules.filter((s) => s.status === 'in_progress').length;
  const completedCount = schedules.filter((s) => s.status === 'completed').length;
  const cancelledCount = schedules.filter((s) => s.status === 'cancelled').length;

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
            <h1>Municipal Waste Collection Schedules</h1>
            <p>Define recurring pickup zones, assign municipal sanitation crews, and oversee route execution.</p>
          </div>

          <div className="tracking-actions-bar">
            <button
              type="button"
              className="btn-form-submit"
              onClick={handleOpenCreateModal}
              style={{ padding: '0.6rem 1.15rem', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <span>➕</span> New Schedule
            </button>
            <button
              type="button"
              className="btn-form-cancel"
              onClick={handleRetry}
              disabled={loading}
              style={{ padding: '0.6rem 1rem', fontSize: '0.875rem' }}
              title="Refresh collection schedules"
            >
              <span>🔄</span> Refresh
            </button>
          </div>
        </header>

        {/* Action Feedback Banner */}
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

        {/* 1. Schedule Metrics Overview */}
        <section aria-labelledby="schedule-metrics-heading">
          <h2 id="schedule-metrics-heading" className="sr-only">Schedule Metrics</h2>
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-label">Total Routes</span>
                <span className="admin-stat-card-icon" aria-hidden="true">🗺️</span>
              </div>
              <p className="admin-stat-card-value">{totalCount}</p>
              <p className="admin-stat-card-desc">Scheduled collection routes city-wide</p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-label">Upcoming / Active</span>
                <span className="admin-stat-card-icon" aria-hidden="true">⚡</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#2563eb' }}>
                {scheduledCount + inProgressCount}
              </p>
              <p className="admin-stat-card-desc">
                <strong>{scheduledCount}</strong> scheduled &bull; <strong>{inProgressCount}</strong> active
              </p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-label">Completed</span>
                <span className="admin-stat-card-icon" aria-hidden="true">✅</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#059669' }}>
                {completedCount}
              </p>
              <p className="admin-stat-card-desc">Successfully executed routes</p>
            </div>

            <div className="admin-stat-card">
              <div className="admin-stat-card-header">
                <span className="admin-stat-card-label">Cancelled</span>
                <span className="admin-stat-card-icon" aria-hidden="true">⚪</span>
              </div>
              <p className="admin-stat-card-value" style={{ color: '#6b7280' }}>
                {cancelledCount}
              </p>
              <p className="admin-stat-card-desc">Withdrawn or suspended pickups</p>
            </div>
          </div>
        </section>

        {/* 2. Toolbar: Search & Multi-Filters */}
        <section className="admin-toolbar-card" aria-label="Schedule Filters">
          <div className="admin-search-row">
            <div className="admin-search-input-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search by title, zone, assigned worker, or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search schedules"
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
              <label htmlFor="filter-schedule-status" className="filter-label">Execution Status</label>
              <select
                id="filter-schedule-status"
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-schedule-frequency" className="filter-label">Recurrence Frequency</label>
              <select
                id="filter-schedule-frequency"
                className="filter-select"
                value={frequencyFilter}
                onChange={(e) => setFrequencyFilter(e.target.value)}
              >
                <option value="all">All Frequencies</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-schedule-worker" className="filter-label">Crew Assignment</label>
              <select
                id="filter-schedule-worker"
                className="filter-select"
                value={workerFilter}
                onChange={(e) => setWorkerFilter(e.target.value)}
              >
                <option value="all">All Assignments</option>
                <option value="assigned">Assigned Crews</option>
                <option value="unassigned">Unassigned (Needs Crew)</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    Crew: {w.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setFrequencyFilter('all');
                  setWorkerFilter('all');
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
            <p className="state-title">Loading collection schedules...</p>
            <p className="state-desc">Retrieving municipal pickup routes and crew assignments.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Schedules</p>
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

        {/* Empty State: No schedules at all */}
        {!loading && !error && schedules.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">📅</span>
            <h2 className="state-title">No Collection Schedules Created</h2>
            <p className="state-desc">
              Organize regular garbage and waste pickup zones by scheduling recurring collection operations.
            </p>
            <button
              type="button"
              className="btn-form-submit state-action-btn"
              onClick={handleOpenCreateModal}
              style={{ display: 'inline-block' }}
            >
              ➕ Create First Schedule
            </button>
          </div>
        )}

        {/* Filtered Empty State */}
        {!loading && !error && schedules.length > 0 && filteredSchedules.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔍</span>
            <p className="state-title">No schedules match your search filters</p>
            <p className="state-desc">Try clearing your search query or adjusting status/frequency filters.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setFrequencyFilter('all');
                setWorkerFilter('all');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* 3. Schedules Table Card */}
        {!loading && !error && filteredSchedules.length > 0 && (
          <div className="admin-table-card">
            <div className="admin-table-wrapper">
              <table className="admin-table" aria-label="Municipal Collection Schedules Table">
                <thead>
                  <tr>
                    <th scope="col">Schedule &amp; Zone</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Date &amp; Time Window</th>
                    <th scope="col">Assigned Crew</th>
                    <th scope="col">Status</th>
                    <th scope="col">Notes</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.map((schedule) => {
                    const worker = workerMap[schedule.assigned_worker_id];
                    const statusInfo = STATUS_CONFIG[schedule.status] || {
                      label: schedule.status,
                      bg: 'rgba(107, 114, 128, 0.1)',
                      color: '#6b7280',
                      border: 'rgba(107, 114, 128, 0.3)',
                      icon: '❓',
                    };

                    const formattedDate = new Date(schedule.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    });

                    const startTime = (schedule.scheduled_start_time || '').slice(0, 5);
                    const endTime = (schedule.scheduled_end_time || '').slice(0, 5);

                    return (
                      <tr key={schedule.id}>
                        <td>
                          <div className="report-title-cell" style={{ maxWidth: '280px' }}>
                            <span className="report-title-text" style={{ fontSize: '0.95rem' }}>
                              {schedule.title}
                            </span>
                            <span className="report-address-sub" title={schedule.zone_name}>
                              📍 {schedule.zone_name}
                            </span>
                          </div>
                        </td>

                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'var(--code-bg)',
                              color: 'var(--text-h)',
                              border: '1px solid var(--border)',
                              textTransform: 'capitalize',
                            }}
                          >
                            {FREQUENCY_LABELS[schedule.frequency] || schedule.frequency}
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.825rem' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>{formattedDate}</span>
                            <span style={{ color: 'var(--text)', opacity: 0.85 }}>
                              ⏰ {startTime} &ndash; {endTime}
                            </span>
                          </div>
                        </td>

                        <td>
                          {worker ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-h)' }}>
                                {worker.full_name}
                              </span>
                              {worker.phone_number && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text)', opacity: 0.8 }}>
                                  📞 {worker.phone_number}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#dc2626',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                fontStyle: 'italic',
                              }}
                            >
                              Unassigned
                            </span>
                          )}
                        </td>

                        <td>
                          <span
                            className="worker-badge-pill"
                            style={{
                              fontSize: '0.75rem',
                              background: statusInfo.bg,
                              color: statusInfo.color,
                              borderColor: statusInfo.border,
                            }}
                          >
                            <span aria-hidden="true">{statusInfo.icon}</span>
                            {statusInfo.label}
                          </span>
                        </td>

                        <td>
                          <div
                            style={{
                              maxWidth: '180px',
                              fontSize: '0.8rem',
                              color: 'var(--text)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={schedule.notes || 'No dispatch notes'}
                          >
                            {schedule.notes ? schedule.notes : <span style={{ opacity: 0.5 }}>&mdash;</span>}
                          </div>
                        </td>

                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn-assign-row"
                              onClick={() => handleOpenEditModal(schedule)}
                              title="Edit schedule details"
                            >
                              Edit
                            </button>

                            {schedule.status !== 'completed' && schedule.status !== 'cancelled' && (
                              <button
                                type="button"
                                className="btn-form-cancel"
                                onClick={() => handleQuickStatusUpdate(schedule, 'completed')}
                                style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', color: '#059669', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                                title="Mark schedule as completed"
                              >
                                Complete
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn-form-cancel"
                              onClick={() => handleDeleteSchedule(schedule)}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', color: '#dc2626', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                              title="Delete this schedule"
                            >
                              Delete
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

        {/* 4. Create / Edit Schedule Modal */}
        {isModalOpen && (
          <div className="assign-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
            <div className="assign-modal-box" style={{ maxWidth: '560px' }}>
              <div className="assign-modal-header">
                <h3 id="schedule-modal-title">
                  {editingSchedule ? 'Edit Collection Schedule' : 'Create New Collection Schedule'}
                </h3>
                <button
                  type="button"
                  className="btn-close-modal"
                  onClick={handleCloseModal}
                  disabled={formSubmitting}
                  aria-label="Close dialog"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveSchedule}>
                <div className="assign-modal-body">
                  {/* Schedule Title */}
                  <div className="filter-group">
                    <label htmlFor="modal-schedule-title" className="filter-label">
                      Schedule Title <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      id="modal-schedule-title"
                      type="text"
                      className="filter-select"
                      placeholder="e.g., Morning Commercial Waste Pickup"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      disabled={formSubmitting}
                      required
                    />
                  </div>

                  {/* Zone / Area Name */}
                  <div className="filter-group">
                    <label htmlFor="modal-schedule-zone" className="filter-label">
                      Collection Zone / Route <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      id="modal-schedule-zone"
                      type="text"
                      className="filter-select"
                      placeholder="e.g., Zone A - Sector 3 / Green Park"
                      value={formData.zone_name}
                      onChange={(e) => setFormData({ ...formData, zone_name: e.target.value })}
                      disabled={formSubmitting}
                      required
                    />
                  </div>

                  {/* Frequency and Status Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="filter-group">
                      <label htmlFor="modal-schedule-frequency" className="filter-label">
                        Recurrence Frequency
                      </label>
                      <select
                        id="modal-schedule-frequency"
                        className="filter-select"
                        value={formData.frequency}
                        onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                        disabled={formSubmitting}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label htmlFor="modal-schedule-status" className="filter-label">
                        Execution Status
                      </label>
                      <select
                        id="modal-schedule-status"
                        className="filter-select"
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        disabled={formSubmitting}
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>

                  {/* Date and Timing Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div className="filter-group">
                      <label htmlFor="modal-schedule-date" className="filter-label">
                        Date <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        id="modal-schedule-date"
                        type="date"
                        className="filter-select"
                        value={formData.scheduled_date}
                        onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                        disabled={formSubmitting}
                        required
                      />
                    </div>

                    <div className="filter-group">
                      <label htmlFor="modal-schedule-start" className="filter-label">
                        Start Time <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        id="modal-schedule-start"
                        type="time"
                        className="filter-select"
                        value={formData.scheduled_start_time}
                        onChange={(e) => setFormData({ ...formData, scheduled_start_time: e.target.value })}
                        disabled={formSubmitting}
                        required
                      />
                    </div>

                    <div className="filter-group">
                      <label htmlFor="modal-schedule-end" className="filter-label">
                        End Time <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        id="modal-schedule-end"
                        type="time"
                        className="filter-select"
                        value={formData.scheduled_end_time}
                        onChange={(e) => setFormData({ ...formData, scheduled_end_time: e.target.value })}
                        disabled={formSubmitting}
                        required
                      />
                    </div>
                  </div>

                  {/* Assigned Worker */}
                  <div className="filter-group">
                    <label htmlFor="modal-schedule-worker" className="filter-label">
                      Assign Municipal Field Crew (Optional)
                    </label>
                    <select
                      id="modal-schedule-worker"
                      className="filter-select"
                      value={formData.assigned_worker_id}
                      onChange={(e) => setFormData({ ...formData, assigned_worker_id: e.target.value })}
                      disabled={formSubmitting}
                    >
                      <option value="">-- Leave Unassigned --</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.full_name} ({w.email}) {w.is_active === false ? '[Off-Duty]' : '[Active]'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Operational Notes */}
                  <div className="filter-group">
                    <label htmlFor="modal-schedule-notes" className="filter-label">
                      Route Instructions / Notes (Optional)
                    </label>
                    <textarea
                      id="modal-schedule-notes"
                      className="filter-select"
                      rows={3}
                      placeholder="e.g., Focus on commercial alleyways; secondary truck required for heavy bins."
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      disabled={formSubmitting}
                    />
                  </div>

                  {/* Form Error Banner */}
                  {formError && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.825rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: '#dc2626',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                      role="alert"
                    >
                      {formError}
                    </div>
                  )}
                </div>

                <div className="assign-modal-footer">
                  <button
                    type="button"
                    className="btn-form-cancel"
                    onClick={handleCloseModal}
                    disabled={formSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-form-submit"
                    disabled={formSubmitting}
                    style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem' }}
                  >
                    {formSubmitting
                      ? 'Saving...'
                      : editingSchedule
                      ? 'Update Schedule'
                      : 'Create Schedule'}
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
