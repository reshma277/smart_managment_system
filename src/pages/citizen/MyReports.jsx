import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
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

export default function MyReports() {
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
    const citizenId = user?.id;
    if (!citizenId) return;

    let isMounted = true;

    async function loadReports() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('reports')
          .select('*')
          .eq('citizen_id', citizenId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching citizen reports:', fetchErr);
          if (isMounted) setError('Unable to load your filed reports. Please try again.');
          return;
        }

        const list = data || [];
        if (isMounted) setReports(list);

        // Resolve signed URLs for photos in report-photos bucket
        const photoPaths = list
          .map((r) => r.photo_url)
          .filter(Boolean);

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
                console.warn('Could not generate signed URL for:', path, err);
              }
            })
          );
          if (isMounted) setSignedPhotoUrls(urlMap);
        }
      } catch (err) {
        console.error('Fetch reports exception:', err);
        if (isMounted) setError('Network error while retrieving reports.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadReports();

    // Realtime subscription for citizen's reports
    const reportsChannel = supabase
      .channel(`citizen-reports-${citizenId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `citizen_id=eq.${citizenId}`,
        },
        () => {
          loadReports();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportsChannel);
    };
  }, [user, refreshKey]);

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') {
      return ['Reported', 'Assigned', 'Accepted', 'In Progress'].includes(r.status);
    }
    if (statusFilter === 'resolved') {
      return r.status === 'Resolved';
    }
    if (statusFilter === 'cancelled') {
      return r.status === 'Cancelled';
    }
    return true;
  });

  const activeCount = reports.filter((r) =>
    ['Reported', 'Assigned', 'Accepted', 'In Progress'].includes(r.status)
  ).length;
  const resolvedCount = reports.filter((r) => r.status === 'Resolved').length;

  return (
    <div className="citizen-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Page Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <h1>My Incident Reports</h1>
            <p>
              Track all municipal waste incidents submitted from your account. Monitor dispatch, view cleanup progress, and review resolution evidence.
            </p>
          </div>

          <div className="tracking-actions-bar">
            <button
              type="button"
              className="btn-form-submit"
              onClick={() => navigate('/citizen/report')}
              style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem' }}
            >
              <span aria-hidden="true">📢</span> Report Garbage
            </button>
          </div>
        </header>

        {/* Filter Navigation Tabs */}
        <div className="tracking-filter-bar">
          <div className="filter-pills" role="tablist" aria-label="Filter reports by status">
            <button
              type="button"
              role="tab"
              className={`filter-pill-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
              aria-selected={statusFilter === 'all'}
            >
              All Reports <span className="filter-pill-count">{reports.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`filter-pill-btn ${statusFilter === 'active' ? 'active' : ''}`}
              onClick={() => setStatusFilter('active')}
              aria-selected={statusFilter === 'active'}
            >
              Active Cleanups <span className="filter-pill-count">{activeCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`filter-pill-btn ${statusFilter === 'resolved' ? 'active' : ''}`}
              onClick={() => setStatusFilter('resolved')}
              aria-selected={statusFilter === 'resolved'}
            >
              Resolved <span className="filter-pill-count">{resolvedCount}</span>
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading your reports...</p>
            <p className="state-desc">Fetching incident data from municipal dispatch.</p>
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

        {/* Empty State */}
        {!loading && !error && reports.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">📋</span>
            <h2 className="state-title">No Incident Reports Filed Yet</h2>
            <p className="state-desc">
              When you report uncollected waste or illegal dumping, your incidents and live tracking milestones will appear here.
            </p>
            <button
              type="button"
              className="btn-form-submit state-action-btn"
              onClick={() => navigate('/citizen/report')}
            >
              File Your First Report &rarr;
            </button>
          </div>
        )}

        {/* Filtered Empty State */}
        {!loading && !error && reports.length > 0 && filteredReports.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔍</span>
            <p className="state-title">No reports match &ldquo;{statusFilter}&rdquo;</p>
            <p className="state-desc">Try selecting &ldquo;All Reports&rdquo; to view all your submissions.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => setStatusFilter('all')}
            >
              Show All Reports
            </button>
          </div>
        )}

        {/* Reports Grid */}
        {!loading && !error && filteredReports.length > 0 && (
          <div className="reports-grid" role="feed" aria-label="Incident reports feed">
            {filteredReports.map((report) => {
              const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });

              const photoSignedUrl = report.photo_url ? signedPhotoUrls[report.photo_url] : null;

              return (
                <article
                  key={report.id}
                  className="report-card"
                  onClick={() => navigate(`/citizen/reports/${report.id}`)}
                  tabIndex={0}
                  role="article"
                  aria-label={`Report: ${report.title}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/citizen/reports/${report.id}`);
                    }
                  }}
                >
                  {/* Photo thumbnail */}
                  <div className="report-card-media">
                    {photoSignedUrl ? (
                      <img
                        src={photoSignedUrl}
                        alt={`Photo of ${report.title}`}
                        className="report-card-thumb"
                        loading="lazy"
                      />
                    ) : (
                      <div className="report-media-placeholder">
                        <span style={{ fontSize: '1.75rem' }} aria-hidden="true">🖼️</span>
                        <span>{report.photo_url ? 'Loading secure photo...' : 'No photo attached'}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Content */}
                  <div className="report-card-content">
                    <div className="report-card-header-row">
                      <h2 className="report-card-title">{report.title}</h2>
                      <ReportStatusBadge status={report.status} size="small" />
                    </div>

                    <div className="report-card-meta-tags">
                      <span className="tag-garbage-type">
                        {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                      </span>
                      <span className={`severity-badge severity-${report.severity}`}>
                        {report.severity}
                      </span>
                    </div>

                    {report.address && (
                      <p className="report-card-address" title={report.address}>
                        <span aria-hidden="true">📍</span>
                        <span>{report.address}</span>
                      </p>
                    )}

                    <div className="report-card-footer">
                      <time dateTime={report.created_at}>Filed on {createdDate}</time>
                      <span className="report-card-link-text">
                        View Details &rarr;
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
