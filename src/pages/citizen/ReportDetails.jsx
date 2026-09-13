import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import ReportTimeline from '../../components/citizen/ReportTimeline';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen-tracking.css';

const GARBAGE_TYPE_LABELS = {
  general: 'General Waste',
  household: 'Household Waste',
  commercial: 'Commercial Waste',
  construction: 'Construction / Debris',
  organic: 'Organic / Food Waste',
  plastic: 'Plastic / Recyclable Packaging',
  electronic: 'Electronic Waste (E-waste)',
  hazardous: 'Hazardous / Chemical / Biohazard',
  other: 'Other / Mixed Waste',
};

const SEVERITY_DESCRIPTIONS = {
  low: 'Low — Minor litter / non-blocking accumulation',
  medium: 'Medium — Noticeable pile / potential nuisance',
  high: 'High — Significant blockage / offensive odor',
  critical: 'Critical — Roadway obstruction / urgent health hazard',
};

export default function ReportDetails() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [report, setReport] = useState(null);
  const [assignedWorker, setAssignedWorker] = useState(null);
  const [incidentPhotoSignedUrl, setIncidentPhotoSignedUrl] = useState(null);
  const [resolutionPhotoSignedUrl, setResolutionPhotoSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!reportId || !user?.id) return;

    let isMounted = true;

    async function loadReportDetails() {
      try {
        const { data, error: reportErr } = await supabase
          .from('reports')
          .select('*')
          .eq('id', reportId)
          .maybeSingle();

        if (reportErr) {
          console.error('Error fetching report details:', reportErr);
          if (isMounted) setError('Unable to load report information.');
          return;
        }

        if (!data) {
          if (isMounted) setError('Report not found or you do not have permission to view it.');
          return;
        }

        if (isMounted) {
          setReport(data);
        }

        // 1. Resolve incident photo signed URL if path exists
        if (data.photo_url) {
          try {
            const { data: signData, error: signErr } = await supabase.storage
              .from('report-photos')
              .createSignedUrl(data.photo_url, 3600);

            if (!signErr && signData?.signedUrl && isMounted) {
              setIncidentPhotoSignedUrl(signData.signedUrl);
            }
          } catch (err) {
            console.warn('Incident photo signed URL generation failed:', err);
          }
        }

        // 2. Resolve resolution proof photo signed URL if exists
        if (data.resolution_photo_url) {
          try {
            const { data: resSignData, error: resSignErr } = await supabase.storage
              .from('resolution-photos')
              .createSignedUrl(data.resolution_photo_url, 3600);

            if (!resSignErr && resSignData?.signedUrl && isMounted) {
              setResolutionPhotoSignedUrl(resSignData.signedUrl);
            }
          } catch (err) {
            console.warn('Resolution photo signed URL generation failed:', err);
          }
        }

        // 3. If worker is assigned, fetch non-sensitive worker public profile
        if (data.assigned_worker_id) {
          try {
            const { data: workerData } = await supabase
              .from('public_profiles')
              .select('id, full_name, avatar_url, role')
              .eq('id', data.assigned_worker_id)
              .maybeSingle();

            if (workerData && isMounted) {
              setAssignedWorker(workerData);
            }
          } catch (workerErr) {
            console.warn('Could not fetch worker public profile:', workerErr);
          }
        } else if (isMounted) {
          setAssignedWorker(null);
        }
      } catch (err) {
        console.error('Report details exception:', err);
        if (isMounted) setError('Network error while retrieving report details.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadReportDetails();

    // Realtime subscription for updates to this specific report
    const reportChannel = supabase
      .channel(`report-detail-${reportId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports',
          filter: `id=eq.${reportId}`,
        },
        () => {
          loadReportDetails();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(reportChannel);
    };
  }, [reportId, user]);

  if (loading) {
    return (
      <div className="citizen-layout">
        <UserNavbar />
        <main className="tracking-container" role="main">
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading incident report details...</p>
            <p className="state-desc">Retrieving municipal milestones and dispatch status.</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="citizen-layout">
        <UserNavbar />
        <main className="tracking-container" role="main">
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h1 className="state-title">Report Unavailable</h1>
            <p className="state-desc">{error || 'The requested incident report was not found.'}</p>
            <button
              type="button"
              className="btn-form-submit state-action-btn"
              onClick={() => navigate('/citizen/reports')}
            >
              &larr; Back to My Reports
            </button>
          </div>
        </main>
      </div>
    );
  }

  const createdFormatted = new Date(report.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isResolved = report.status === 'Resolved';

  return (
    <div className="citizen-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Header with breadcrumb navigation */}
        <header className="report-details-header">
          <nav className="details-breadcrumb-nav" aria-label="Breadcrumb">
            <Link to="/citizen" className="btn-back-crumb">
              Dashboard
            </Link>
            <span aria-hidden="true">/</span>
            <Link to="/citizen/reports" className="btn-back-crumb">
              My Reports
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Incident #{report.id.slice(0, 8)}</span>
          </nav>

          <div className="report-details-title-row">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                <span className="tag-garbage-type">
                  {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                </span>
                <span className={`severity-badge severity-${report.severity}`}>
                  {report.severity}
                </span>
              </div>
              <h1>{report.title}</h1>
              <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
                Filed on <strong>{createdFormatted}</strong> • Reference ID: <code>{report.id}</code>
              </p>
            </div>

            <ReportStatusBadge status={report.status} size="large" />
          </div>
        </header>

        {/* Two-Column Details Layout */}
        <div className="report-details-layout-grid">
          {/* Left Column: Description, Photos, Resolution & Timeline */}
          <div className="report-details-main">
            {/* Description Section */}
            <section className="details-section-card" aria-labelledby="desc-heading">
              <h2 id="desc-heading">
                <span aria-hidden="true">📋</span> Incident Description
              </h2>
              <p className="details-description-text">
                {report.description || 'No detailed description provided.'}
              </p>
            </section>

            {/* Incident Photo Evidence Section */}
            <section className="details-section-card" aria-labelledby="photos-heading">
              <h2 id="photos-heading">
                <span aria-hidden="true">📷</span> Incident Photo Evidence
              </h2>

              {incidentPhotoSignedUrl ? (
                <div className="details-photo-box">
                  <img
                    src={incidentPhotoSignedUrl}
                    alt={`Incident evidence for ${report.title}`}
                    loading="lazy"
                  />
                  <div className="details-photo-caption">
                    <span>Incident photo captured at submission</span>
                    <a
                      href={incidentPhotoSignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="report-card-link-text"
                    >
                      Open Full Size &rarr;
                    </a>
                  </div>
                </div>
              ) : (
                <div className="state-box" style={{ padding: '2rem 1rem' }}>
                  <span aria-hidden="true" style={{ fontSize: '1.75rem' }}>🖼️</span>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
                    {report.photo_url
                      ? 'Photo stored securely in municipal archive (signed link expired or loading).'
                      : 'No photo evidence was attached to this report.'}
                  </p>
                </div>
              )}
            </section>

            {/* Resolution Section (Visible when report is resolved) */}
            {isResolved && (
              <section className="resolution-proof-card" aria-labelledby="resolution-heading">
                <h3 id="resolution-heading">
                  <span aria-hidden="true">✅</span> Cleanup Resolution Verified
                </h3>

                <p className="resolution-notes-content">
                  {report.resolution_notes || 'Cleanup completed and certified by municipal sanitation workers.'}
                </p>

                {report.resolved_at && (
                  <p style={{ fontSize: '0.825rem', color: '#047857', marginBottom: '1rem' }}>
                    Resolved at: {new Date(report.resolved_at).toLocaleString()}
                  </p>
                )}

                {resolutionPhotoSignedUrl && (
                  <div className="details-photo-box" style={{ marginTop: '0.5rem' }}>
                    <img
                      src={resolutionPhotoSignedUrl}
                      alt="Resolution verification photo after cleanup"
                      loading="lazy"
                    />
                    <div className="details-photo-caption">
                      <span>Worker post-cleanup proof photo</span>
                      <a
                        href={resolutionPhotoSignedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="report-card-link-text"
                      >
                        View Full Resolution Proof &rarr;
                      </a>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Status Timeline History */}
            <section className="details-section-card" aria-labelledby="timeline-heading">
              <h2 id="timeline-heading">
                <span aria-hidden="true">⏱️</span> Status Progression Timeline
              </h2>
              <ReportTimeline reportId={report.id} />
            </section>
          </div>

          {/* Right Column: Location, Worker Assignment & Metadata */}
          <aside className="report-details-sidebar" aria-label="Incident metadata">
            {/* Location Card */}
            <div className="details-section-card">
              <h2>
                <span aria-hidden="true">📍</span> Location Details
              </h2>
              <div className="sidebar-meta-list">
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Address:</span>
                  <span className="sidebar-meta-value" style={{ maxWidth: '180px' }}>
                    {report.address || 'GPS Coordinates Provided'}
                  </span>
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Coordinates:</span>
                  <span className="sidebar-meta-value">
                    {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                  </span>
                </div>
              </div>
            </div>

            {/* Assignment Card */}
            <div className="details-section-card">
              <h2>
                <span aria-hidden="true">👷</span> Municipal Dispatch
              </h2>
              <div className="sidebar-meta-list">
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Status:</span>
                  <ReportStatusBadge status={report.status} size="small" />
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Assigned Worker:</span>
                  <span className="sidebar-meta-value">
                    {assignedWorker ? (
                      <span className="worker-badge-pill">
                        <span aria-hidden="true">👤</span> {assignedWorker.full_name}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text)', fontWeight: 400 }}>
                        Pending Dispatch
                      </span>
                    )}
                  </span>
                </div>
                {report.assigned_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Assigned Date:</span>
                    <span className="sidebar-meta-value">
                      {new Date(report.assigned_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Waste Classification */}
            <div className="details-section-card">
              <h2>
                <span aria-hidden="true">🏷️</span> Classification
              </h2>
              <div className="sidebar-meta-list">
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Waste Category:</span>
                  <span className="sidebar-meta-value">
                    {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                  </span>
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Severity Assessment:</span>
                  <span className="sidebar-meta-value">
                    <span className={`severity-badge severity-${report.severity}`}>
                      {report.severity}
                    </span>
                  </span>
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.775rem', color: 'var(--text)', lineHeight: 1.4 }}>
                  {SEVERITY_DESCRIPTIONS[report.severity] || ''}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
