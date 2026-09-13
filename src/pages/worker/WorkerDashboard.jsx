import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import WorkerLocationWidget from '../../components/worker/WorkerLocationWidget';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/worker.css';
import '../../styles/citizen-tracking.css';

export default function WorkerDashboard() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const [stats, setStats] = useState({
    assigned: 0,
    accepted: 0,
    inProgress: 0,
    resolved: 0,
    total: 0,
    loading: true,
  });

  const [activeTask, setActiveTask] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [signedThumbnails, setSignedThumbnails] = useState({});

  const displayName = profile?.full_name || user?.user_metadata?.full_name || 'Field Worker';
  const displayEmail = profile?.email || user?.email || '';

  useEffect(() => {
    const workerId = user?.id;
    if (!workerId) return;

    let isMounted = true;

    async function loadWorkerDashboard() {
      try {
        // Query assigned tasks for this worker
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

        // Compute counts
        const assignedCount = list.filter((r) => r.status === 'Assigned').length;
        const acceptedCount = list.filter((r) => r.status === 'Accepted').length;
        const inProgressCount = list.filter((r) => r.status === 'In Progress').length;
        const resolvedCount = list.filter((r) => r.status === 'Resolved').length;

        // Find primary active task (in progress takes precedence, then accepted)
        const currentActive = list.find((r) => r.status === 'In Progress') ||
                              list.find((r) => r.status === 'Accepted') ||
                              null;

        if (isMounted) {
          setStats({
            assigned: assignedCount,
            accepted: acceptedCount,
            inProgress: inProgressCount,
            resolved: resolvedCount,
            total: list.length,
            loading: false,
          });
          setActiveTask(currentActive);
          setRecentTasks(list.slice(0, 6));
          setLoadingTasks(false);
        }

        // Resolve thumbnail URLs for top tasks
        const photosToSign = list.slice(0, 6).map((r) => r.photo_url).filter(Boolean);
        if (photosToSign.length > 0 && isMounted) {
          const map = {};
          await Promise.all(
            photosToSign.map(async (path) => {
              try {
                const { data: signData } = await supabase.storage
                  .from('report-photos')
                  .createSignedUrl(path, 3600);
                if (signData?.signedUrl) {
                  map[path] = signData.signedUrl;
                }
              } catch (err) {
                console.warn('Could not sign photo URL:', path, err);
              }
            })
          );
          if (isMounted) setSignedThumbnails(map);
        }
      } catch (err) {
        console.error('Exception loading worker dashboard:', err);
        if (isMounted) {
          setStats((prev) => ({ ...prev, loading: false }));
          setLoadingTasks(false);
        }
      }
    }

    loadWorkerDashboard();

    // Subscribe to realtime changes on reports assigned to this worker
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

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="worker-layout">
      <UserNavbar />

      <main className="worker-main-content" role="main">
        {/* Hero Card */}
        <header className="worker-hero-card">
          <div className="worker-hero-top">
            <div className="worker-header-info">
              <div className="worker-header-avatar" aria-hidden="true">
                🚛
              </div>
              <div className="worker-header-text">
                <h1>Field Operations Portal</h1>
                <div className="worker-meta">
                  <span>Logged in as <strong>{displayName}</strong></span>
                  {displayEmail && <span className="citizen-email">{displayEmail}</span>}
                  <span className="duty-status-badge">
                    <span className="live-dot" aria-hidden="true"></span>
                    On Duty
                  </span>
                </div>
              </div>
            </div>

            <div className="tab-pane-actions">
              <Link to="/worker/reports" className="btn-secondary-link" style={{ fontSize: '0.95rem' }}>
                All Assigned Tasks ({stats.total}) &rarr;
              </Link>
            </div>
          </div>

          <p className="citizen-hero-description">
            Execute municipal cleanup operations, update field dispatch location, and submit verified resolution evidence.
          </p>

          {/* GPS Location Widget */}
          <WorkerLocationWidget />
        </header>

        {/* Highlighted In-Progress / Active Task */}
        {activeTask && (
          <aside className="active-task-banner" aria-label="Current Active Task">
            <div className="active-task-left">
              <span className="active-task-icon" aria-hidden="true">
                {activeTask.status === 'In Progress' ? '🔄' : '👍'}
              </span>
              <div className="active-task-info">
                <h3>
                  Active Task: {activeTask.title}
                </h3>
                <p>
                  📍 {activeTask.address} &bull; Status: <strong>{activeTask.status}</strong>
                </p>
              </div>
            </div>

            <Link
              to={`/worker/reports/${activeTask.id}`}
              className="btn-resume-task"
            >
              {activeTask.status === 'In Progress' ? 'Continue Cleanup →' : 'Start Task →'}
            </Link>
          </aside>
        )}

        {/* Operational Statistics Grid */}
        <section aria-labelledby="worker-stats-heading">
          <div className="section-header">
            <h2 id="worker-stats-heading">Task Queue Overview</h2>
            <span className="section-badge section-badge-live">
              <span className="live-dot" aria-hidden="true"></span>
              Live Dispatch
            </span>
          </div>

          <div className="worker-stats-grid">
            {/* Card 1: Assigned (Pending Accept) */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Assigned</h3>
                <div className="stat-card-icon stat-icon-pending" aria-hidden="true">
                  📥
                </div>
              </div>
              <div className="stat-card-value">
                {stats.loading ? '...' : stats.assigned}
                <span className="stat-state-badge">Pending Accept</span>
              </div>
              <p className="stat-card-description">
                Newly assigned tasks awaiting your review and acceptance
              </p>
            </article>

            {/* Card 2: Accepted (Ready to Start) */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Accepted</h3>
                <div className="stat-card-icon stat-icon-accepted" aria-hidden="true">
                  👍
                </div>
              </div>
              <div className="stat-card-value">
                {stats.loading ? '...' : stats.accepted}
                <span className="stat-state-badge">Ready</span>
              </div>
              <p className="stat-card-description">
                Accepted tasks ready for site transit and sanitation commencement
              </p>
            </article>

            {/* Card 3: In Progress */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">In Progress</h3>
                <div className="stat-card-icon stat-icon-progress" aria-hidden="true">
                  🧹
                </div>
              </div>
              <div className="stat-card-value">
                {stats.loading ? '...' : stats.inProgress}
                <span className="stat-state-badge">Active</span>
              </div>
              <p className="stat-card-description">
                Locations where cleanup work is actively being performed
              </p>
            </article>

            {/* Card 4: Resolved */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Resolved</h3>
                <div className="stat-card-icon stat-icon-completed" aria-hidden="true">
                  ✅
                </div>
              </div>
              <div className="stat-card-value">
                {stats.loading ? '...' : stats.resolved}
                <span className="stat-state-badge">Verified</span>
              </div>
              <p className="stat-card-description">
                Completed incidents verified with resolution notes and photos
              </p>
            </article>
          </div>
        </section>

        {/* Recent Tasks List */}
        <section aria-labelledby="assigned-tasks-heading">
          <div className="worker-section-header">
            <h2 id="assigned-tasks-heading">Assigned Operations Queue</h2>
            <Link to="/worker/reports" className="btn-secondary-link">
              View All Tasks ({stats.total}) &rarr;
            </Link>
          </div>

          {loadingTasks ? (
            <div className="tracking-loading-state">
              <div className="tracking-spinner" />
              <p>Loading assigned tasks...</p>
            </div>
          ) : recentTasks.length === 0 ? (
            <div className="state-box">
              <span className="state-icon" aria-hidden="true">🚛</span>
              <h3 className="state-title">No Tasks Assigned Yet</h3>
              <p className="state-desc">
                You currently have no tasks assigned to your dispatch queue. When municipal dispatch assigns public reports to you, they will appear here.
              </p>
            </div>
          ) : (
            <div className="worker-tasks-grid">
              {recentTasks.map((task) => (
                <article key={task.id} className="worker-task-card">
                  <div className="task-card-hero">
                    {task.photo_url && signedThumbnails[task.photo_url] ? (
                      <img
                        src={signedThumbnails[task.photo_url]}
                        alt={`Incident evidence for ${task.title}`}
                        className="task-photo-img"
                      />
                    ) : (
                      <div className="task-photo-placeholder">
                        <span aria-hidden="true">📸</span>
                        <span>No Photo Available</span>
                      </div>
                    )}
                  </div>

                  <div className="task-card-body">
                    <div className="task-card-header-row">
                      <h3 className="task-card-title">{task.title}</h3>
                      <ReportStatusBadge status={task.status} size="small" />
                    </div>

                    <div className="task-badges-row">
                      <span className="badge-chip">
                        🗑️ {task.garbage_type || 'General'}
                      </span>
                      <span className={`badge-chip severity-${task.severity || 'medium'}`}>
                        ⚠️ {task.severity?.toUpperCase() || 'MEDIUM'}
                      </span>
                    </div>

                    <p className="task-address-line">
                      <span aria-hidden="true">📍</span>
                      <span>{task.address || 'Location recorded'}</span>
                    </p>

                    <div className="task-card-footer">
                      <span className="task-date-text">{formatDate(task.created_at)}</span>
                      <button
                        type="button"
                        className="btn-task-action"
                        onClick={() => navigate(`/worker/reports/${task.id}`)}
                      >
                        Open Task &rarr;
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
