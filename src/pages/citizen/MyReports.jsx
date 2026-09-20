import { useState, useEffect, useMemo } from 'react';
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

const GARBAGE_TYPE_ICONS = {
  plastic: '🥤',
  glass: '🍾',
  can: '🥫',
  trash: '🗑️',
  general: '🗑️',
  organic: '🍏',
  hazardous: '☣️',
  electronic: '💻',
  construction: '🧱',
  bulk: '🛋️',
  household: '🏠',
  commercial: '🏢',
  other: '📦',
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All Reports' },
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
  const [searchQuery, setSearchQuery] = useState('');
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

  // Compute status summary metrics
  const metrics = useMemo(() => {
    const total = reports.length;
    const active = reports.filter((r) =>
      ['Reported', 'Assigned', 'Accepted', 'In Progress'].includes(r.status)
    ).length;
    const resolved = reports.filter((r) => r.status === 'Resolved').length;
    const cancelled = reports.filter((r) => r.status === 'Cancelled').length;
    return { total, active, resolved, cancelled };
  }, [reports]);

  // Compute counts for each status filter tab
  const filterCounts = useMemo(() => {
    return STATUS_FILTERS.reduce((acc, f) => {
      if (f.key === 'all') {
        acc[f.key] = reports.length;
      } else {
        acc[f.key] = reports.filter((r) => r.status === f.key).length;
      }
      return acc;
    }, {});
  }, [reports]);

  // Filtered reports by status tab & search query
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      if (!matchesStatus) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const titleMatch = r.title?.toLowerCase().includes(q);
      const addressMatch = r.address?.toLowerCase().includes(q);
      const typeMatch = (GARBAGE_TYPE_LABELS[r.garbage_type] || r.garbage_type)?.toLowerCase().includes(q);
      return Boolean(titleMatch || addressMatch || typeMatch);
    });
  }, [reports, statusFilter, searchQuery]);

  return (
    <div className="citizen-layout">
      {/* Universal CleanAlert header */}
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Navigation Breadcrumb / Operational Bar */}
        <div className="tracking-nav-bar">
          <Link to="/citizen" className="btn-tracking-back">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Dashboard</span>
          </Link>

          <div className="tracking-header-meta">
            <span className="tracking-meta-pill">
              <span className="tracking-meta-dot" aria-hidden="true" />
              Live Incident Tracking Active
            </span>
          </div>
        </div>

        {/* CleanAlert Base44 Page Header */}
        <header className="tracking-header-card">
          <div className="tracking-header-content">
            <div className="tracking-eyebrow-wrapper">
              <span className="tracking-eyebrow">MY REPORTS</span>
            </div>
            <h1 className="tracking-title">My Reports</h1>
            <p className="tracking-subtitle">
              Track the reports you&apos;ve submitted and follow their cleanup progress.
            </p>
          </div>

          <div className="tracking-header-actions">
            <button
              type="button"
              className="btn-new-report"
              onClick={() => navigate('/citizen/report')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Report Garbage</span>
            </button>
          </div>
        </header>

        {/* Summary Metrics Cards */}
        <section className="reports-summary-metrics" aria-label="Incident summary statistics">
          <div className="metric-pill-card">
            <div className="metric-icon-tile total">📋</div>
            <div className="metric-data">
              <span className="metric-count">{metrics.total}</span>
              <span className="metric-label">Total Filed</span>
            </div>
          </div>
          <div className="metric-pill-card">
            <div className="metric-icon-tile active">⚡</div>
            <div className="metric-data">
              <span className="metric-count">{metrics.active}</span>
              <span className="metric-label">Active / In Progress</span>
            </div>
          </div>
          <div className="metric-pill-card">
            <div className="metric-icon-tile resolved">✅</div>
            <div className="metric-data">
              <span className="metric-count">{metrics.resolved}</span>
              <span className="metric-label">Resolved</span>
            </div>
          </div>
          <div className="metric-pill-card">
            <div className="metric-icon-tile cancelled">✕</div>
            <div className="metric-data">
              <span className="metric-count">{metrics.cancelled}</span>
              <span className="metric-label">Cancelled</span>
            </div>
          </div>
        </section>

        {/* Search & Filter Toolbar */}
        <section className="reports-filter-section" aria-label="Report filters">
          {/* Segmented Status Tabs */}
          <div className="filter-segmented-bar" role="tablist" aria-label="Filter reports by status">
            {STATUS_FILTERS.map((f) => {
              const count = filterCounts[f.key] || 0;
              const isActive = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  className={`filter-segment-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setStatusFilter(f.key)}
                  aria-selected={isActive}
                >
                  <span>{f.label}</span>
                  <span className="filter-count-badge">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search Box */}
          <div className="filter-search-box">
            <svg
              className="search-box-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="search-input"
              placeholder="Search by title, category, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search my reports"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-card-box" aria-live="polite">
            <div className="clean-spinner" />
            <h2 className="state-card-title">Loading your reports...</h2>
            <p className="state-card-desc">Fetching incident data from municipal dispatch.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-card-box error" role="alert">
            <div className="state-card-icon error-icon" aria-hidden="true">⚠️</div>
            <h2 className="state-card-title">Error Loading Reports</h2>
            <p className="state-card-desc">{error}</p>
            <button
              type="button"
              className="btn-retry-action"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State: No reports at all */}
        {!loading && !error && reports.length === 0 && (
          <div className="state-card-box">
            <div className="state-card-icon" aria-hidden="true">📋</div>
            <h2 className="state-card-title">No Incident Reports Filed Yet</h2>
            <p className="state-card-desc">
              When you report uncollected waste or illegal dumping, your incidents and live cleanup milestones will appear here.
            </p>
            <button
              type="button"
              className="btn-state-cta"
              onClick={() => navigate('/citizen/report')}
            >
              <span>Report Garbage</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        )}

        {/* Filtered Empty State */}
        {!loading && !error && reports.length > 0 && filteredReports.length === 0 && (
          <div className="state-card-box">
            <div className="state-card-icon" aria-hidden="true">🔍</div>
            <h2 className="state-card-title">No matching reports found</h2>
            <p className="state-card-desc">
              No reports match your current filter selection &ldquo;{statusFilter}&rdquo;
              {searchQuery ? ` and search &ldquo;${searchQuery}&rdquo;` : ''}.
            </p>
            <div className="state-actions-cluster">
              <button
                type="button"
                className="btn-clear-filters"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
              >
                Reset Filters
              </button>
            </div>
          </div>
        )}

        {/* Reports Cards Feed */}
        {!loading && !error && filteredReports.length > 0 && (
          <div className="reports-listing-grid" role="feed" aria-label="Incident reports feed">
            {filteredReports.map((report) => {
              const createdDate = new Date(report.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });

              const photoSignedUrl = report.photo_url ? signedPhotoUrls[report.photo_url] : null;
              const typeIcon = GARBAGE_TYPE_ICONS[report.garbage_type] || '📦';
              const typeLabel = GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type;

              return (
                <article
                  key={report.id}
                  className="report-item-card"
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
                  <div className="report-item-media">
                    {photoSignedUrl ? (
                      <img
                        src={photoSignedUrl}
                        alt={`Photo of ${report.title}`}
                        className="report-item-thumb"
                        loading="lazy"
                      />
                    ) : (
                      <div className="report-thumb-placeholder">
                        <span className="placeholder-icon" aria-hidden="true">
                          {typeIcon}
                        </span>
                        <span className="placeholder-label">
                          {report.photo_url ? 'Loading photo...' : 'No photo attached'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card Details */}
                  <div className="report-item-body">
                    <div className="report-item-top-row">
                      <div className="report-badges-group">
                        <span className="report-ref-chip" title={`Report Reference: ${report.id}`}>
                          #{report.id.slice(0, 8)}
                        </span>
                        <span className="report-type-chip">
                          <span aria-hidden="true">{typeIcon}</span> {typeLabel}
                        </span>
                        <span className={`severity-chip severity-${report.severity}`}>
                          {report.severity}
                        </span>
                      </div>
                      <ReportStatusBadge status={report.status} size="small" />
                    </div>

                    <h2 className="report-item-title">{report.title}</h2>

                    {report.address && (
                      <p className="report-item-address" title={report.address}>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          className="address-icon"
                        >
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span>{report.address}</span>
                      </p>
                    )}

                    <div className="report-item-footer">
                      <time className="report-item-date" dateTime={report.created_at}>
                        Filed on {createdDate}
                      </time>
                      <span className="report-item-cta">
                        <span>View Details</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
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
