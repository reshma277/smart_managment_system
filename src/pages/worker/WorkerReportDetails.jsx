import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import ReportStatusBadge from '../../components/citizen/ReportStatusBadge';
import ReportTimeline from '../../components/citizen/ReportTimeline';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/worker.css';
import '../../styles/citizen-tracking.css';

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
  const [showResolutionForm, setShowResolutionForm] = useState(false);
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

        if (isMounted) {
          setReport(data);
          if (data.status === 'In Progress') {
            setShowResolutionForm(true);
          }
        }

        // Signed URL for incident initial photo
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

        // Signed URL for resolution completion photo if exists
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

  // Handle Photo Selection
  const handlePhotoSelect = (e) => {
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

    setSelectedResolutionPhoto(file);
    const objectUrl = URL.createObjectURL(file);
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

  // Status Transitions
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
        setActionSuccessMsg('Task accepted successfully. Ready to start cleanup.');
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

  const handleStartCleanup = async () => {
    setTransitioning(true);
    setActionErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_target_status: 'In Progress',
        p_notes: 'Sanitation team arrived at incident location; work in progress.',
        p_resolution_photo_url: null,
      });

      if (rpcErr || data?.success === false) {
        const msg = data?.message || rpcErr?.message || 'Failed to update status to In Progress.';
        setActionErrorMsg(msg);
      } else {
        setActionSuccessMsg('Status updated: Work is now In Progress.');
        setReport((prev) => ({ ...prev, status: 'In Progress' }));
        setShowResolutionForm(true);
        setRefreshTimelineKey((k) => k + 1);
      }
    } catch (err) {
      console.error('In Progress exception:', err);
      setActionErrorMsg('Network error while updating status.');
    } finally {
      setTransitioning(false);
    }
  };

  const handleResolveReport = async (e) => {
    e.preventDefault();
    setActionErrorMsg(null);
    setActionSuccessMsg(null);

    // Validation
    if (!resolutionNotes.trim()) {
      setActionErrorMsg('Please enter resolution notes describing the sanitation work completed.');
      return;
    }

    if (!selectedResolutionPhoto) {
      setActionErrorMsg('A completion photo is required by municipal policy to verify resolution.');
      return;
    }

    setTransitioning(true);
    let uploadedPath = null;

    try {
      // 1. Upload resolution photo to private bucket: resolution-photos/{workerId}/{fileName}
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
        setActionErrorMsg('Failed to upload resolution proof photo: ' + (uploadErr?.message || 'Storage error'));
        setTransitioning(false);
        return;
      }

      uploadedPath = uploadData.path;

      // 2. Invoke RPC transition_report_status
      const { data: rpcData, error: rpcErr } = await supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_target_status: 'Resolved',
        p_notes: resolutionNotes.trim(),
        p_resolution_photo_url: uploadedPath,
      });

      if (rpcErr || rpcData?.success === false) {
        const msg = rpcData?.message || rpcErr?.message || 'Resolution transition failed.';
        setActionErrorMsg(msg);

        // Attempt photo cleanup if safe
        try {
          await supabase.storage.from('resolution-photos').remove([uploadedPath]);
        } catch {
          // Ignored
        }
      } else {
        setActionSuccessMsg('Incident marked as Resolved and verified with completion proof.');
        setReport((prev) => ({
          ...prev,
          status: 'Resolved',
          resolution_notes: resolutionNotes.trim(),
          resolution_photo_url: uploadedPath,
        }));
        setRefreshTimelineKey((k) => k + 1);

        // Sign photo URL for immediate display
        const { data: resSign } = await supabase.storage
          .from('resolution-photos')
          .createSignedUrl(uploadedPath, 3600);
        if (resSign?.signedUrl) {
          setResolutionPhotoSignedUrl(resSign.signedUrl);
        }
      }
    } catch (err) {
      console.error('Resolve exception:', err);
      setActionErrorMsg('Network error while completing resolution.');
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

  if (loading) {
    return (
      <div className="worker-layout">
        <UserNavbar />
        <main className="tracking-container" role="main">
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading task operation details...</p>
            <p className="state-desc">Retrieving municipal incident record and dispatch state.</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="worker-layout">
        <UserNavbar />
        <main className="tracking-container" role="main">
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <h1 className="state-title">Task Unavailable</h1>
            <p className="state-desc">{error || 'The requested assigned task was not found.'}</p>
            <button
              type="button"
              className="btn-form-submit state-action-btn"
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

      <main className="tracking-container" role="main">
        {/* Navigation Breadcrumb */}
        <nav aria-label="Task Navigation" style={{ marginBottom: '1rem' }}>
          <Link to="/worker/reports" className="btn-secondary-link">
            &larr; Back to Assigned Tasks
          </Link>
        </nav>

        {/* Task Header Card */}
        <header className="task-detail-header-card">
          <div className="task-card-header-row">
            <div>
              <span className="section-badge" style={{ marginBottom: '0.4rem', display: 'inline-block' }}>
                Municipal Dispatch Operation
              </span>
              <h1 style={{ margin: '0 0 0.35rem 0', fontSize: '1.65rem', color: 'var(--text-h)' }}>
                {report.title}
              </h1>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
                Reported {formatDate(report.created_at)} &bull; Task ID: <code style={{ fontSize: '0.8rem' }}>{report.id}</code>
              </p>
            </div>
            <ReportStatusBadge status={report.status} size="large" />
          </div>

          {/* Action & Status Feedback Alerts */}
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

          {/* Status Controls Bar */}
          <div className="task-action-controls-bar">
            <div className="task-current-state">
              <span className="task-state-label">Workflow Action:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-h)', fontSize: '0.9rem' }}>
                {report.status === 'Assigned' && 'Review incident and accept assignment'}
                {report.status === 'Accepted' && 'Accepted — ready to proceed to site'}
                {report.status === 'In Progress' && 'Cleanup underway — complete work & upload verification'}
                {report.status === 'Resolved' && 'Cleanup completed and verified'}
                {report.status === 'Cancelled' && 'Report cancelled'}
              </span>
            </div>

            <div className="action-buttons-group">
              {/* Transition 1: Assigned -> Accepted */}
              {report.status === 'Assigned' && (
                <button
                  type="button"
                  className="btn-worker-accept"
                  onClick={handleAcceptAssignment}
                  disabled={transitioning}
                >
                  {transitioning ? 'Processing...' : '👍 Accept Task Assignment'}
                </button>
              )}

              {/* Transition 2: Accepted -> In Progress */}
              {report.status === 'Accepted' && (
                <button
                  type="button"
                  className="btn-worker-progress"
                  onClick={handleStartCleanup}
                  disabled={transitioning}
                >
                  {transitioning ? 'Processing...' : '🚛 Start Cleanup (In Progress)'}
                </button>
              )}

              {/* In Progress Quick Trigger */}
              {report.status === 'In Progress' && !showResolutionForm && (
                <button
                  type="button"
                  className="btn-worker-resolve"
                  onClick={() => setShowResolutionForm(true)}
                >
                  ✅ Resolve & Verify Task &rarr;
                </button>
              )}

              {report.status === 'Resolved' && (
                <span className="duty-status-badge">
                  ✅ Task Completed
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Resolution Submission Section (when In Progress) */}
        {report.status === 'In Progress' && showResolutionForm && (
          <section className="resolution-section-card" aria-label="Task Resolution Submission">
            <h3>
              <span>✅</span> Complete & Resolve Task
            </h3>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
              Provide completion notes and upload a verified site photo to confirm waste sanitation.
            </p>

            <form onSubmit={handleResolveReport} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="resolution-form-group">
                <label htmlFor="resolution-notes">
                  Resolution Notes <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  id="resolution-notes"
                  className="resolution-textarea"
                  placeholder="Describe the cleanup performed (e.g. Cleared 2 commercial dumpsters, swept residual debris, disinfected perimeter area)..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  disabled={transitioning}
                  required
                />
              </div>

              <div className="resolution-form-group">
                <label>
                  Completion Evidence Photo <span style={{ color: '#ef4444' }}>*</span>
                </label>

                {!resolutionPhotoPreview ? (
                  <div
                    className="resolution-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                    }}
                  >
                    <span style={{ fontSize: '2rem' }}>📸</span>
                    <div>
                      <strong>Click to upload completion photo</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text)' }}>
                        JPEG, PNG, or WebP up to 5 MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="resolution-preview-wrap">
                    <img
                      src={resolutionPhotoPreview}
                      alt="Completion preview"
                      className="resolution-preview-img"
                    />
                    <button
                      type="button"
                      className="btn-remove-photo"
                      onClick={handleRemovePhoto}
                      title="Remove selected photo"
                      aria-label="Remove selected photo"
                      disabled={transitioning}
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
                  <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: '0.25rem 0 0 0' }}>
                    ⚠️ {resolutionPhotoError}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn-worker-resolve"
                  disabled={transitioning || !resolutionNotes.trim() || !selectedResolutionPhoto}
                >
                  {transitioning ? 'Uploading & Verifying...' : 'Submit Resolution & Complete Task'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Completed Resolution Details Card (when Resolved) */}
        {report.status === 'Resolved' && (
          <section className="resolution-section-card" aria-label="Completed Resolution Record">
            <h3>
              <span>✅</span> Verified Resolution Record
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)' }}>
              Completed and verified on {formatDate(report.resolved_at || report.updated_at)}
            </p>

            {report.resolution_notes && (
              <div style={{ background: 'var(--code-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-h)', display: 'block', marginBottom: '0.25rem' }}>
                  Field Sanitation Notes:
                </strong>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.5 }}>
                  {report.resolution_notes}
                </p>
              </div>
            )}

            {resolutionPhotoSignedUrl && (
              <div>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-h)', display: 'block', marginBottom: '0.5rem' }}>
                  Completion Proof Photo:
                </strong>
                <div style={{ maxWidth: '380px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <img
                    src={resolutionPhotoSignedUrl}
                    alt="Verified cleanup completion"
                    style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* Main Content Grid */}
        <div className="tracking-details-grid">
          {/* Left Column: Incident Details & Timeline */}
          <div className="tracking-main-card">
            <section className="detail-section">
              <h2>Incident Overview</h2>
              <div className="meta-badges-row">
                <span className="badge-chip">
                  🗑️ {GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}
                </span>
                <span className={`badge-chip severity-${report.severity || 'medium'}`}>
                  ⚠️ Priority: {report.severity?.toUpperCase() || 'MEDIUM'}
                </span>
              </div>

              <div className="incident-description-box">
                <h3>Reported Conditions</h3>
                <p>{report.description || 'No detailed conditions description submitted.'}</p>
              </div>

              {/* Location */}
              <div className="location-info-card">
                <span className="loc-icon" aria-hidden="true">📍</span>
                <div>
                  <strong>Site Address:</strong>
                  <p>{report.address || 'Address recorded by citizen'}</p>
                  <small style={{ color: 'var(--text)', opacity: 0.8 }}>
                    Coordinates: {report.latitude?.toFixed(5)}°, {report.longitude?.toFixed(5)}°
                  </small>
                </div>
              </div>
            </section>

            {/* Incident Photo */}
            <section className="detail-section">
              <h2>Citizen Incident Evidence</h2>
              {incidentPhotoSignedUrl ? (
                <div className="photo-view-box">
                  <img
                    src={incidentPhotoSignedUrl}
                    alt="Original reported incident"
                    className="report-photo-large"
                  />
                </div>
              ) : (
                <div className="photo-placeholder-box">
                  <span aria-hidden="true">📸</span>
                  <p>No original incident photo attached to this submission.</p>
                </div>
              )}
            </section>

            {/* Lifecycle Timeline */}
            <section className="detail-section">
              <h2>Lifecycle Status History</h2>
              <ReportTimeline key={refreshTimelineKey} reportId={report.id} />
            </section>
          </div>

          {/* Right Column: Quick Metadata Sidebar */}
          <aside className="tracking-sidebar" aria-label="Task Metadata">
            <div className="sidebar-card">
              <h3>Task Summary</h3>
              <div className="sidebar-meta-list">
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Current Status</span>
                  <span className="sidebar-meta-value">
                    <ReportStatusBadge status={report.status} size="small" />
                  </span>
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Waste Type</span>
                  <span className="sidebar-meta-value">{GARBAGE_TYPE_LABELS[report.garbage_type] || report.garbage_type}</span>
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Severity</span>
                  <span className="sidebar-meta-value" style={{ textTransform: 'uppercase' }}>{report.severity}</span>
                </div>
                <div className="sidebar-meta-row">
                  <span className="sidebar-meta-label">Assigned At</span>
                  <span className="sidebar-meta-value">{report.assigned_at ? formatDate(report.assigned_at) : 'N/A'}</span>
                </div>
                {report.accepted_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Accepted At</span>
                    <span className="sidebar-meta-value">{formatDate(report.accepted_at)}</span>
                  </div>
                )}
                {report.in_progress_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Started At</span>
                    <span className="sidebar-meta-value">{formatDate(report.in_progress_at)}</span>
                  </div>
                )}
                {report.resolved_at && (
                  <div className="sidebar-meta-row">
                    <span className="sidebar-meta-label">Resolved At</span>
                    <span className="sidebar-meta-value">{formatDate(report.resolved_at)}</span>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
