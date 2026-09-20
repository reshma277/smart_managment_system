import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
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

export default function WorkerReports() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
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
          .select('id, title, description, status, severity, garbage_type, address, photo_url, created_at, updated_at')
          .eq('assigned_worker_id', workerId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching worker assigned reports:', fetchErr);
          if (isMounted) setError('Unable to load assigned reports.');
          return;
        }

        if (isMounted) {
          setReports(data || []);
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

  // Filtering logic
  const filteredReports = reports.filter((r) => {
    // Status filter
    if (statusFilter === 'action-needed') {
      if (!['Assigned', 'Accepted', 'In Progress'].includes(r.status)) return false;
    } else if (statusFilter === 'assigned') {
      if (r.status !== 'Assigned') return false;
    } else if (statusFilter === 'accepted') {
      if (r.status !== 'Accepted') return false;
    } else if (statusFilter === 'in-progress') {
      if (r.status !== 'In Progress') return false;
    } else if (statusFilter === 'resolved') {
      if (r.status !== 'Resolved') return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (r.title || '').toLowerCase().includes(q);
      const matchAddress = (r.address || '').toLowerCase().includes(q);
      const matchId = (r.id || '').toLowerCase().includes(q);
      const matchType = (r.garbage_type || '').toLowerCase().includes(q);
      if (!matchTitle && !matchAddress && !matchId && !matchType) return false;
    }

    return true;
  });

  const actionNeededCount = reports.filter((r) =>
    ['Assigned', 'Accepted', 'In Progress'].includes(r.status)
  ).length;
  const inProgressCount = reports.filter((r) => r.status === 'In Progress').length;
  const resolvedCount = reports.filter((r) => r.status === 'Resolved').length;

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
        {/* Simplified Header */}
        <header className="worker-reports-header">
          <div className="worker-reports-header-text">
            <h1>Assigned Reports</h1>
            <p>Field tasks assigned to your municipal cleanup queue</p>
          </div>

          <div className="worker-count-pill">
            <span>{reports.length} Total</span>
            <span>&bull;</span>
            <span style={{ color: actionNeededCount > 0 ? '#b45309' : '#16A34A' }}>
              {actionNeededCount} Action Needed
            </span>
          </div>
        </header>

        {/* Compact Search & Filter Toolbar */}
        <section className="worker-compact-toolbar" aria-label="Task Search and Filters">
          <div className="worker-search-input-wrap">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              type="text"
              className="worker-clean-search"
              placeholder="Search by title, location, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search assigned tasks"
            />
            {searchQuery && (
              <button
                type="button"
                className="worker-clear-search-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="worker-segmented-tabs" role="tablist" aria-label="Task Status Filters">
            <button
              type="button"
              className={`worker-tab-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({reports.length})
            </button>
            <button
              type="button"
              className={`worker-tab-btn ${statusFilter === 'action-needed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('action-needed')}
            >
              ⚡ Action Needed ({actionNeededCount})
            </button>
            <button
              type="button"
              className={`worker-tab-btn ${statusFilter === 'in-progress' ? 'active' : ''}`}
              onClick={() => setStatusFilter('in-progress')}
            >
              🧹 In Progress ({inProgressCount})
            </button>
            <button
              type="button"
              className={`worker-tab-btn ${statusFilter === 'resolved' ? 'active' : ''}`}
              onClick={() => setStatusFilter('resolved')}
            >
              ✅ Resolved ({resolvedCount})
            </button>
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading assigned reports...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h2 className="state-title">Unable to Load Reports</h2>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-worker-link"
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
            <h2 className="state-title">No Reports Found</h2>
            <p className="state-desc">
              {reports.length === 0
                ? 'You currently have no tasks assigned to your dispatch queue.'
                : 'No reports match your current filter or search.'}
            </p>
            {(statusFilter !== 'all' || searchQuery) && (
              <button
                type="button"
                className="btn-worker-link"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Simplified Cards List */}
        {!loading && !error && filteredReports.length > 0 && (
          <div className="worker-task-list-simple">
            {filteredReports.map((task) => (
              <article key={task.id} className="worker-task-card-simple">
                {/* 1. Top row: Severity on left, #ID on right */}
                <div className="task-card-top-row">
                  <span className={`severity-tag severity-${(task.severity || 'medium').toLowerCase()}`}>
                    {task.severity?.toUpperCase() || 'MEDIUM'}
                  </span>
                  <span className="task-short-id">#{task.id.slice(0, 6)}</span>
                </div>

                {/* 2. Report title */}
                <h2 className="task-simple-title">{task.title}</h2>

                {/* 3. Location */}
                <p className="task-simple-location">
                  <span aria-hidden="true">📍</span>
                  <span>{task.address || 'Location recorded'}</span>
                </p>

                {/* 4. Category & Date */}
                <div className="task-simple-meta">
                  <span>{GARBAGE_TYPE_LABELS[task.garbage_type] || task.garbage_type || 'General Waste'}</span>
                  <span className="meta-sep">&bull;</span>
                  <span>{formatDate(task.created_at)}</span>
                </div>

                {/* 5. Status & Action Button */}
                <div className="task-simple-footer">
                  <ReportStatusBadge status={task.status} size="small" />
                  <button
                    type="button"
                    className="btn-view-task"
                    onClick={() => navigate(`/worker/reports/${task.id}`)}
                  >
                    View Task &rarr;
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
