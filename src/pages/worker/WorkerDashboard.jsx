import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import WorkerLocationWidget from '../../components/worker/WorkerLocationWidget';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen-tracking.css';
import '../../styles/worker.css';

const GARBAGE_TYPE_LABELS = {
  general: 'General Waste',
  household: 'Household Waste',
  commercial: 'Commercial Waste',
  construction: 'Construction / Debris',
  organic: 'Organic / Food Waste',
  plastic: 'Plastic / Recyclable',
  electronic: 'Electronic (E-waste)',
  hazardous: 'Hazardous / Biohazard',
  bulk: 'Bulk / Large Items',
  other: 'Other / Mixed Waste',
};

const SEVERITY_WEIGHT = {
  critical: 5,
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export default function WorkerDashboard() {
  const { profile, user, refreshProfile } = useAuth();

  const [stats, setStats] = useState({
    assigned: 0,
    accepted: 0,
    inProgress: 0,
    resolved: 0,
    total: 0,
    loading: true,
  });

  const [priorityTask, setPriorityTask] = useState(null);
  const [assignedTasks, setAssignedTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // My Collection Schedules state
  const [schedules, setSchedules] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);

  // Duty status toggle state
  const [overrideDuty, setOverrideDuty] = useState(null);
  const [isTogglingDuty, setIsTogglingDuty] = useState(false);
  const [dutyFeedback, setDutyFeedback] = useState(null);

  const dutyStatus = overrideDuty !== null ? overrideDuty : (profile?.is_active !== false);

  const handleToggleDuty = async () => {
    if (isTogglingDuty) return;
    const targetStatus = !dutyStatus;
    setIsTogglingDuty(true);
    setDutyFeedback(null);

    try {
      const { data, error } = await supabase.rpc('set_worker_duty_status', {
        p_is_active: targetStatus,
      });

      if (error) {
        console.error('set_worker_duty_status error:', error);
        setDutyFeedback({
          type: 'error',
          message: error.message || 'Could not update duty status.',
        });
      } else if (data?.success === false) {
        setDutyFeedback({
          type: 'error',
          message: data?.message || 'Duty status update was rejected.',
        });
      } else {
        setOverrideDuty(targetStatus);
        setDutyFeedback({
          type: 'success',
          message: targetStatus ? 'You are now ON DUTY (Available for dispatch)' : 'You are now OFF DUTY (No auto-dispatches)',
        });
        if (typeof refreshProfile === 'function') {
          refreshProfile();
        }
        setTimeout(() => setDutyFeedback(null), 4000);
      }
    } catch (err) {
      console.error('Duty toggle exception:', err);
      setDutyFeedback({
        type: 'error',
        message: 'Network error updating duty status.',
      });
    } finally {
      setIsTogglingDuty(false);
    }
  };

  const displayName = profile?.full_name || user?.user_metadata?.full_name || 'Field Worker';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const formatTime = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
      return d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatScheduleDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  useEffect(() => {
    const workerId = user?.id;
    if (!workerId) return;

    let isMounted = true;

    async function loadWorkerDashboard() {
      try {
        const { data, error } = await supabase
          .from('reports')
          .select('id, title, description, status, severity, garbage_type, address, photo_url, created_at, updated_at')
          .eq('assigned_worker_id', workerId)
          .order('updated_at', { ascending: false });

        if (error) {
          console.error('Error loading worker reports:', error);
          if (isMounted) {
            setStats((prev) => ({ ...prev, loading: false }));
            setLoadingTasks(false);
          }
          return;
        }

        const list = data || [];

        // Real counts
        const assignedCount = list.filter((r) => r.status === 'Assigned').length;
        const acceptedCount = list.filter((r) => r.status === 'Accepted').length;
        const inProgressCount = list.filter((r) => r.status === 'In Progress').length;
        const resolvedCount = list.filter((r) => r.status === 'Resolved').length;

        // Unresolved tasks for priority selection
        const unResolved = list.filter((r) => r.status !== 'Resolved');

        let primary = unResolved.find((r) => r.status === 'In Progress') ||
                      unResolved.find((r) => r.status === 'Accepted') ||
                      null;

        if (!primary && unResolved.length > 0) {
          const sorted = [...unResolved].sort((a, b) => {
            const rankA = SEVERITY_WEIGHT[a.severity?.toLowerCase()] || 0;
            const rankB = SEVERITY_WEIGHT[b.severity?.toLowerCase()] || 0;
            if (rankB !== rankA) return rankB - rankA;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
          });
          primary = sorted[0];
        }

        const activeQueue = unResolved.length > 0 ? unResolved : list;

        if (isMounted) {
          setStats({
            assigned: assignedCount,
            accepted: acceptedCount,
            inProgress: inProgressCount,
            resolved: resolvedCount,
            total: list.length,
            loading: false,
          });
          setPriorityTask(primary);
          setAssignedTasks(activeQueue.slice(0, 6));
          setLoadingTasks(false);
        }
      } catch (err) {
        console.error('Exception loading worker dashboard:', err);
        if (isMounted) {
          setStats((prev) => ({ ...prev, loading: false }));
          setLoadingTasks(false);
        }
      }
    }

    async function loadWorkerSchedules() {
      try {
        const { data, error: schedErr } = await supabase
          .from('collection_schedules')
          .select('id, title, zone_name, frequency, scheduled_date, scheduled_start_time, scheduled_end_time, status, notes')
          .eq('assigned_worker_id', workerId)
          .neq('status', 'cancelled')
          .order('scheduled_date', { ascending: true })
          .order('scheduled_start_time', { ascending: true })
          .limit(4);

        if (!schedErr && isMounted) {
          setSchedules(data || []);
        }
      } catch (err) {
        console.warn('Could not load worker schedules:', err);
      } finally {
        if (isMounted) setLoadingSchedules(false);
      }
    }

    loadWorkerDashboard();
    loadWorkerSchedules();

    const channel = supabase
      .channel(`worker-reports-${workerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `assigned_worker_id=eq.${workerId}`,
        },
        () => {
          loadWorkerDashboard();
        }
      )
      .subscribe();

    const schedulesChannel = supabase
      .channel(`worker-schedules-${workerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collection_schedules',
          filter: `assigned_worker_id=eq.${workerId}`,
        },
        () => {
          loadWorkerSchedules();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
      supabase.removeChannel(schedulesChannel);
    };
  }, [user]);

  return (
    <div className="worker-layout">
      <UserNavbar />

      <main className="worker-dashboard-content" role="main">
        {/* SECTION 1 — SIMPLE HEADER */}
        <header className="worker-header-section">
          <div className="worker-header-top-row">
            <span className="worker-eyebrow">FIELD OPERATIONS</span>
            <button
              type="button"
              className={`worker-duty-toggle-btn ${dutyStatus ? 'on-duty' : 'off-duty'}`}
              onClick={handleToggleDuty}
              disabled={isTogglingDuty}
              title={dutyStatus ? 'Currently On Duty. Click to switch Off Duty.' : 'Currently Off Duty. Click to switch On Duty.'}
              aria-label={`Duty status: ${dutyStatus ? 'On Duty' : 'Off Duty'}. Click to toggle.`}
            >
              <span className="duty-dot" aria-hidden="true" />
              <span>{isTogglingDuty ? 'UPDATING...' : (dutyStatus ? 'ON DUTY' : 'OFF DUTY')}</span>
              <span className="duty-toggle-hint">
                {dutyStatus ? 'Switch Off' : 'Go On Duty'}
              </span>
            </button>
          </div>

          {dutyFeedback && (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginTop: '0.5rem',
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: dutyFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(220, 38, 38, 0.12)',
                color: dutyFeedback.type === 'success' ? '#16A34A' : '#DC2626',
                border: `1px solid ${dutyFeedback.type === 'success' ? 'rgba(22, 163, 74, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
              }}
            >
              <span>{dutyFeedback.type === 'success' ? '✓' : '⚠️'}</span>
              <span>{dutyFeedback.message}</span>
            </div>
          )}

          <h1 className="worker-greeting">
            {getGreeting()}, {displayName}
          </h1>
          <p className="worker-subtext">
            Here are the cleanup tasks that need your attention.
          </p>
        </header>

        {/* SECTION 2 — SIMPLE KPI ROW */}
        <section className="worker-kpi-section" aria-label="Current Task Numbers">
          <div className="worker-kpi-grid">
            <article className="worker-kpi-card">
              <span className="kpi-label">ASSIGNED</span>
              <span className="kpi-number">{stats.loading ? '...' : stats.assigned}</span>
              <p className="kpi-desc">Tasks waiting for action</p>
            </article>

            <article className="worker-kpi-card">
              <span className="kpi-label">ACCEPTED</span>
              <span className="kpi-number">{stats.loading ? '...' : stats.accepted}</span>
              <p className="kpi-desc">Ready for site transit</p>
            </article>

            <article className="worker-kpi-card">
              <span className="kpi-label">IN PROGRESS</span>
              <span className="kpi-number">{stats.loading ? '...' : stats.inProgress}</span>
              <p className="kpi-desc">Active cleanup underway</p>
            </article>

            <article className="worker-kpi-card">
              <span className="kpi-label">RESOLVED</span>
              <span className="kpi-number">{stats.loading ? '...' : stats.resolved}</span>
              <p className="kpi-desc">Completed &amp; certified</p>
            </article>
          </div>
        </section>

        {/* SECTION 3 — PRIORITY TASK */}
        <section className="worker-priority-section" aria-labelledby="priority-heading">
          <h2 id="priority-heading" className="worker-section-title">TODAY&apos;S PRIORITY</h2>

          {loadingTasks ? (
            <div className="worker-loading-card">
              <div className="tracking-spinner" />
              <p>Checking priority assignments...</p>
            </div>
          ) : priorityTask ? (
            <article className="worker-priority-card">
              <div className="priority-card-header">
                <span className={`worker-severity-pill severity-${(priorityTask.severity || 'medium').toLowerCase()}`}>
                  {priorityTask.severity?.toUpperCase() || 'MEDIUM'}
                </span>
                <span className="worker-task-id">#{priorityTask.id.slice(0, 8)}</span>
              </div>

              <h3 className="priority-card-title">{priorityTask.title}</h3>

              <p className="priority-card-location">
                <span aria-hidden="true">📍</span> {priorityTask.address || 'Location coordinates recorded'}
              </p>

              <div className="priority-card-meta">
                <span>{GARBAGE_TYPE_LABELS[priorityTask.garbage_type] || priorityTask.garbage_type || 'General Waste'}</span>
                <span className="meta-sep" aria-hidden="true">&bull;</span>
                <span className="priority-status-text">{priorityTask.status}</span>
                <span className="meta-sep" aria-hidden="true">&bull;</span>
                <span>{formatTime(priorityTask.created_at)}</span>
              </div>

              <div className="priority-card-footer">
                <Link
                  to={`/worker/reports/${priorityTask.id}`}
                  className="btn-worker-priority-action"
                  aria-label={`View priority task: ${priorityTask.title}`}
                >
                  VIEW TASK &rarr;
                </Link>
              </div>
            </article>
          ) : (
            <div className="worker-empty-card">
              <span className="empty-check-icon" aria-hidden="true">✓</span>
              <h3 className="empty-card-title">No Priority Tasks Right Now</h3>
              <p className="empty-card-desc">
                You are all caught up. Any high-priority field cleanup dispatches will appear here.
              </p>
            </div>
          )}
        </section>

        {/* SECTION 4 — YOUR ASSIGNED TASKS */}
        <section className="worker-assigned-section" aria-labelledby="assigned-tasks-heading">
          <div className="worker-section-header">
            <div>
              <h2 id="assigned-tasks-heading" className="worker-section-title">YOUR ASSIGNED TASKS</h2>
              <p className="worker-section-subtext">Tasks currently assigned to you.</p>
            </div>
            {stats.total > 0 && (
              <Link to="/worker/reports" className="btn-worker-secondary-link">
                View All ({stats.total}) &rarr;
              </Link>
            )}
          </div>

          {loadingTasks ? (
            <div className="worker-loading-card">
              <div className="tracking-spinner" />
              <p>Loading assigned tasks...</p>
            </div>
          ) : assignedTasks.length === 0 ? (
            <div className="worker-empty-card">
              <span className="empty-check-icon" aria-hidden="true">📋</span>
              <h3 className="empty-card-title">No Assigned Tasks</h3>
              <p className="empty-card-desc">
                There are no active cleanup tasks assigned to you at the moment.
              </p>
            </div>
          ) : (
            <div className="worker-compact-cards-grid">
              {assignedTasks.map((task) => (
                <article key={task.id} className="worker-compact-card">
                  <div className="compact-card-top">
                    <span className={`worker-severity-pill severity-${(task.severity || 'medium').toLowerCase()}`}>
                      {task.severity?.toUpperCase() || 'MEDIUM'}
                    </span>
                    <span className="worker-task-id">#{task.id.slice(0, 8)}</span>
                  </div>

                  <h3 className="compact-card-title">{task.title}</h3>

                  <p className="compact-card-location">
                    <span aria-hidden="true">📍</span> {task.address || 'Location coordinates recorded'}
                  </p>

                  <div className="compact-card-footer">
                    <span className={`worker-status-badge status-${(task.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                      {task.status}
                    </span>
                    <Link
                      to={`/worker/reports/${task.id}`}
                      className="btn-compact-view-task"
                      aria-label={`View task: ${task.title}`}
                    >
                      VIEW TASK &rarr;
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 5 — MY COLLECTION SCHEDULES */}
        <section className="worker-schedules-section" aria-labelledby="schedules-heading">
          <div className="worker-section-header">
            <div>
              <h2 id="schedules-heading" className="worker-section-title">MY COLLECTION SCHEDULES</h2>
              <p className="worker-section-subtext">Upcoming municipal routes and collection schedules assigned to you.</p>
            </div>
          </div>

          {loadingSchedules ? (
            <div className="worker-loading-card">
              <div className="tracking-spinner" />
              <p>Loading assigned collection schedules...</p>
            </div>
          ) : schedules.length === 0 ? (
            <div className="worker-empty-card">
              <span className="empty-check-icon" aria-hidden="true">🗓️</span>
              <h3 className="empty-card-title">No Collection Schedules Assigned</h3>
              <p className="empty-card-desc">
                You do not have any municipal collection schedules or recurring routes scheduled.
              </p>
            </div>
          ) : (
            <div className="worker-schedules-grid">
              {schedules.map((schedule) => (
                <article key={schedule.id} className="worker-schedule-card">
                  <div className="schedule-card-top">
                    <span className="worker-frequency-pill">
                      {schedule.frequency ? schedule.frequency.toUpperCase() : 'SCHEDULED'}
                    </span>
                    <span className={`worker-schedule-status status-${(schedule.status || 'scheduled').toLowerCase()}`}>
                      {schedule.status === 'in_progress' ? 'Active' : schedule.status === 'scheduled' ? 'Upcoming' : (schedule.status || 'Scheduled')}
                    </span>
                  </div>

                  <h3 className="schedule-card-title">{schedule.title}</h3>

                  <div className="schedule-card-zone">
                    <span aria-hidden="true">📍</span> Zone: <strong>{schedule.zone_name}</strong>
                  </div>

                  <div className="schedule-card-worker" style={{ fontSize: '0.775rem', color: 'var(--worker-text-body, #555)', margin: '0.2rem 0' }}>
                    <span aria-hidden="true">👤</span> Assigned Worker: <strong>{profile?.full_name || 'You'}</strong>
                  </div>

                  <div className="schedule-card-timing">
                    <span className="schedule-time-item">
                      <span aria-hidden="true">🗓️</span> {formatScheduleDate(schedule.scheduled_date)}
                    </span>
                    <span className="schedule-time-item">
                      <span aria-hidden="true">⏰</span> {schedule.scheduled_start_time?.slice(0, 5)} - {schedule.scheduled_end_time?.slice(0, 5)}
                    </span>
                  </div>

                  {schedule.notes && (
                    <p className="schedule-card-notes">
                      <strong>Note:</strong> {schedule.notes}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 6 — LOCATION WIDGET */}
        <section className="worker-location-section" aria-label="Worker Field Dispatch Location">
          <WorkerLocationWidget />
        </section>
      </main>
    </div>
  );
}
