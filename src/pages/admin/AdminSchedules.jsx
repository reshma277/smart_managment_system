import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';

const FREQUENCY_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-Weekly',
  monthly: 'Monthly',
};

const STATUS_CONFIG = {
  scheduled: {
    label: 'Scheduled',
    color: '#2563EB',
    bg: 'rgba(37, 99, 235, 0.08)',
  },
  in_progress: {
    label: 'In Progress',
    color: '#D97706',
    bg: 'rgba(217, 119, 6, 0.1)',
  },
  completed: {
    label: 'Completed',
    color: '#16A34A',
    bg: 'rgba(22, 163, 74, 0.1)',
  },
  cancelled: {
    label: 'Cancelled',
    color: '#DC2626',
    bg: 'rgba(220, 38, 38, 0.1)',
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

    const schedulesChannel = supabase
      .channel('admin-schedules-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collection_schedules' },
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

  const workerMap = workers.reduce((acc, w) => {
    acc[w.id] = w;
    return acc;
  }, {});

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
        const { error: updateErr } = await supabase
          .from('collection_schedules')
          .update(payload)
          .eq('id', editingSchedule.id);

        if (updateErr) throw updateErr;

        setActionFeedback({
          type: 'success',
          message: `Schedule "${titleTrimmed}" was updated successfully.`,
        });
      } else {
        payload.created_by = user?.id || null;

        const { error: insertErr } = await supabase
          .from('collection_schedules')
          .insert([payload]);

        if (insertErr) throw insertErr;

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
      setFormError(err.message || 'Failed to save schedule.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteSchedule = async (schedule) => {
    if (!window.confirm(`Are you sure you want to delete the schedule "${schedule.title}"?`)) {
      return;
    }

    try {
      const { error: deleteErr } = await supabase
        .from('collection_schedules')
        .delete()
        .eq('id', schedule.id);

      if (deleteErr) throw deleteErr;

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

  const handleStatusChange = async (schedule, newStatus) => {
    try {
      const { error: updateErr } = await supabase
        .from('collection_schedules')
        .update({ status: newStatus })
        .eq('id', schedule.id);

      if (updateErr) throw updateErr;

      setActionFeedback({
        type: 'success',
        message: `Schedule status updated to "${STATUS_CONFIG[newStatus]?.label || newStatus}".`,
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Error changing schedule status:', err);
      setActionFeedback({
        type: 'error',
        message: err.message || 'Failed to update schedule status.',
      });
    }
  };

  // Filtered schedules
  const filteredSchedules = schedules.filter((s) => {
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchTitle = (s.title || '').toLowerCase().includes(query);
      const matchZone = (s.zone_name || '').toLowerCase().includes(query);
      const workerName = s.assigned_worker_id ? (workerMap[s.assigned_worker_id]?.full_name || '').toLowerCase() : '';
      if (!matchTitle && !matchZone && !workerName.includes(query)) return false;
    }

    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (frequencyFilter !== 'all' && s.frequency !== frequencyFilter) return false;
    if (workerFilter !== 'all') {
      if (workerFilter === 'unassigned' && s.assigned_worker_id) return false;
      if (workerFilter !== 'unassigned' && s.assigned_worker_id !== workerFilter) return false;
    }

    return true;
  });

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* HEADER */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">COLLECTION OPERATIONS</span>
              <span className="admin-role-badge">
                <span>{schedules.length} Active Schedules</span>
              </span>
            </div>
            <h1 className="admin-title">Collection Schedules</h1>
            <p className="admin-subtitle">
              Coordinate recurring municipal collection activity.
            </p>
          </div>

          <div className="admin-header-actions">
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleOpenCreateModal}
            >
              + Create Schedule
            </button>
            <Link to="/admin" className="btn-admin-secondary">
              &larr; Municipal Command
            </Link>
          </div>
        </header>

        {/* ACTION FEEDBACK */}
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

        {/* SUMMARY / FILTER TOOLBAR */}
        <section className="admin-toolbar-card" aria-label="Schedule Filters">
          <div className="admin-search-row">
            <div className="admin-search-wrap">
              <span className="admin-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="admin-search-input"
                placeholder="Search schedules by title, zone, or worker..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search collection schedules"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="admin-filter-field" style={{ minWidth: '140px' }}>
                <select
                  className="admin-filter-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by schedule status"
                >
                  <option value="all">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="admin-filter-field" style={{ minWidth: '140px' }}>
                <select
                  className="admin-filter-select"
                  value={frequencyFilter}
                  onChange={(e) => setFrequencyFilter(e.target.value)}
                  aria-label="Filter by frequency"
                >
                  <option value="all">All Frequencies</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="admin-filter-field" style={{ minWidth: '160px' }}>
                <select
                  className="admin-filter-select"
                  value={workerFilter}
                  onChange={(e) => setWorkerFilter(e.target.value)}
                  aria-label="Filter by assigned worker"
                >
                  <option value="all">All Assigned Staff</option>
                  <option value="unassigned">Unassigned</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {(searchTerm || statusFilter !== 'all' || frequencyFilter !== 'all' || workerFilter !== 'all') && (
                <button
                  type="button"
                  className="btn-admin-secondary btn-admin-sm"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setFrequencyFilter('all');
                    setWorkerFilter('all');
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
            <p className="admin-state-title">Loading Collection Schedules...</p>
            <p className="admin-state-desc">Retrieving municipal collection routes, assigned crews, and time windows.</p>
          </div>
        )}

        {!loading && error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Unable to Load Schedules</p>
            <p className="admin-state-desc">{error}</p>
            <button type="button" className="btn-admin-primary" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && !error && filteredSchedules.length === 0 && (
          <div className="admin-state-box">
            <span className="admin-state-icon" aria-hidden="true">📅</span>
            <h2 className="admin-state-title">No Collection Schedules Found</h2>
            <p className="admin-state-desc">
              {schedules.length === 0
                ? 'No collection routes are currently configured. Create a schedule to organize municipal pickups.'
                : 'No schedules match your current search or status filters.'}
            </p>
            <button
              type="button"
              className="btn-admin-primary btn-admin-sm"
              onClick={handleOpenCreateModal}
            >
              + Create First Schedule
            </button>
          </div>
        )}

        {/* SCHEDULES LIST TABLE */}
        {!loading && !error && filteredSchedules.length > 0 && (
          <section className="admin-table-card" aria-label="Schedules Table">
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Schedule Name &amp; Zone</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Assigned Worker</th>
                    <th scope="col">Date &amp; Window</th>
                    <th scope="col">Status</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.map((schedule) => {
                    const assignedWorker = schedule.assigned_worker_id
                      ? workerMap[schedule.assigned_worker_id]
                      : null;
                    const statusCfg = STATUS_CONFIG[schedule.status] || STATUS_CONFIG.scheduled;

                    return (
                      <tr key={schedule.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                            <span style={{ fontWeight: 800, color: 'var(--admin-text-h)' }}>{schedule.title}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                              📍 Zone: {schedule.zone_name}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="ref-id-badge">
                            {FREQUENCY_LABELS[schedule.frequency] || schedule.frequency}
                          </span>
                        </td>
                        <td>
                          {assignedWorker ? (
                            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--admin-text-h)' }}>
                              👤 {assignedWorker.full_name}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-warning)', fontStyle: 'italic' }}>
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', fontSize: '0.8rem', color: 'var(--admin-text-body)' }}>
                            <span>{new Date(schedule.scheduled_date).toLocaleDateString()}</span>
                            <span>{schedule.scheduled_start_time?.slice(0, 5)} - {schedule.scheduled_end_time?.slice(0, 5)}</span>
                          </div>
                        </td>
                        <td>
                          <select
                            className="admin-filter-select"
                            style={{
                              padding: '0.25rem 0.6rem',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color: statusCfg.color,
                              background: statusCfg.bg,
                              border: `1px solid ${statusCfg.color}30`,
                            }}
                            value={schedule.status}
                            onChange={(e) => handleStatusChange(schedule, e.target.value)}
                            aria-label={`Change status of ${schedule.title}`}
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => handleOpenEditModal(schedule)}
                              title="Edit schedule"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-admin-secondary btn-admin-sm"
                              onClick={() => handleDeleteSchedule(schedule)}
                              style={{ color: '#DC2626' }}
                              title="Delete schedule"
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
          </section>
        )}

        {/* CREATE / EDIT MODAL */}
        {isModalOpen && (
          <div
            className="admin-modal-overlay"
            onClick={handleCloseModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-modal-title"
          >
            <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h3 id="schedule-modal-title">
                  {editingSchedule ? 'Edit Collection Schedule' : 'Create Collection Schedule'}
                </h3>
                <button
                  type="button"
                  className="btn-admin-modal-close"
                  onClick={handleCloseModal}
                  aria-label="Close dialog"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveSchedule}>
                <div className="admin-modal-body">
                  {formError && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.825rem',
                        fontWeight: 600,
                        background: 'rgba(220, 38, 38, 0.1)',
                        color: '#DC2626',
                        border: '1px solid rgba(220, 38, 38, 0.3)',
                      }}
                    >
                      {formError}
                    </div>
                  )}

                  <div className="admin-filter-field">
                    <label htmlFor="sched-title" className="admin-filter-label">Schedule Title *</label>
                    <input
                      id="sched-title"
                      type="text"
                      className="admin-search-input"
                      placeholder="e.g., Ward 4 Morning Organic Pickup"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="admin-filter-field">
                      <label htmlFor="sched-zone" className="admin-filter-label">Zone / Route Name *</label>
                      <input
                        id="sched-zone"
                        type="text"
                        className="admin-search-input"
                        placeholder="e.g., Zone 4A - Downtown"
                        value={formData.zone_name}
                        onChange={(e) => setFormData({ ...formData, zone_name: e.target.value })}
                        required
                      />
                    </div>

                    <div className="admin-filter-field">
                      <label htmlFor="sched-freq" className="admin-filter-label">Frequency *</label>
                      <select
                        id="sched-freq"
                        className="admin-filter-select"
                        value={formData.frequency}
                        onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
                    <div className="admin-filter-field">
                      <label htmlFor="sched-date" className="admin-filter-label">Pickup Date *</label>
                      <input
                        id="sched-date"
                        type="date"
                        className="admin-search-input"
                        value={formData.scheduled_date}
                        onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                        required
                      />
                    </div>

                    <div className="admin-filter-field">
                      <label htmlFor="sched-start" className="admin-filter-label">Start Time *</label>
                      <input
                        id="sched-start"
                        type="time"
                        className="admin-search-input"
                        value={formData.scheduled_start_time}
                        onChange={(e) => setFormData({ ...formData, scheduled_start_time: e.target.value })}
                        required
                      />
                    </div>

                    <div className="admin-filter-field">
                      <label htmlFor="sched-end" className="admin-filter-label">End Time *</label>
                      <input
                        id="sched-end"
                        type="time"
                        className="admin-search-input"
                        value={formData.scheduled_end_time}
                        onChange={(e) => setFormData({ ...formData, scheduled_end_time: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="admin-filter-field">
                      <label htmlFor="sched-worker" className="admin-filter-label">Assigned Worker</label>
                      <select
                        id="sched-worker"
                        className="admin-filter-select"
                        value={formData.assigned_worker_id}
                        onChange={(e) => setFormData({ ...formData, assigned_worker_id: e.target.value })}
                      >
                        <option value="">Unassigned</option>
                        {workers.map((w) => (
                          <option key={w.id} value={w.id} disabled={w.is_active === false}>
                            {w.full_name} {w.is_active === false ? '(Off-Duty)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="admin-filter-field">
                      <label htmlFor="sched-status" className="admin-filter-label">Status</label>
                      <select
                        id="sched-status"
                        className="admin-filter-select"
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>

                  <div className="admin-filter-field">
                    <label htmlFor="sched-notes" className="admin-filter-label">Route Notes / Special Instructions</label>
                    <textarea
                      id="sched-notes"
                      className="admin-search-input"
                      style={{ height: '60px', padding: '0.65rem 0.85rem' }}
                      placeholder="Vehicle requirement, waste segregation instructions..."
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="admin-modal-footer">
                  <button
                    type="button"
                    className="btn-admin-secondary btn-admin-sm"
                    onClick={handleCloseModal}
                    disabled={formSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-admin-primary btn-admin-sm"
                    disabled={formSubmitting}
                  >
                    {formSubmitting ? 'Saving...' : editingSchedule ? 'Update Schedule' : 'Create Schedule'}
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
