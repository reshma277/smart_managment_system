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

const SEVERITY_DESCRIPTIONS = {
  low: 'Low — Minor litter or non-blocking accumulation',
  medium: 'Medium — Noticeable pile or potential neighborhood nuisance',
  high: 'High — Significant blockage, overflow, or offensive odor',
  critical: 'Critical — Roadway obstruction, toxic spill, or urgent health hazard',
};

const LIFECYCLE_STEPS = [
  { key: 'Reported', label: 'Reported', field: 'created_at', icon: '📝' },
  { key: 'Assigned', label: 'Assigned', field: 'assigned_at', icon: '👷' },
  { key: 'Accepted', label: 'Accepted', field: 'accepted_at', icon: '👍' },
  { key: 'In Progress', label: 'In Progress', field: 'in_progress_at', icon: '🧹' },
  { key: 'Resolved', label: 'Resolved', field: 'resolved_at', icon: '✅' },
];

export default function ReportDetails() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();

  const [report, setReport] = useState(null);
  const [assignedWorker, setAssignedWorker] = useState(null);
  const [reportingCitizen, setReportingCitizen] = useState(null);
  const [incidentPhotoSignedUrl, setIncidentPhotoSignedUrl] = useState(null);
  const [resolutionPhotoSignedUrl, setResolutionPhotoSignedUrl] = useState(null);
  const [supporterCount, setSupporterCount] = useState(null);
  const [isSupporting, setIsSupporting] = useState(false);
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);
  const [supportFeedback, setSupportFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Admin worker assignment state
  const [availableWorkers, setAvailableWorkers] = useState([]);
  const [adminSelectedWorkerId, setAdminSelectedWorkerId] = useState('');
  const [adminAssignNotes, setAdminAssignNotes] = useState('');
  const [isAdminAssigning, setIsAdminAssigning] = useState(false);
  const [adminAssignFeedback, setAdminAssignFeedback] = useState(null);

  const isAdmin = role === 'admin';
  const dashboardRoute = isAdmin ? '/admin' : '/citizen';
  const reportsListRoute = isAdmin ? '/admin/reports' : '/citizen/reports';

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

        // 4. If worker is assigned, fetch worker profile
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

        // 5. Look up reporting citizen if citizen_id present
        if (data.citizen_id) {
          try {
            const { data: citizenData } = await supabase
              .from('public_profiles')
              .select('id, full_name, role')
              .eq('id', data.citizen_id)
              .maybeSingle();

            if (citizenData && isMounted) {
              setReportingCitizen(citizenData);
            }
          } catch (cErr) {
            console.warn('Could not fetch citizen profile:', cErr);
          }
        } else if (isMounted) {
          setReportingCitizen(null);
        }

        // 6. Check if authenticated user supports this report
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

        // 7. Fetch total supporter count when available
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

        // 8. If admin, fetch active workers for assignment control
        if (role === 'admin') {
          try {
            const { data: workerList } = await supabase
              .from('profiles')
              .select('id, full_name, role, is_active')
              .eq('role', 'worker')
              .order('full_name', { ascending: true });

            if (workerList && isMounted) {
              setAvailableWorkers(workerList);
            }
          } catch (wListErr) {
            console.warn('Could not fetch available workers:', wListErr);
          }
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
  }, [reportId, user, role, refreshKey]);

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

  // Handle administrator assigning a field worker via existing RPC
  const handleAdminAssignWorker = async (e) => {
    e.preventDefault();
    if (!adminSelectedWorkerId || isAdminAssigning || !reportId) return;

    setIsAdminAssigning(true);
    setAdminAssignFeedback(null);

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('assign_report_to_worker', {
        p_report_id: reportId,
        p_worker_id: adminSelectedWorkerId,
        p_notes: adminAssignNotes.trim() || null,
      });

      if (rpcErr) {
        console.error('assign_report_to_worker error:', rpcErr);
        setAdminAssignFeedback({
          type: 'error',
          message: rpcErr.message || 'Worker assignment failed.',
        });
      } else if (rpcRes?.success === false) {
        setAdminAssignFeedback({
          type: 'error',
          message: rpcRes.message || 'Assignment failed. Verify worker is active or report status is Reported.',
        });
      } else {
        setAdminAssignFeedback({
          type: 'success',
          message: 'Worker assigned successfully! Incident status updated to Assigned.',
        });
        setAdminSelectedWorkerId('');
        setAdminAssignNotes('');
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Admin worker assignment exception:', err);
      setAdminAssignFeedback({
        type: 'error',
        message: 'Network error occurred during worker assignment.',
      });
    } finally {
      setIsAdminAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="citizen-layout">
        <UserNavbar />
        <main className="tracking-container" role="main">
          <div className="state-card-box" aria-live="polite">
            <div className="clean-spinner" />
            <h2 className="state-card-title">Loading incident report details...</h2>
            <p className="state-card-desc">Retrieving municipal milestones and dispatch status.</p>
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
          <div className="state-card-box error" role="alert">
            <div className="state-card-icon error-icon" aria-hidden="true">⚠️</div>
            <h1 className="state-card-title">Report Unavailable</h1>
            <p className="state-card-desc">{error || 'The requested incident report was not found.'}</p>
            <div className="state-actions-cluster">
              <button
                type="button"
                className="btn-state-cta"
                onClick={() => navigate(reportsListRoute)}
              >
                &larr; Back to {isAdmin ? 'All Reports' : 'My Reports'}
              </button>
              <button
                type="button"
                className="btn-clear-filters"
                onClick={() => navigate(dashboardRoute)}
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
  const isCancelled = report.status === 'Cancelled';
  const isActive = !['Resolved', 'Cancelled'].includes(report.status);
  const isCreator = report.citizen_id === user?.id;

  // Compute status pipeline index
  const statusIndexMap = {
    Reported: 0,
    Assigned: 1,
    Accepted: 2,
    'In Progress': 3,
    Resolved: 4,
  };
  const currentStepIndex = statusIndexMap[report.status] ?? 0;

  return (
    <div className="citizen-layout">
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Navigation & Operational Bar */}
        <div className="tracking-nav-bar">
          <div className="details-breadcrumbs">
            <Link to={dashboardRoute} className="breadcrumb-link">
              {isAdmin ? 'Admin Console' : 'Dashboard'}
            </Link>
            <span className="breadcrumb-separator" aria-hidden="true">/</span>
            <Link to={reportsListRoute} className="breadcrumb-link">
              {isAdmin ? 'All Reports' : 'My Reports'}
            </Link>
            <span className="breadcrumb-separator" aria-hidden="true">/</span>
            <span className="breadcrumb-current">Incident #{report.id.slice(0, 8)}</span>
          </div>

          <div className="details-header-quick-links">
            <button
              type="button"
              className="btn-secondary-pill"
              onClick={() => navigate(reportsListRoute)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>Back to {isAdmin ? 'All Reports' : 'My Reports'}</span>
            </button>
          </div>
        </div>

        {/* Header Card */}
        <header className="report-detail-header-card">
          <div className="detail-header-left">
            <div className="detail-header-eyebrow-row">
              <span className="tracking-eyebrow">REPORT DETAILS</span>
              <span className="report-ref-chip" title={`Reference ID: ${report.id}`}>
                #{report.id.slice(0, 8)}
              </span>
            </div>
            <h1 className="detail-report-title">{report.title}</h1>
            <div className="detail-meta-row">
              <span className="meta-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Filed on <strong>{createdFormatted}</strong>
              </span>
              <span className="meta-separator">&bull;</span>
              <span className="meta-item">
                <span className="report-type-chip">
                  {GARBAGE_TYPE_ICONS[report.garbage_type] || '📦'} {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                </span>
              </span>
              <span className="meta-separator">&bull;</span>
              <span className={`severity-chip severity-${report.severity}`}>
                {report.severity}
              </span>
            </div>
          </div>

          <div className="detail-header-right">
            <ReportStatusBadge status={report.status} size="large" />
          </div>
        </header>

        {/* Status Progression Pipeline (Stepper) */}
        <section className="status-progression-card" aria-label="Incident resolution progression">
          <div className="progression-header">
            <span className="progression-title">
              <span className="progression-icon">📡</span> Municipal Lifecycle Progress
            </span>
            <span className="progression-current-status">
              Current Stage: <strong>{report.status}</strong>
            </span>
          </div>

          {isCancelled ? (
            <div className="status-cancelled-banner" role="status">
              <span className="cancelled-icon">✕</span>
              <div>
                <strong>Incident Cancelled</strong>
                <p>This report has been cancelled or deemed duplicate by municipal sanitation dispatch.</p>
              </div>
            </div>
          ) : (
            <div className="stepper-track-container" role="list">
              {LIFECYCLE_STEPS.map((step, idx) => {
                const isPassed = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                const dateVal = report[step.field] ? new Date(report[step.field]).toLocaleDateString() : null;

                return (
                  <div
                    key={step.key}
                    className={`stepper-node ${isPassed ? 'completed' : ''} ${isCurrent ? 'active' : ''}`}
                    role="listitem"
                  >
                    <div className="stepper-circle-wrap">
                      <div className="stepper-circle">
                        {isPassed ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : isCurrent ? (
                          <span className="stepper-active-dot" />
                        ) : (
                          <span className="stepper-number">{idx + 1}</span>
                        )}
                      </div>
                      {idx < LIFECYCLE_STEPS.length - 1 && <div className="stepper-connector" />}
                    </div>

                    <div className="stepper-label-group">
                      <span className="stepper-label">{step.label}</span>
                      {dateVal && <span className="stepper-date">{dateVal}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Two-Column Details & Evidence Layout */}
        <div className="report-details-layout-grid">
          {/* LEFT / LARGER COLUMN: Description, Evidence (Before/After), Resolution & Timeline */}
          <div className="report-details-main-col">
            {/* Description Section */}
            <section className="detail-section-card" aria-labelledby="desc-heading">
              <div className="section-card-header">
                <div className="section-icon-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <div>
                  <h2 id="desc-heading" className="section-card-title">Incident Description</h2>
                  <p className="section-card-sub">Field notes and conditions logged at submission</p>
                </div>
              </div>

              <p className="details-description-body">
                {report.description || 'No detailed description provided.'}
              </p>
            </section>

            {/* Before & After Photo Evidence Section */}
            <section className="detail-section-card" aria-labelledby="photos-heading">
              <div className="section-card-header">
                <div className="section-icon-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <div>
                  <h2 id="photos-heading" className="section-card-title">Before &amp; After Photo Evidence</h2>
                  <p className="section-card-sub">Visual documentation from citizen submission through cleanup completion</p>
                </div>
              </div>

              <div className="evidence-comparison-grid">
                {/* Initial Citizen Photo (Before) */}
                <div className="evidence-card before-card">
                  <div className="evidence-badge-tag before">
                    <span aria-hidden="true">📸</span> Initial Citizen Evidence (Before)
                  </div>

                  {incidentPhotoSignedUrl ? (
                    <div className="evidence-photo-frame">
                      <img
                        src={incidentPhotoSignedUrl}
                        alt={`Incident photo for ${report.title}`}
                        className="evidence-img"
                        loading="lazy"
                      />
                      <div className="evidence-caption-bar">
                        <span className="caption-note">Captured at submission</span>
                        <a
                          href={incidentPhotoSignedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="evidence-zoom-link"
                        >
                          Full Size &rarr;
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="evidence-placeholder">
                      <span className="placeholder-icon" aria-hidden="true">🖼️</span>
                      <p className="placeholder-text">
                        {report.photo_url
                          ? 'Photo securely stored in municipal archive (loading link).'
                          : 'No initial photo attached.'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Worker Resolution Photo (After) */}
                <div className="evidence-card after-card">
                  <div className="evidence-badge-tag after">
                    <span aria-hidden="true">✅</span> Cleanup Resolution Proof (After)
                  </div>

                  {resolutionPhotoSignedUrl ? (
                    <div className="evidence-photo-frame">
                      <img
                        src={resolutionPhotoSignedUrl}
                        alt="Resolution verification photo after cleanup"
                        className="evidence-img"
                        loading="lazy"
                      />
                      <div className="evidence-caption-bar">
                        <span className="caption-note">Certified by municipal field crew</span>
                        <a
                          href={resolutionPhotoSignedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="evidence-zoom-link"
                        >
                          Full Size &rarr;
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="evidence-placeholder">
                      <span className="placeholder-icon" aria-hidden="true">🧹</span>
                      <p className="placeholder-text">
                        {isResolved
                          ? 'Resolution certified without additional photo evidence.'
                          : 'Post-cleanup proof photo will be uploaded here when field work concludes.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Resolution Verification Card (Visible when report is resolved) */}
            {isResolved && (
              <section className="detail-section-card resolution-card" aria-labelledby="resolution-heading">
                <div className="resolution-header-cluster">
                  <div className="resolution-check-circle" aria-hidden="true">✓</div>
                  <div>
                    <span className="resolution-eyebrow">FIELD RESOLUTION CERTIFIED</span>
                    <h2 id="resolution-heading" className="resolution-title">
                      Cleanup Complete &amp; Verified
                    </h2>
                  </div>
                </div>

                <div className="resolution-notes-box">
                  <p className="resolution-notes-content">
                    {report.resolution_notes || 'Cleanup completed and certified by municipal sanitation crew.'}
                  </p>
                </div>

                {report.resolved_at && (
                  <div className="resolution-meta-date">
                    <span>Certified Completed on:</span>
                    <strong>{new Date(report.resolved_at).toLocaleString()}</strong>
                  </div>
                )}
              </section>
            )}

            {/* Status Timeline History */}
            <section className="detail-section-card" aria-labelledby="timeline-heading">
              <div className="section-card-header">
                <div className="section-icon-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <h2 id="timeline-heading" className="section-card-title">Status Progression Timeline</h2>
                  <p className="section-card-sub">Chronological audit trail of all dispatch and operational milestones</p>
                </div>
              </div>

              <div className="timeline-wrapper-card">
                <ReportTimeline key={refreshKey} reportId={report.id} />
              </div>
            </section>
          </div>

          {/* RIGHT / SUPPORTING COLUMN: Community Support, Location, Dispatch & Classification */}
          <aside className="report-details-sidebar-col" aria-label="Incident metadata">
            {/* Admin Dispatch Assignment Action (Visible for Admin role) */}
            {isAdmin && (
              <div className="detail-section-card admin-action-card" aria-labelledby="admin-dispatch-heading">
                <div className="section-card-header">
                  <div className="section-icon-box">🛡️</div>
                  <div>
                    <h2 id="admin-dispatch-heading" className="section-card-title">Admin Dispatch Action</h2>
                    <p className="section-card-sub">Assign worker to pending report</p>
                  </div>
                </div>

                <div className="meta-list-group">
                  <div className="meta-row-item">
                    <span className="meta-label">Status:</span>
                    <ReportStatusBadge status={report.status} size="small" />
                  </div>
                  <div className="meta-row-item">
                    <span className="meta-label">Worker:</span>
                    <span className="meta-val">
                      {assignedWorker ? (
                        <span className="worker-badge-pill">
                          <span aria-hidden="true">👤</span> {assignedWorker.full_name}
                        </span>
                      ) : (
                        <span style={{ color: '#D97706', fontWeight: 600 }}>Unassigned</span>
                      )}
                    </span>
                  </div>
                </div>

                {report.status === 'Reported' ? (
                  <form onSubmit={handleAdminAssignWorker} className="admin-assign-form">
                    <div className="form-field-item">
                      <label htmlFor="admin-worker-select" className="form-label">
                        Assign Field Worker
                      </label>
                      <select
                        id="admin-worker-select"
                        className="form-input-text"
                        value={adminSelectedWorkerId}
                        onChange={(e) => setAdminSelectedWorkerId(e.target.value)}
                        disabled={isAdminAssigning}
                      >
                        <option value="">Select a worker...</option>
                        {availableWorkers.map((w) => (
                          <option key={w.id} value={w.id} disabled={w.is_active === false}>
                            {w.full_name} {w.is_active === false ? '(Off-Duty)' : '(Available)'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field-item">
                      <label htmlFor="admin-notes" className="form-label">
                        Dispatch Notes (Optional)
                      </label>
                      <input
                        type="text"
                        id="admin-notes"
                        className="form-input-text"
                        placeholder="Instructions for worker..."
                        value={adminAssignNotes}
                        onChange={(e) => setAdminAssignNotes(e.target.value)}
                        disabled={isAdminAssigning}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn-primary-block"
                      disabled={!adminSelectedWorkerId || isAdminAssigning}
                    >
                      {isAdminAssigning ? 'Assigning Worker...' : 'Confirm Worker Assignment'}
                    </button>

                    {adminAssignFeedback && (
                      <div className={`alert-feedback ${adminAssignFeedback.type}`} role="alert">
                        {adminAssignFeedback.message}
                      </div>
                    )}
                  </form>
                ) : (
                  <p className="admin-note-text">
                    Incident is in <strong>{report.status}</strong> stage. Direct assignment is only permitted for reports in <em>Reported</em> status.
                  </p>
                )}
              </div>
            )}

            {/* Community Support Card */}
            <div className="detail-section-card" aria-labelledby="support-heading">
              <div className="section-card-header">
                <div className="section-icon-box">🤝</div>
                <div>
                  <h2 id="support-heading" className="section-card-title">Community Support</h2>
                  <p className="section-card-sub">Citizen solidarity to elevate dispatch priority</p>
                </div>
              </div>

              <div className="meta-list-group">
                <div className="meta-row-item">
                  <span className="meta-label">Total Supporters:</span>
                  <span className="meta-val highlight-green">
                    👥 {supporterCount !== null ? `${supporterCount} ${supporterCount === 1 ? 'Citizen' : 'Citizens'}` : 'Available on update'}
                  </span>
                </div>

                <div className="meta-row-item">
                  <span className="meta-label">Your Status:</span>
                  <span className="meta-val">
                    {isAdmin ? (
                      <span className="support-status-chip admin">Administrator</span>
                    ) : isCreator ? (
                      <span className="support-status-chip creator">✍️ Report Creator</span>
                    ) : isSupporting ? (
                      <span className="support-status-chip active">✓ Supporting</span>
                    ) : (
                      <span className="support-status-chip muted">Not following</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Citizen Support Action (Hidden for Admin/Creator) */}
              {!isAdmin && !isCreator && isActive && (
                <div className="support-action-box">
                  {isSupporting ? (
                    <div className="support-active-card">
                      <strong>✓ You are supporting this report</strong>
                      <p>You will receive status notifications as municipal teams update and resolve this incident.</p>
                    </div>
                  ) : (
                    <div className="support-trigger-card">
                      <p>Also affected by this waste accumulation? Support this report to help prioritize dispatch.</p>
                      <button
                        type="button"
                        className="btn-support-cta"
                        onClick={handleSupportReport}
                        disabled={isSubmittingSupport}
                      >
                        {isSubmittingSupport ? (
                          <span className="clean-spinner-small" aria-hidden="true" />
                        ) : (
                          <span>👍 Support this Report (+1)</span>
                        )}
                      </button>
                    </div>
                  )}

                  {supportFeedback && (
                    <div className={`alert-feedback ${supportFeedback.type}`} role="alert">
                      {supportFeedback.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Incident Location Card */}
            <div className="detail-section-card">
              <div className="section-card-header">
                <div className="section-icon-box">📍</div>
                <div>
                  <h2 className="section-card-title">Location Coordinates</h2>
                  <p className="section-card-sub">GPS reference and landmark details</p>
                </div>
              </div>

              <div className="meta-list-group">
                <div className="meta-row-item">
                  <span className="meta-label">Street Address:</span>
                  <span className="meta-val">{report.address || 'GPS Coordinates Provided'}</span>
                </div>
                <div className="meta-row-item">
                  <span className="meta-label">Coordinates:</span>
                  <span className="meta-val monospace">
                    {typeof report.latitude === 'number' && typeof report.longitude === 'number'
                      ? `${report.latitude.toFixed(5)}°, ${report.longitude.toFixed(5)}°`
                      : 'Unavailable'}
                  </span>
                </div>
                {reportingCitizen && (
                  <div className="meta-row-item">
                    <span className="meta-label">Filed by:</span>
                    <span className="meta-val">{reportingCitizen.full_name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Municipal Dispatch Card */}
            <div className="detail-section-card">
              <div className="section-card-header">
                <div className="section-icon-box">👷</div>
                <div>
                  <h2 className="section-card-title">Municipal Dispatch</h2>
                  <p className="section-card-sub">Assigned crew and operational timestamps</p>
                </div>
              </div>

              <div className="meta-list-group">
                <div className="meta-row-item">
                  <span className="meta-label">Dispatch Status:</span>
                  <ReportStatusBadge status={report.status} size="small" />
                </div>
                <div className="meta-row-item">
                  <span className="meta-label">Assigned Worker:</span>
                  <span className="meta-val">
                    {assignedWorker ? (
                      <span className="worker-badge-pill">
                        <span aria-hidden="true">👤</span> {assignedWorker.full_name}
                      </span>
                    ) : (
                      <span className="pending-text">Pending Dispatch</span>
                    )}
                  </span>
                </div>
                {report.assigned_at && (
                  <div className="meta-row-item">
                    <span className="meta-label">Assigned Date:</span>
                    <span className="meta-val">{new Date(report.assigned_at).toLocaleDateString()}</span>
                  </div>
                )}
                {report.accepted_at && (
                  <div className="meta-row-item">
                    <span className="meta-label">Accepted Date:</span>
                    <span className="meta-val">{new Date(report.accepted_at).toLocaleDateString()}</span>
                  </div>
                )}
                {report.in_progress_at && (
                  <div className="meta-row-item">
                    <span className="meta-label">Work Started:</span>
                    <span className="meta-val">{new Date(report.in_progress_at).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Classification & Severity Card */}
            <div className="detail-section-card">
              <div className="section-card-header">
                <div className="section-icon-box">🏷️</div>
                <div>
                  <h2 className="section-card-title">Classification</h2>
                  <p className="section-card-sub">Waste category and risk assessment</p>
                </div>
              </div>

              <div className="meta-list-group">
                <div className="meta-row-item">
                  <span className="meta-label">Category:</span>
                  <span className="meta-val">
                    {GARBAGE_TYPE_ICONS[report.garbage_type] || '📦'} {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                  </span>
                </div>
                <div className="meta-row-item">
                  <span className="meta-label">Severity:</span>
                  <span className="meta-val">
                    <span className={`severity-chip severity-${report.severity}`}>
                      {report.severity}
                    </span>
                  </span>
                </div>
              </div>
              <p className="severity-helper-text">
                {SEVERITY_DESCRIPTIONS[report.severity] || ''}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
