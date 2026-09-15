import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Reported', label: 'Reported' },
  { key: 'Assigned', label: 'Assigned' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'In Progress', label: 'In Progress' },
  { key: 'Resolved', label: 'Resolved' },
  { key: 'Cancelled', label: 'Cancelled' },
];

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
        if (isMounted) {
          setReports(list);
          setError(null);
        }

        // Resolve signed URLs for photos in report-photos private bucket
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

    // Realtime subscription for citizen's own reports
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

  // Compute counts for each status filter
  const filterCounts = STATUS_FILTERS.reduce((acc, f) => {
    if (f.key === 'all') {
      acc[f.key] = reports.length;
    } else {
      acc[f.key] = reports.filter((r) => r.status === f.key).length;
    }
    return acc;
  }, {});

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  return (
    <div className="citizen-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Page Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <nav className="details-breadcrumb-nav" aria-label="Breadcrumb" style={{ marginBottom: '0.5rem' }}>
              <Link to="/citizen" className="btn-back-crumb">
                &larr; Dashboard
              </Link>
            </nav>
            <h1>My Incident Reports</h1>
            <p>
              Track all municipal waste incidents submitted from your account. Monitor dispatch, view cleanup progress, and review resolution evidence.
            </p>
          </div>

          <div className="tracking-actions-bar">
            <Link
              to="/citizen"
              className="btn-form-cancel"
              style={{ padding: '0.65rem 1.1rem', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <span>Dashboard</span>
            </Link>
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
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                className={`filter-pill-btn ${statusFilter === f.key ? 'active' : ''}`}
                onClick={() => setStatusFilter(f.key)}
                aria-selected={statusFilter === f.key}
              >
                {f.label} <span className="filter-pill-count">{filterCounts[f.key] || 0}</span>
              </button>
            ))}
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

        {/* Empty State: No reports at all */}
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
            <p className="state-desc">Try selecting &ldquo;All&rdquo; to view all your submissions.</p>
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
                      <span className="report-card-ref-badge" title={`Report Reference: ${report.id}`}>
                        #{report.id.slice(0, 8)}
                      </span>
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
