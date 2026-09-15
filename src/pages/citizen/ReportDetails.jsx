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
  const [supporterCount, setSupporterCount] = useState(null);
  const [isSupporting, setIsSupporting] = useState(false);
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const [supportFeedback, setSupportFeedback] = useState(null); // { type: 'success' | 'error', message: string }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const userId = user?.id;
    if (!reportId || !userId) return;

    let isMounted = true;

    async function loadReportDetails() {
      try {
        // 1. Fetch main report row respecting RLS
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
          setError(null);
        }

        // 2. Resolve incident photo signed URL if path exists
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
        } else if (isMounted) {
          setIncidentPhotoSignedUrl(null);
        }

        // 3. Resolve resolution proof photo signed URL if exists
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
        } else if (isMounted) {
          setResolutionPhotoSignedUrl(null);
        }

        // 4. If worker is assigned, fetch non-sensitive worker public profile
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

        // 5. Check if authenticated user supports this report
        try {
          const { data: supporterRecord } = await supabase
            .from('report_supporters')
            .select('id')
            .eq('report_id', reportId)
            .eq('citizen_id', userId)
            .maybeSingle();

          if (isMounted) {
            setIsSupporting(!!supporterRecord);
          }
        } catch (supCheckErr) {
          console.warn('Could not check user support status:', supCheckErr);
        }

        // 6. Fetch total supporter count when available
        try {
          const { count, error: countErr } = await supabase
            .from('report_supporters')
            .select('id', { count: 'exact', head: true })
            .eq('report_id', reportId);

          if (!countErr && typeof count === 'number' && isMounted) {
            setSupporterCount(count);
          }
        } catch (countErr) {
          console.warn('Could not fetch supporter count:', countErr);
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
  }, [reportId, user, refreshKey]);

  // Handle citizen supporting an active report via existing RPC
  const handleSupportReport = async () => {
    if (isSubmittingSupport || isSupporting || !reportId) return;

    setIsSubmittingSupport(true);
    setSupportFeedback(null);

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('support_existing_report', {
        p_report_id: reportId,
      });

      if (rpcErr) {
        console.error('support_existing_report RPC error:', rpcErr);
        setSupportFeedback({
          type: 'error',
          message: rpcErr.message || 'Failed to support report. Please try again.',
        });
      } else if (rpcRes?.success === false) {
        setSupportFeedback({
          type: 'error',
          message: rpcRes.message || 'Unable to support this report.',
        });
      } else {
        setIsSupporting(true);
        if (typeof rpcRes?.supporters_count === 'number') {
          setSupporterCount(rpcRes.supporters_count);
        } else {
          setSupporterCount((prev) => (prev !== null ? prev + 1 : 1));
        }
        setSupportFeedback({
          type: 'success',
          message: 'You are now supporting this incident and will receive progress updates.',
        });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Support report exception:', err);
      setSupportFeedback({
        type: 'error',
        message: 'Network error occurred while registering your support.',
      });
    } finally {
      setIsSubmittingSupport(false);
    }
  };

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
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn-form-submit state-action-btn"
                onClick={() => navigate('/citizen/reports')}
              >
                &larr; Back to My Reports
              </button>
              <button
                type="button"
                className="btn-form-cancel state-action-btn"
                onClick={() => navigate('/citizen')}
              >
                Dashboard
              </button>
            </div>
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
  const isActive = !['Resolved', 'Cancelled'].includes(report.status);
  const isCreator = report.citizen_id === user?.id;

  return (
    <div className="citizen-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Header with navigation actions */}
        <header className="report-details-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
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

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => navigate('/citizen/reports')}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
              >
                &larr; All Reports
              </button>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => navigate('/citizen')}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
              >
                Dashboard
              </button>
            </div>
          </div>

          <div className="report-details-title-row">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                <span className="report-card-ref-badge" title={`Report Reference ID: ${report.id}`}>
                  #{report.id.slice(0, 8)}
                </span>
                <span className="tag-garbage-type">
                  {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                </span>
                <span className={`severity-badge severity-${report.severity}`}>
                  {report.severity}
                </span>
              </div>
              <h1>{report.title}</h1>
              <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
                Filed on <strong>{createdFormatted}</strong> &bull; Reference ID: <code>{report.id}</code>
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

                {resolutionPhotoSignedUrl ? (
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
                ) : (
                  <div className="state-box" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.6)' }}>
                    <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>📷</span>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)' }}>
                      {report.resolution_photo_url
                        ? 'Resolution proof photo is securely archived.'
                        : 'No post-cleanup resolution photo attached.'}
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Status Timeline History */}
            <section className="details-section-card" aria-labelledby="timeline-heading">
              <h2 id="timeline-heading">
                <span aria-hidden="true">⏱️</span> Status Progression Timeline
              </h2>
              <ReportTimeline key={refreshKey} reportId={report.id} />
            </section>
          </div>

          {/* Right Column: Community Support, Location, Dispatch & Metadata */}
          <aside className="report-details-sidebar" aria-label="Incident metadata">
            {/* Community Support Card */}
            <div className="details-section-card" aria-labelledby="support-heading">
              <h2 id="support-heading">
                <span aria-hidden="true">🤝</span> Community Support
              </h2>

              <div className="sidebar-meta-list">
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Supporters:</span>
                  <span className="sidebar-meta-value">
                    {supporterCount !== null ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#059669', fontWeight: 700 }}>
                        <span aria-hidden="true">👥</span> {supporterCount} {supporterCount === 1 ? 'Citizen' : 'Citizens'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text)' }}>Available on update</span>
                    )}
                  </span>
                </div>

                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Your Status:</span>
                  <span className="sidebar-meta-value">
                    {isCreator ? (
                      <span className="worker-badge-pill" style={{ background: 'rgba(5, 150, 105, 0.1)', color: '#059669', borderColor: 'rgba(5, 150, 105, 0.25)' }}>
                        <span aria-hidden="true">✍️</span> Submitter / Creator
                      </span>
                    ) : isSupporting ? (
                      <span className="worker-badge-pill" style={{ background: 'rgba(5, 150, 105, 0.1)', color: '#059669', borderColor: 'rgba(5, 150, 105, 0.25)' }}>
                        <span aria-hidden="true">✓</span> Supporting
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text)', fontWeight: 400 }}>Not following</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Support Action Area */}
              {!isCreator && isActive && (
                <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  {isSupporting ? (
                    <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.85rem', color: '#047857' }}>
                      <strong>✓ You are supporting this report</strong>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.775rem', lineHeight: 1.4 }}>
                        You will receive notifications when municipal workers update dispatch or resolve this incident.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.825rem', color: 'var(--text)', lineHeight: 1.45 }}>
                        Also affected by this garbage issue? Support this report to increase municipal attention and follow dispatch updates.
                      </p>
                      <button
                        type="button"
                        className="btn-form-submit"
                        onClick={handleSupportReport}
                        disabled={isSubmittingSupport}
                        style={{ width: '100%', padding: '0.65rem', fontSize: '0.875rem' }}
                      >
                        {isSubmittingSupport ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                            <span className="auth-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                            Registering support...
                          </span>
                        ) : (
                          <span>👍 Support this Report</span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Support action feedback alert */}
                  {supportFeedback && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        background: supportFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: supportFeedback.type === 'success' ? '#047857' : '#dc2626',
                        border: `1px solid ${supportFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      }}
                      role="alert"
                    >
                      {supportFeedback.message}
                    </div>
                  )}
                </div>
              )}
            </div>

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
                    {typeof report.latitude === 'number' && typeof report.longitude === 'number'
                      ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
                      : 'Unavailable'}
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
                {report.accepted_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Accepted Date:</span>
                    <span className="sidebar-meta-value">
                      {new Date(report.accepted_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {report.in_progress_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Work Started:</span>
                    <span className="sidebar-meta-value">
                      {new Date(report.in_progress_at).toLocaleDateString()}
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
