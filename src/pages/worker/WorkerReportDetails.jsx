import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import ReportTimeline from '../../components/citizen/ReportTimeline';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { compressIncidentPhoto } from '../../utils/imageCompression';
import '../../styles/citizen-tracking.css';
import '../../styles/worker.css';

const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

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

const LIFECYCLE_STEPS = [
  { key: 'Reported', label: 'Reported' },
  { key: 'Assigned', label: 'Assigned' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'In Progress', label: 'In Progress' },
  { key: 'Resolved', label: 'Resolved' },
];

export default function WorkerReportDetails() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [report, setReport] = useState(null);
  const [incidentPhotoSignedUrl, setIncidentPhotoSignedUrl] = useState(null);
  const [resolutionPhotoSignedUrl, setResolutionPhotoSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Transition state
  const [transitioning, setTransitioning] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);
  const [actionErrorMsg, setActionErrorMsg] = useState(null);

  // Resolution Form State
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [selectedResolutionPhoto, setSelectedResolutionPhoto] = useState(null);
  const [resolutionPhotoPreview, setResolutionPhotoPreview] = useState(null);
  const [resolutionPhotoError, setResolutionPhotoError] = useState(null);
  const [refreshTimelineKey, setRefreshTimelineKey] = useState(0);

  useEffect(() => {
    if (!reportId || !user?.id) return;

    let isMounted = true;

    async function loadReportDetails() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('reports')
          .select('*')
          .eq('id', reportId)
          .maybeSingle();

        if (fetchErr) {
          console.error('Error fetching report details:', fetchErr);
          if (isMounted) setError('Unable to load report information.');
          return;
        }

        if (!data) {
          if (isMounted) setError('Task not found or access is unauthorized.');
          return;
        }

        // CRITICAL WORKER AUTHORIZATION CHECK
        if (data.assigned_worker_id !== user.id) {
          if (isMounted) setError('Access restricted: You are not assigned to this municipal dispatch task.');
          return;
        }

        if (isMounted) {
          setReport(data);
          if (data.resolution_notes) {
            setResolutionNotes(data.resolution_notes);
          }
        }

        // Signed URL for citizen initial incident photo
        if (data.photo_url && isMounted) {
          try {
            const { data: signData } = await supabase.storage
              .from('report-photos')
              .createSignedUrl(data.photo_url, 3600);
            if (signData?.signedUrl && isMounted) {
              setIncidentPhotoSignedUrl(signData.signedUrl);
            }
          } catch (signErr) {
            console.warn('Could not sign incident photo:', signErr);
          }
        }

        // Signed URL for worker completion photo if exists
        if (data.resolution_photo_url && isMounted) {
          try {
            const { data: resSignData } = await supabase.storage
              .from('resolution-photos')
              .createSignedUrl(data.resolution_photo_url, 3600);
            if (resSignData?.signedUrl && isMounted) {
              setResolutionPhotoSignedUrl(resSignData.signedUrl);
            }
          } catch (resSignErr) {
            console.warn('Could not sign resolution photo:', resSignErr);
          }
        }
      } catch (err) {
        console.error('Exception loading report details:', err);
        if (isMounted) setError('Network error while retrieving report details.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadReportDetails();

    const channel = supabase
      .channel(`worker-report-detail-${reportId}`)
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
          setRefreshTimelineKey((k) => k + 1);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [reportId, user]);

  // Clean up photo object URL preview
  useEffect(() => {
    return () => {
      if (resolutionPhotoPreview) {
        URL.revokeObjectURL(resolutionPhotoPreview);
      }
    };
  }, [resolutionPhotoPreview]);

  // Photo Selection
  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResolutionPhotoError(null);

    if (!ALLOWED_PHOTO_MIMES.includes(file.type)) {
      setResolutionPhotoError('Invalid image format. Only JPEG, PNG, and WebP are allowed.');
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setResolutionPhotoError(`File is too large (${sizeMb} MB). Maximum allowed size is 5 MB.`);
      return;
    }

    if (resolutionPhotoPreview) {
      URL.revokeObjectURL(resolutionPhotoPreview);
    }

    // Compress client-side targeting <= 300KB WebP
    let fileToStash = file;
    try {
      fileToStash = await compressIncidentPhoto(file);
    } catch (compErr) {
      console.warn('Worker resolution photo compression fallback:', compErr);
    }

    setSelectedResolutionPhoto(fileToStash);
    const objectUrl = URL.createObjectURL(fileToStash);
    setResolutionPhotoPreview(objectUrl);
  };

  const handleRemovePhoto = () => {
    if (resolutionPhotoPreview) {
      URL.revokeObjectURL(resolutionPhotoPreview);
    }
    setSelectedResolutionPhoto(null);
    setResolutionPhotoPreview(null);
    setResolutionPhotoError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Status Action: Accept Task
  const handleAcceptAssignment = async () => {
    setTransitioning(true);
    setActionErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_target_status: 'Accepted',
        p_notes: 'Task accepted by assigned field worker.',
        p_resolution_photo_url: null,
      });

      if (rpcErr || data?.success === false) {
        const msg = data?.message || rpcErr?.message || 'Failed to accept task.';
        setActionErrorMsg(msg);
      } else {
        setActionSuccessMsg('Task accepted. Ready to proceed to site.');
        setReport((prev) => ({ ...prev, status: 'Accepted' }));
        setRefreshTimelineKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Accept exception:', err);
      setActionErrorMsg('Network error while accepting task.');
    } finally {
      setTransitioning(false);
    }
  };

  // Status Action: Start Cleanup
  const handleStartCleanup = async () => {
    setTransitioning(true);
    setActionErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_target_status: 'In Progress',
        p_notes: 'Sanitation team arrived at incident location; cleanup work in progress.',
        p_resolution_photo_url: null,
      });

      if (rpcErr || data?.success === false) {
        const msg = data?.message || rpcErr?.message || 'Failed to update status to In Progress.';
        setActionErrorMsg(msg);
      } else {
        setActionSuccessMsg('Status updated to In Progress.');
        setReport((prev) => ({ ...prev, status: 'In Progress' }));
        setRefreshTimelineKey((k) => k + 1);
      }
    } catch (err) {
      console.error('In Progress exception:', err);
      setActionErrorMsg('Network error while updating status.');
    } finally {
      setTransitioning(false);
    }
  };

  // Status Action: Mark As Resolved
  const handleResolveReport = async (e) => {
    e.preventDefault();
    setActionErrorMsg(null);
    setActionSuccessMsg(null);

    if (!resolutionNotes.trim()) {
      setActionErrorMsg('Please enter resolution notes describing the sanitation work completed.');
      return;
    }

    if (!selectedResolutionPhoto) {
      setActionErrorMsg('A completion photo is required to verify resolution.');
      return;
    }

    setTransitioning(true);
    let uploadedPath = null;

    try {
      const fileExt = selectedResolutionPhoto.name.split('.').pop().toLowerCase();
      const sanitizedName = `res_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const storagePath = `${user.id}/${sanitizedName}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('resolution-photos')
        .upload(storagePath, selectedResolutionPhoto, {
          contentType: selectedResolutionPhoto.type,
          upsert: false,
        });

      if (uploadErr || !uploadData?.path) {
        console.error('Upload resolution photo error:', uploadErr);
        setActionErrorMsg('Failed to upload completion photo: ' + (uploadErr?.message || 'Storage error'));
        setTransitioning(false);
        return;
      }

      uploadedPath = uploadData.path;

      const { data: rpcData, error: rpcErr } = await supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_target_status: 'Resolved',
        p_notes: resolutionNotes.trim(),
        p_resolution_photo_url: uploadedPath,
      });

      if (rpcErr || rpcData?.success === false) {
        const msg = rpcData?.message || rpcErr?.message || 'Resolution failed.';
        setActionErrorMsg(msg);

        try {
          await supabase.storage.from('resolution-photos').remove([uploadedPath]);
        } catch {
          // Ignored
        }
      } else {
        setActionSuccessMsg('Task marked as Resolved and verified with completion proof.');
        setReport((prev) => ({
          ...prev,
          status: 'Resolved',
          resolution_notes: resolutionNotes.trim(),
          resolution_photo_url: uploadedPath,
          resolved_at: new Date().toISOString(),
        }));
        setRefreshTimelineKey((k) => k + 1);

        const { data: resSign } = await supabase.storage
          .from('resolution-photos')
          .createSignedUrl(uploadedPath, 3600);
        if (resSign?.signedUrl) {
          setResolutionPhotoSignedUrl(resSign.signedUrl);
        }
      }
    } catch (err) {
      console.error('Resolve exception:', err);
      setActionErrorMsg('Network error while completing task.');
    } finally {
      setTransitioning(false);
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Lifecycle calculation
  const currentStepIndex = LIFECYCLE_STEPS.findIndex((s) => s.key === report?.status);
  const validStepIndex = currentStepIndex !== -1 ? currentStepIndex : 0;

  if (loading) {
    return (
      <div className="worker-layout">
        <UserNavbar />
        <main className="worker-task-detail-container" role="main">
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading task...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="worker-layout">
        <UserNavbar />
        <main className="worker-task-detail-container" role="main">
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h1 className="state-title">Task Unavailable</h1>
            <p className="state-desc">{error || 'The requested assigned task was not found.'}</p>
            <button
              type="button"
              className="btn-worker-link"
              onClick={() => navigate('/worker/reports')}
            >
              &larr; Back to Assigned Tasks
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="worker-layout">
      <UserNavbar />

      <main className="worker-task-detail-container" role="main">
        {/* 1. Back Navigation */}
        <div className="task-detail-nav">
          <Link to="/worker/reports" className="btn-tracking-back">
            &larr; Back to Assigned Tasks
          </Link>
        </div>

        {/* 2. Compact Essential Header: ID, Title, Severity, Location, Time */}
        <header className="task-essential-header">
          <div className="essential-header-top">
            <span className="task-short-id">INCIDENT #{report.id.slice(0, 8)}</span>
            <span className={`severity-tag severity-${(report.severity || 'medium').toLowerCase()}`}>
              {report.severity?.toUpperCase() || 'MEDIUM'}
            </span>
          </div>

          <h1 className="task-essential-title">{report.title}</h1>

          <div className="task-essential-meta">
            <span className="meta-item">
              <span aria-hidden="true">📍</span> {report.address || 'Address recorded'}
            </span>
            <span className="meta-sep">&bull;</span>
            <span className="meta-item">Reported {formatDate(report.created_at)}</span>
          </div>
        </header>

        {/* 3. Compact Status Pipeline */}
        <section className="task-compact-status" aria-label="Task Status Pipeline">
          <div className="compact-stepper">
            {LIFECYCLE_STEPS.map((step, idx) => {
              const isCompleted = idx < validStepIndex;
              const isActive = idx === validStepIndex;
              return (
                <div key={step.key} className={`compact-step ${isCompleted ? 'completed' : isActive ? 'active' : ''}`}>
                  <div className="compact-step-dot" aria-hidden="true">
                    {isCompleted ? '✓' : idx + 1}
                  </div>
                  <span className="compact-step-name">{step.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Action Alerts */}
        {actionSuccessMsg && (
          <div className="auth-alert alert-success" role="alert">
            <span>✅ {actionSuccessMsg}</span>
          </div>
        )}
        {actionErrorMsg && (
          <div className="auth-alert alert-error" role="alert">
            <span>⚠️ {actionErrorMsg}</span>
          </div>
        )}

        {/* 4. Main Incident Section: Photo, Category, Description, Location + Open Route */}
        <section className="task-main-incident-card" aria-label="Incident Information">
          {incidentPhotoSignedUrl && (
            <div className="incident-photo-container">
              <img
                src={incidentPhotoSignedUrl}
                alt={`Citizen photo for ${report.title}`}
                className="incident-evidence-photo"
              />
            </div>
          )}

          <div className="incident-info-body">
            <div className="incident-type-tag">
              <strong>Category:</strong> {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type || 'General Waste'}
            </div>

            {report.description && (
              <div className="incident-description-text">
                <strong>Description:</strong>
                <p>{report.description}</p>
              </div>
            )}

            <div className="incident-location-box">
              <div className="location-text-wrap">
                <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>📍</span>
                <div>
                  <strong>{report.address || 'Incident Location'}</strong>
                  {report.latitude && report.longitude && (
                    <div style={{ fontSize: '0.775rem', color: 'var(--worker-text-body)', opacity: 0.8, fontFamily: 'monospace' }}>
                      GPS: {report.latitude.toFixed(5)}°, {report.longitude.toFixed(5)}°
                    </div>
                  )}
                </div>
              </div>

              {report.latitude && report.longitude && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${report.latitude},${report.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-open-route"
                  id="btn-navigate-to-incident"
                >
                  🧭 NAVIGATE TO INCIDENT ↗
                </a>
              )}
            </div>
          </div>
        </section>

        {/* 5. Clearly Separated YOUR ACTION Section */}
        <section className="task-action-card" aria-label="Your Action">
          <div className="action-card-header">
            <span className="action-card-eyebrow">YOUR ACTION</span>
            <ReportStatusBadge status={report.status} size="small" />
          </div>

          {/* Assigned State */}
          {report.status === 'Assigned' && (
            <div className="action-stage-box">
              <p className="action-prompt">
                This report is assigned to you. Review the incident details above and accept to begin scheduling cleanup.
              </p>
              <button
                type="button"
                className="btn-primary-action"
                onClick={handleAcceptAssignment}
                disabled={transitioning}
              >
                {transitioning ? 'Accepting Task...' : '👍 ACCEPT TASK'}
              </button>
            </div>
          )}

          {/* Accepted State */}
          {report.status === 'Accepted' && (
            <div className="action-stage-box">
              <p className="action-prompt">
                Task accepted. When you arrive on site and start sanitation operations, tap below:
              </p>
              <button
                type="button"
                className="btn-primary-action in-progress"
                onClick={handleStartCleanup}
                disabled={transitioning}
              >
                {transitioning ? 'Starting Cleanup...' : '🚛 START CLEANUP'}
              </button>
            </div>
          )}

          {/* In Progress State: Form directly visible */}
          {report.status === 'In Progress' && (
            <form onSubmit={handleResolveReport} className="action-resolution-form">
              <p className="action-prompt">
                Cleanup is in progress. To complete this task, describe the sanitation work completed and upload a verified completion photo.
              </p>

              <div className="form-group-clean">
                <label htmlFor="resolution-notes">
                  Resolution Notes <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <textarea
                  id="resolution-notes"
                  className="clean-textarea"
                  placeholder="Describe the cleanup performed (e.g., cleared accumulated debris, swept the sidewalk, disinfected the area)..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  disabled={transitioning}
                  required
                />
              </div>

              <div className="form-group-clean">
                <label>
                  Completion Photo <span style={{ color: '#DC2626' }}>*</span>
                </label>

                {!resolutionPhotoPreview ? (
                  <div
                    className="clean-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                    }}
                  >
                    <span style={{ fontSize: '1.75rem' }}>📸</span>
                    <strong>Take or Upload Completion Photo</strong>
                    <small>JPEG, PNG, WebP up to 5 MB</small>
                  </div>
                ) : (
                  <div className="clean-preview-wrap">
                    <img
                      src={resolutionPhotoPreview}
                      alt="Completion proof preview"
                      className="clean-preview-img"
                    />
                    <button
                      type="button"
                      className="btn-remove-preview"
                      onClick={handleRemovePhoto}
                      disabled={transitioning}
                      aria-label="Remove selected photo"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoSelect}
                  style={{ display: 'none' }}
                />

                {resolutionPhotoError && (
                  <p style={{ color: '#DC2626', fontSize: '0.8rem', margin: '0.25rem 0 0', fontWeight: 600 }}>
                    ⚠️ {resolutionPhotoError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary-action resolved"
                disabled={transitioning || !resolutionNotes.trim() || !selectedResolutionPhoto}
              >
                {transitioning ? 'Verifying & Completing...' : '✅ MARK AS RESOLVED'}
              </button>
            </form>
          )}

          {/* Resolved State */}
          {report.status === 'Resolved' && (
            <div className="action-stage-box resolved">
              <div className="resolved-header-row">
                <span className="resolved-check-badge">✓ TASK COMPLETED</span>
                {report.resolved_at && (
                  <span className="resolved-date">
                    Completed on {formatDate(report.resolved_at)}
                  </span>
                )}
              </div>

              {report.resolution_notes && (
                <div className="resolved-notes-box">
                  <strong>Field Notes:</strong>
                  <p>{report.resolution_notes}</p>
                </div>
              )}

              {resolutionPhotoSignedUrl && (
                <div className="resolved-photo-wrap">
                  <strong>Completion Photo:</strong>
                  <img
                    src={resolutionPhotoSignedUrl}
                    alt="Verified cleanup completion"
                    className="resolved-photo-img"
                  />
                </div>
              )}
            </div>
          )}

          {/* Cancelled State */}
          {report.status === 'Cancelled' && (
            <div className="action-stage-box">
              <p style={{ color: '#DC2626', fontWeight: 600, margin: 0 }}>
                This report has been cancelled by municipal administration.
              </p>
            </div>
          )}
        </section>

        {/* 6. Secondary Information Drawer (Timeline & Full Metadata) */}
        <details className="task-secondary-details">
          <summary className="secondary-details-summary">
            <span>📋 Full Report Timeline & Metadata</span>
            <span className="summary-chevron" aria-hidden="true">▼</span>
          </summary>

          <div className="secondary-details-content">
            <div className="secondary-metadata-grid">
              <div className="meta-cell">
                <span className="meta-label">Incident ID</span>
                <span className="meta-val monospace">{report.id}</span>
              </div>
              <div className="meta-cell">
                <span className="meta-label">Submitted</span>
                <span className="meta-val">{formatDate(report.created_at)}</span>
              </div>
              {report.assigned_at && (
                <div className="meta-cell">
                  <span className="meta-label">Assigned</span>
                  <span className="meta-val">{formatDate(report.assigned_at)}</span>
                </div>
              )}
              {report.accepted_at && (
                <div className="meta-cell">
                  <span className="meta-label">Accepted</span>
                  <span className="meta-val">{formatDate(report.accepted_at)}</span>
                </div>
              )}
              {report.in_progress_at && (
                <div className="meta-cell">
                  <span className="meta-label">Started</span>
                  <span className="meta-val">{formatDate(report.in_progress_at)}</span>
                </div>
              )}
              {report.resolved_at && (
                <div className="meta-cell">
                  <span className="meta-label">Resolved</span>
                  <span className="meta-val">{formatDate(report.resolved_at)}</span>
                </div>
              )}
            </div>

            <div className="secondary-timeline-wrap">
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--worker-text-h)' }}>
                Status History & Audit
              </h2>
              <ReportTimeline key={refreshTimelineKey} reportId={report.id} />
            </div>
          </div>
        </details>
      </main>
    </div>
  );
}
