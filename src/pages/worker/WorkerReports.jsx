import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/worker.css';
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
  bulk: 'Bulk / Large Items',
  other: 'Other / Mixed Waste',
};

export default function WorkerReports() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [reports, setReports] = useState([]);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const workerId = user?.id;
    if (!workerId) return;

    let isMounted = true;

    async function loadWorkerReports() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('reports')
          .select('*')
          .eq('assigned_worker_id', workerId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching worker assigned reports:', fetchErr);
          if (isMounted) setError('Unable to load assigned reports.');
          return;
        }

        const list = data || [];
        if (isMounted) {
          setReports(list);
        }

        // Fetch signed URLs for report incident photos
        const photoPaths = list.map((r) => r.photo_url).filter(Boolean);
        if (photoPaths.length > 0 && isMounted) {
          const urlMap = {};
          await Promise.all(
            photoPaths.map(async (path) => {
              try {
                const { data: signData } = await supabase.storage
                  .from('report-photos')
                  .createSignedUrl(path, 3600);
                if (signData?.signedUrl) {
                  urlMap[path] = signData.signedUrl;
                }
              } catch (err) {
                console.warn('Could not generate signed URL for task photo:', path, err);
              }
            })
          );
          if (isMounted) setSignedPhotoUrls(urlMap);
        }
      } catch (err) {
        console.error('Exception loading worker reports:', err);
        if (isMounted) setError('Network error while retrieving assigned tasks.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadWorkerReports();

    const channel = supabase
      .channel(`worker-reports-list-${workerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `assigned_worker_id=eq.${workerId}`,
        },
        () => {
          loadWorkerReports();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [user, refreshKey]);

  // Filtering
  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'action-needed') {
      return ['Assigned', 'Accepted', 'In Progress'].includes(r.status);
    }
    if (statusFilter === 'assigned') return r.status === 'Assigned';
    if (statusFilter === 'accepted') return r.status === 'Accepted';
    if (statusFilter === 'in-progress') return r.status === 'In Progress';
    if (statusFilter === 'resolved') return r.status === 'Resolved';
    return true;
  });

  const actionNeededCount = reports.filter((r) =>
    ['Assigned', 'Accepted', 'In Progress'].includes(r.status)
  ).length;

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="worker-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <h1>Assigned Cleanup Operations</h1>
            <p>Review assigned public reports, update lifecycle status, and verify completed sanitation</p>
          </div>
        </header>

        {/* Filter Navigation */}
        <nav className="worker-filter-bar" aria-label="Task Status Filters">
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All Tasks ({reports.length})
          </button>
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'action-needed' ? 'active' : ''}`}
            onClick={() => setStatusFilter('action-needed')}
          >
            ⚠️ Action Needed ({actionNeededCount})
          </button>
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'assigned' ? 'active' : ''}`}
            onClick={() => setStatusFilter('assigned')}
          >
            📥 Assigned ({reports.filter((r) => r.status === 'Assigned').length})
          </button>
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'accepted' ? 'active' : ''}`}
            onClick={() => setStatusFilter('accepted')}
          >
            👍 Accepted ({reports.filter((r) => r.status === 'Accepted').length})
          </button>
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'in-progress' ? 'active' : ''}`}
            onClick={() => setStatusFilter('in-progress')}
          >
            🧹 In Progress ({reports.filter((r) => r.status === 'In Progress').length})
          </button>
          <button
            type="button"
            className={`worker-filter-btn ${statusFilter === 'resolved' ? 'active' : ''}`}
            onClick={() => setStatusFilter('resolved')}
          >
            ✅ Resolved ({reports.filter((r) => r.status === 'Resolved').length})
          </button>
        </nav>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading assigned tasks...</p>
            <p className="state-desc">Connecting to municipal dispatch database.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Assigned Reports</p>
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

        {/* Empty State */}
        {!loading && !error && filteredReports.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">📋</span>
            <h2 className="state-title">No Tasks Found</h2>
            <p className="state-desc">
              {statusFilter === 'all'
                ? 'You currently have no tasks assigned to your dispatch queue.'
                : `No tasks match the '${statusFilter}' filter criteria.`}
            </p>
          </div>
        )}

        {/* Tasks Grid */}
        {!loading && !error && filteredReports.length > 0 && (
          <div className="worker-tasks-grid">
            {filteredReports.map((task) => (
              <article key={task.id} className="worker-task-card">
                <div className="task-card-hero">
                  {task.photo_url && signedPhotoUrls[task.photo_url] ? (
                    <img
                      src={signedPhotoUrls[task.photo_url]}
                      alt={`Incident site: ${task.title}`}
                      className="task-photo-img"
                    />
                  ) : (
                    <div className="task-photo-placeholder">
                      <span aria-hidden="true">📸</span>
                      <span>No Incident Photo</span>
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
                      🗑️ {GARBAGE_TYPE_LABELS[task.garbage_type] || task.garbage_type}
                    </span>
                    <span className={`badge-chip severity-${task.severity || 'medium'}`}>
                      ⚠️ {task.severity?.toUpperCase() || 'MEDIUM'}
                    </span>
                  </div>

                  <p className="task-address-line">
                    <span aria-hidden="true">📍</span>
                    <span>{task.address || 'Coordinates recorded'}</span>
                  </p>

                  <div className="task-card-footer">
                    <span className="task-date-text">Reported {formatDate(task.created_at)}</span>
                    <button
                      type="button"
                      className="btn-task-action"
                      onClick={() => navigate(`/worker/reports/${task.id}`)}
                    >
                      View & Manage &rarr;
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
