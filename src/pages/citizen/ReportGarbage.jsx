import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import IncidentLocationPicker from '../../components/citizen/IncidentLocationPicker';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { compressIncidentPhoto } from '../../utils/imageCompression';
import '../../styles/report-garbage.css';

const GARBAGE_TYPES = [
  {
    value: 'plastic',
    dbType: 'plastic',
    label: 'Plastic (Bottles, packaging, bags)',
    shortLabel: 'Plastic',
    subtitle: 'Bottles, packaging, film, bags',
    icon: '🥤',
  },
  {
    value: 'glass',
    dbType: 'general',
    label: 'Glass (Bottles, jars, broken glass)',
    shortLabel: 'Glass',
    subtitle: 'Bottles, jars, glassware, shards',
    icon: '🍾',
  },
  {
    value: 'can',
    dbType: 'general',
    label: 'Can (Aluminum cans, tin, metal)',
    shortLabel: 'Cans / Metal',
    subtitle: 'Aluminum cans, tin, scrap metal',
    icon: '🥫',
  },
  {
    value: 'trash',
    dbType: 'general',
    label: 'Trash / General Waste',
    shortLabel: 'General Waste',
    subtitle: 'Mixed household waste & refuse',
    icon: '🗑️',
  },
  {
    value: 'organic',
    dbType: 'organic',
    label: 'Organic / Food Waste',
    shortLabel: 'Organic / Food',
    subtitle: 'Food scraps, kitchen & green waste',
    icon: '🍏',
  },
  {
    value: 'hazardous',
    dbType: 'hazardous',
    label: 'Hazardous / Chemical / Biohazard',
    shortLabel: 'Hazardous',
    subtitle: 'Chemicals, medical, sharp hazards',
    icon: '☣️',
  },
  {
    value: 'electronic',
    dbType: 'electronic',
    label: 'Electronic Waste (E-waste)',
    shortLabel: 'E-Waste',
    subtitle: 'Electronics, cords, appliances',
    icon: '💻',
  },
  {
    value: 'construction',
    dbType: 'construction',
    label: 'Construction / Debris',
    shortLabel: 'Construction',
    subtitle: 'Rubble, concrete, tiles, drywall',
    icon: '🧱',
  },
  {
    value: 'bulk',
    dbType: 'bulk',
    label: 'Bulk / Large Items / Furniture',
    shortLabel: 'Bulk / Furniture',
    subtitle: 'Mattresses, furniture, large goods',
    icon: '🛋️',
  },
  {
    value: 'other',
    dbType: 'general',
    label: 'Other / Mixed Waste',
    shortLabel: 'Other / Mixed',
    subtitle: 'Unclassified or mixed materials',
    icon: '📦',
  },
];

const SEVERITY_LEVELS = [
  {
    value: 'low',
    label: 'Low — Minor litter / non-blocking accumulation',
    title: 'Low Severity',
    subtitle: 'Minor litter or non-blocking accumulation',
    badge: 'Routine',
    colorKey: 'low',
  },
  {
    value: 'medium',
    label: 'Medium — Noticeable pile / potential nuisance',
    title: 'Medium Severity',
    subtitle: 'Noticeable pile or potential neighborhood nuisance',
    badge: 'Standard',
    colorKey: 'medium',
  },
  {
    value: 'high',
    label: 'High — Significant blockage / offensive odor',
    title: 'High Severity',
    subtitle: 'Significant blockage, overflow, or offensive odor',
    badge: 'Urgent',
    colorKey: 'high',
  },
  {
    value: 'critical',
    label: 'Critical — Roadway obstruction / urgent health hazard',
    title: 'Critical Hazard',
    subtitle: 'Roadway obstruction, toxic spill, or health hazard',
    badge: 'Emergency',
    colorKey: 'critical',
  },
];

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ReportGarbage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [garbageType, setGarbageType] = useState('');
  const [severity, setSeverity] = useState('');
  const [address, setAddress] = useState('');

  // Photo state
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadSuccess, setPhotoUploadSuccess] = useState(false);
  const [uploadedPhotoPath, setUploadedPhotoPath] = useState(null);
  const [photoError, setPhotoError] = useState('');

  // Location states
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [locationError, setLocationError] = useState('');

  // Validation & workflow states
  const [validationErrors, setValidationErrors] = useState({});
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState(null);
  const [duplicateError, setDuplicateError] = useState('');

  // Support duplicate action states
  const [supportingReport, setSupportingReport] = useState(false);
  const [supportSuccess, setSupportSuccess] = useState(false);
  const [supportError, setSupportError] = useState('');

  // Submission states
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [submissionResult, setSubmissionResult] = useState(null);

  // Clean up object URLs when preview changes or component unmounts
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  // Track unsaved modifications
  const isDirty = Boolean(
    title.trim() ||
    description.trim() ||
    garbageType ||
    severity ||
    address.trim() ||
    selectedPhoto ||
    uploadedPhotoPath ||
    latitude !== null ||
    longitude !== null
  );

  const handleBack = () => {
    if (isDirty && !submissionResult) {
      const confirmLeave = window.confirm(
        'You have unsaved form details. Are you sure you want to discard this report and return to the dashboard?'
      );
      if (!confirmLeave) return;
    }
    navigate('/citizen');
  };

  /**
   * Uploads photo to the private report-photos bucket.
   * Canonical path prefix required by RLS: report-photos/{auth.uid()}/*
   */
  const uploadPhotoToStorage = async (file) => {
    if (!user?.id) {
      setPhotoError('You must be signed in to upload an incident photo.');
      return null;
    }

    setPhotoUploading(true);
    setPhotoUploadSuccess(false);
    setPhotoError('');

    // Remove previous upload if user replaces image
    if (uploadedPhotoPath) {
      try {
        await supabase.storage.from('report-photos').remove([uploadedPhotoPath]);
      } catch (err) {
        console.warn('Could not clean up previous uploaded photo:', err);
      }
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const sanitizedExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const uniqueFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${sanitizedExt}`;
    const filePath = `${user.id}/${uniqueFileName}`;

    try {
      const { data, error: uploadErr } = await supabase.storage
        .from('report-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadErr) {
        console.error('Storage upload error:', uploadErr);
        setPhotoError(`Photo upload failed: ${uploadErr.message || 'Unable to store image.'}`);
        setPhotoUploading(false);
        return null;
      }

      setUploadedPhotoPath(data.path);
      setPhotoUploadSuccess(true);
      setPhotoUploading(false);
      return data.path;
    } catch (err) {
      console.error('Storage upload exception:', err);
      setPhotoError('Network error while uploading photo. Please try again.');
      setPhotoUploading(false);
      return null;
    }
  };

  const handlePhotoSelect = async (e) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    if (!ALLOWED_PHOTO_MIMES.includes(file.type)) {
      setPhotoError('Unsupported format. Only JPEG, PNG, and WebP images are permitted.');
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`Photo exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please select an image under 5 MB.`);
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    // Attempt client-side compression targeting <= 300KB WebP
    let fileToUpload = file;
    try {
      fileToUpload = await compressIncidentPhoto(file);
    } catch (compErr) {
      console.warn('Image compression fallback used:', compErr);
    }

    setSelectedPhoto(fileToUpload);
    setPhotoPreviewUrl(URL.createObjectURL(fileToUpload));

    if (validationErrors.photo) {
      setValidationErrors((prev) => ({ ...prev, photo: undefined }));
    }

    await uploadPhotoToStorage(fileToUpload);
  };

  const handleRemovePhoto = async () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    if (uploadedPhotoPath) {
      const pathToRemove = uploadedPhotoPath;
      setUploadedPhotoPath(null);
      try {
        await supabase.storage.from('report-photos').remove([pathToRemove]);
      } catch (err) {
        console.warn('Could not remove photo from storage:', err);
      }
    }

    setSelectedPhoto(null);
    setPhotoPreviewUrl(null);
    setPhotoUploadSuccess(false);
    setPhotoUploading(false);
    setPhotoError('');
  };

  const handleRetryUpload = () => {
    if (selectedPhoto) {
      uploadPhotoToStorage(selectedPhoto);
    }
  };

  const validateForm = () => {
    const errors = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      errors.title = 'Title is required. Please enter a brief summary.';
    } else if (trimmedTitle.length < 5) {
      errors.title = 'Title must be at least 5 characters.';
    } else if (trimmedTitle.length > 100) {
      errors.title = 'Title cannot exceed 100 characters.';
    }

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      errors.description = 'Description is required. Please describe the incident conditions and volume.';
    } else if (trimmedDesc.length < 10) {
      errors.description = 'Description must be at least 10 characters.';
    } else if (trimmedDesc.length > 1000) {
      errors.description = 'Description cannot exceed 1000 characters.';
    }

    if (!garbageType) {
      errors.garbageType = 'Please select the type of waste.';
    }

    if (!severity) {
      errors.severity = 'Please select a severity level.';
    }

    if (latitude === null || longitude === null) {
      errors.location = 'Incident location is required. Please use your current location or click on the map to pinpoint the incident.';
    }

    if (photoUploading) {
      errors.photo = 'Photo is currently uploading. Please wait for upload to finish before submitting.';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Checks for duplicate reports within 30 meters via check_duplicate_report RPC.
   */
  const checkForDuplicates = async () => {
    if (latitude === null || longitude === null) return null;

    setDuplicateChecking(true);
    setDuplicateError('');

    try {
      const { data, error: rpcErr } = await supabase.rpc('check_duplicate_report', {
        p_latitude: latitude,
        p_longitude: longitude,
      });

      if (rpcErr) {
        console.error('check_duplicate_report RPC error:', rpcErr);
        setDuplicateError('Unable to verify nearby reports right now.');
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (row?.is_duplicate && row?.existing_report_id) {
        let extraTitle = null;
        let extraType = null;

        try {
          const { data: repData } = await supabase
            .from('reports')
            .select('title, garbage_type')
            .eq('id', row.existing_report_id)
            .maybeSingle();

          if (repData) {
            extraTitle = repData.title;
            extraType = repData.garbage_type;
          }
        } catch (repErr) {
          console.warn('Could not fetch extra duplicate details:', repErr);
        }

        const result = {
          id: row.existing_report_id,
          status: row.existing_status,
          distance: row.distance_meters,
          supportersCount: row.supporters_count,
          title: extraTitle,
          garbageType: extraType,
        };
        setDuplicateResult(result);
        return result;
      }

      setDuplicateResult(null);
      return null;
    } catch (err) {
      console.error('Duplicate detection exception:', err);
      setDuplicateError('Network error while checking for nearby reports.');
      return null;
    } finally {
      setDuplicateChecking(false);
    }
  };

  /**
   * Supports an existing nearby report via support_existing_report RPC.
   */
  const handleSupportExistingReport = async () => {
    if (!duplicateResult?.id) return;

    setSupportingReport(true);
    setSupportError('');

    try {
      const { data, error: supErr } = await supabase.rpc('support_existing_report', {
        p_report_id: duplicateResult.id,
      });

      if (supErr || data?.success === false) {
        setSupportError(data?.message || 'Could not support this report. Please try again.');
      } else {
        setSupportSuccess(true);
      }
    } catch (err) {
      console.error('Support report exception:', err);
      setSupportError('Network error while supporting report.');
    } finally {
      setSupportingReport(false);
    }
  };

  /**
   * Executes atomic submission via submit_garbage_report RPC.
   * @param {boolean} confirmDuplicate - When true, bypasses duplicate block if citizen confirms distinct incident
   */
  const executeSubmission = async (confirmDuplicate = false) => {
    setSubmitting(true);
    setSubmissionError('');

    const selectedConfig = GARBAGE_TYPES.find((t) => t.value === garbageType);
    const dbGarbageType = selectedConfig?.dbType || 'general';

    // Format address text or fallback to coordinates string
    const finalAddress = address.trim() || `Incident Location (${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°)`;

    // Append custom category note for glass/can if mapped to general
    let finalDesc = description.trim();
    if (['glass', 'can'].includes(garbageType)) {
      finalDesc = `[Category: ${selectedConfig?.label?.split(' ')?.[0] || garbageType}] ${finalDesc}`;
    }

    try {
      const { data, error: rpcErr } = await supabase.rpc('submit_garbage_report', {
        p_title: title.trim(),
        p_description: finalDesc,
        p_garbage_type: dbGarbageType,
        p_severity: severity,
        p_latitude: latitude,
        p_longitude: longitude,
        p_address: finalAddress,
        p_photo_url: uploadedPhotoPath || null,
        p_confirm_duplicate: confirmDuplicate,
      });

      if (rpcErr) {
        console.error('submit_garbage_report RPC error:', rpcErr);
        setSubmissionError('Database error occurred while submitting your report. Please try again.');
        return;
      }

      if (data?.success === false) {
        if (data.code === 'DUPLICATE_REPORT') {
          setDuplicateResult({
            id: data.existing_report_id,
            status: data.existing_status,
            distance: data.distance_meters,
            supportersCount: data.supporters_count,
            title: null,
            garbageType: null,
          });
          setSubmissionError('An active report already exists within 30 meters of this spot. You can support the existing report below or adjust your location pin.');
        } else {
          setSubmissionError(data.message || 'Submission failed. Please check your details and try again.');
        }
        return;
      }

      // Success
      setSubmissionResult({
        reportId: data.report_id,
        status: data.status || 'Reported',
        assignedWorkerId: data.assigned_worker_id,
      });
    } catch (err) {
      console.error('Report submission exception:', err);
      setSubmissionError('Network error while transmitting report. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Initial submit handler: validates form, checks duplicates, and proceeds if clear.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmissionError('');

    const isValid = validateForm();
    if (!isValid) return;

    // Check duplicate
    const duplicate = await checkForDuplicates();
    if (duplicate) {
      return;
    }

    await executeSubmission();
  };

  /**
   * Citizen chooses to proceed with their own report despite nearby duplicate.
   */
  const handleProceedWithSubmission = async () => {
    setDuplicateResult(null);
    await executeSubmission(true);
  };

  return (
    <div className="report-garbage-layout">
      {/* Universal CleanAlert navbar */}
      <UserNavbar />

      <main className="report-garbage-main" role="main">
        {/* Navigation & Operational Context Bar */}
        <div className="report-nav-bar">
          <button
            type="button"
            className="report-back-btn"
            onClick={handleBack}
            aria-label="Return to Citizen Dashboard"
          >
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
          </button>

          <div className="report-header-meta">
            <span className="report-meta-pill">
              <span className="report-meta-dot" aria-hidden="true" />
              Municipal Dispatch Active
            </span>
          </div>
        </div>

        {/* Clean Base44 Product Style Page Header */}
        <header className="report-header-card">
          <div className="report-header-content">
            <div className="report-eyebrow-wrapper">
              <span className="report-eyebrow">CITIZEN REPORTING</span>
            </div>
            <h1 className="report-title">Report Garbage</h1>
            <p className="report-subtitle">
              Help keep your neighborhood clean by reporting waste accumulation to the municipal team.
            </p>
          </div>

          <div className="report-helper-badge">
            <div className="helper-badge-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="helper-badge-text">
              <span className="helper-badge-label">Reporting Guide</span>
              <span className="helper-badge-desc">Submit a location-based report with photo evidence.</span>
            </div>
          </div>
        </header>

        {/* 11. Success State View (Redesigned confirmation screen/card) */}
        {submissionResult ? (
          <section className="report-success-screen" aria-live="polite">
            <div className="success-halo-icon" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div className="success-header-block">
              <span className="success-eyebrow">SUBMISSION CONFIRMED</span>
              <h2 className="success-title">Report Submitted Successfully!</h2>
              <p className="success-desc">
                Your report has been logged with municipal sanitation dispatch and queued for field operations.
              </p>
            </div>

            <div className="success-status-pill" role="status">
              <div className="status-pill-dot" />
              <span>
                Status: <strong>{submissionResult.status}</strong>
                {submissionResult.assignedWorkerId ? ' • Worker Auto-Assigned' : ' • Dispatch Queue Assigned'}
              </span>
            </div>

            <div className="success-summary-card">
              <div className="summary-card-header">
                <span className="summary-title">Report Summary</span>
                <span className="summary-id-badge">ID: {submissionResult.reportId.slice(0, 8)}...</span>
              </div>
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-label">Title</span>
                  <span className="summary-val">{title}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Waste Classification</span>
                  <span className="summary-val">
                    {GARBAGE_TYPES.find((t) => t.value === garbageType)?.label || garbageType}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Severity Level</span>
                  <span className="summary-val">
                    {SEVERITY_LEVELS.find((s) => s.value === severity)?.label || severity}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Incident Location</span>
                  <span className="summary-val">
                    {address.trim() || `${latitude?.toFixed(5)}°, ${longitude?.toFixed(5)}°`}
                  </span>
                </div>
                {uploadedPhotoPath && (
                  <div className="summary-item">
                    <span className="summary-label">Photo Evidence</span>
                    <span className="summary-val success-photo-val">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Attached &amp; Stored Securely
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="success-actions-row">
              <button
                type="button"
                className="btn-primary-action"
                onClick={() => navigate(`/citizen/reports/${submissionResult.reportId}`)}
              >
                <span>View Report Details</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
              <button
                type="button"
                className="btn-secondary-action"
                onClick={() => navigate('/citizen/reports')}
              >
                Go to My Reports
              </button>
              <button
                type="button"
                className="btn-ghost-action"
                onClick={() => navigate('/citizen')}
              >
                Back to Dashboard
              </button>
            </div>
          </section>
        ) : (
          /* Main Reporting Workspace Form */
          <form
            onSubmit={handleSubmit}
            className="report-form-workspace"
            noValidate
            aria-label="Report garbage incident form"
          >
            {/* 9. Duplicate Detection Alert / Resolution Card */}
            {duplicateResult && (
              <section className="duplicate-alert-card" aria-live="polite">
                <div className="duplicate-card-header">
                  <div className="duplicate-icon-badge" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div className="duplicate-title-box">
                    <div className="duplicate-eyebrow">POTENTIAL EXISTING REPORT</div>
                    <h3 className="duplicate-heading">Nearby Incident Already Detected</h3>
                    <p className="duplicate-subtext">
                      An active incident was located within 30 meters of your selected coordinates.
                    </p>
                  </div>
                </div>

                <div className="duplicate-info-grid">
                  {duplicateResult.title && (
                    <div className="dup-field">
                      <span className="dup-field-label">Existing Report:</span>
                      <span className="dup-field-value strong">{duplicateResult.title}</span>
                    </div>
                  )}
                  {duplicateResult.garbageType && (
                    <div className="dup-field">
                      <span className="dup-field-label">Waste Type:</span>
                      <span className="dup-field-value">{duplicateResult.garbageType}</span>
                    </div>
                  )}
                  <div className="dup-field">
                    <span className="dup-field-label">Current Status:</span>
                    <span className="dup-status-chip">{duplicateResult.status}</span>
                  </div>
                  {duplicateResult.distance !== null && duplicateResult.distance !== undefined && (
                    <div className="dup-field">
                      <span className="dup-field-label">Proximity:</span>
                      <span className="dup-field-value">~{Math.round(duplicateResult.distance)} meters away</span>
                    </div>
                  )}
                  <div className="dup-field">
                    <span className="dup-field-label">Citizens Supporting:</span>
                    <span className="dup-field-value">
                      {duplicateResult.supportersCount || 0} citizen{duplicateResult.supportersCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                {supportSuccess ? (
                  <div className="duplicate-confirmed-box" role="status">
                    <div className="confirmed-icon">✓</div>
                    <div>
                      <strong>You are now supporting and tracking this report!</strong>
                      <p>You will receive status notifications as municipal teams update and resolve this incident.</p>
                    </div>
                    <div className="confirmed-actions">
                      <button
                        type="button"
                        className="btn-primary-action"
                        onClick={() => navigate(`/citizen/reports/${duplicateResult.id}`)}
                      >
                        View Supported Report &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn-secondary-action"
                        onClick={() => navigate('/citizen')}
                      >
                        Return to Dashboard
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="duplicate-actions-area">
                    <p className="duplicate-question-text">
                      Is this the same incident you are reporting? You can add your support (+1) to elevate municipal dispatch priority, or proceed with filing a separate report.
                    </p>

                    {supportError && (
                      <div className="field-error-message" role="alert" style={{ marginBottom: '1rem' }}>
                        <span>⚠️</span> {supportError}
                      </div>
                    )}

                    <div className="duplicate-buttons-row">
                      <button
                        type="button"
                        className="btn-support-existing"
                        onClick={handleSupportExistingReport}
                        disabled={supportingReport || submitting}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                        </svg>
                        <span>{supportingReport ? 'Supporting...' : 'Support Existing Report (+1)'}</span>
                      </button>
                      <button
                        type="button"
                        className="btn-proceed-anyway"
                        onClick={handleProceedWithSubmission}
                        disabled={supportingReport || submitting}
                      >
                        <span>{submitting ? 'Submitting...' : 'File Distinct Incident Anyway'}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Submission Error Alert */}
            {submissionError && (
              <div className="general-error-banner" role="alert">
                <div className="error-banner-icon">⚠️</div>
                <div className="error-banner-body">
                  <strong>Submission Error</strong>
                  <p>{submissionError}</p>
                </div>
              </div>
            )}

            {/* Duplicate Checking Indicator */}
            {duplicateChecking && (
              <div className="checking-indicator-banner" role="status">
                <span className="status-spinner-small" aria-hidden="true" />
                <span>Scanning 30-meter radius for existing municipal reports...</span>
              </div>
            )}

            {/* Duplicate Error Banner */}
            {duplicateError && (
              <div className="checking-error-banner" role="alert">
                <span>⚠️ {duplicateError}</span>
              </div>
            )}

            {/* Balanced Two-Column Desktop Workspace */}
            <div className="workspace-columns-layout">
              {/* LEFT / LARGER COLUMN: Details, Waste Classification, Severity */}
              <div className="workspace-column left-column">
                {/* Section Card: Incident Details */}
                <section className="form-section-card">
                  <div className="section-card-header">
                    <div className="section-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="section-card-title">Incident Details</h2>
                      <p className="section-card-sub">Provide a clear title and context for municipal dispatch crews</p>
                    </div>
                  </div>

                  {/* Title Field */}
                  <div className="form-field-item">
                    <div className="form-label-row">
                      <label htmlFor="report-title" className="form-label">
                        Report Title <span className="req-star" aria-hidden="true">*</span>
                      </label>
                      <span className="char-counter">{title.length}/100</span>
                    </div>
                    <input
                      id="report-title"
                      type="text"
                      className={`form-input-text ${validationErrors.title ? 'input-invalid' : ''}`}
                      placeholder="e.g., Overflowing dumpster behind grocery market"
                      maxLength={100}
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (validationErrors.title) {
                          setValidationErrors((prev) => ({ ...prev, title: undefined }));
                        }
                      }}
                      aria-required="true"
                      aria-invalid={Boolean(validationErrors.title)}
                      aria-describedby={validationErrors.title ? 'report-title-error' : 'report-title-hint'}
                    />
                    <span id="report-title-hint" className="field-hint">
                      Provide a concise, descriptive title (5–100 characters).
                    </span>
                    {validationErrors.title && (
                      <span id="report-title-error" className="field-error-message" role="alert">
                        <span aria-hidden="true">⚠️</span> {validationErrors.title}
                      </span>
                    )}
                  </div>

                  {/* Description Field */}
                  <div className="form-field-item">
                    <div className="form-label-row">
                      <label htmlFor="report-description" className="form-label">
                        Detailed Description <span className="req-star" aria-hidden="true">*</span>
                      </label>
                      <span className="char-counter">{description.length}/1000</span>
                    </div>
                    <textarea
                      id="report-description"
                      className={`form-textarea ${validationErrors.description ? 'input-invalid' : ''}`}
                      rows={4}
                      placeholder="Describe the waste situation, volume, smell, access restrictions, or public safety hazards..."
                      maxLength={1000}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        if (validationErrors.description) {
                          setValidationErrors((prev) => ({ ...prev, description: undefined }));
                        }
                      }}
                      aria-required="true"
                      aria-invalid={Boolean(validationErrors.description)}
                      aria-describedby={validationErrors.description ? 'report-desc-error' : 'report-desc-hint'}
                    />
                    <span id="report-desc-hint" className="field-hint">
                      Include relevant details such as approximate volume, blockages, or odor intensity (min 10 characters).
                    </span>
                    {validationErrors.description && (
                      <span id="report-desc-error" className="field-error-message" role="alert">
                        <span aria-hidden="true">⚠️</span> {validationErrors.description}
                      </span>
                    )}
                  </div>
                </section>

                {/* Section Card: Waste Classification */}
                <section className="form-section-card">
                  <div className="section-card-header">
                    <div className="section-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="section-card-title">
                        Waste Classification <span className="req-star" aria-hidden="true">*</span>
                      </h2>
                      <p className="section-card-sub">Select the primary material to ensure appropriate vehicle dispatch</p>
                    </div>
                  </div>

                  {/* Polished Grid of Actual Garbage Types */}
                  <div className="garbage-types-grid" role="radiogroup" aria-label="Waste classification categories">
                    {GARBAGE_TYPES.map((item) => {
                      const isSelected = garbageType === item.value;
                      return (
                        <div
                          key={item.value}
                          className={`garbage-type-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setGarbageType(item.value);
                            if (validationErrors.garbageType) {
                              setValidationErrors((prev) => ({ ...prev, garbageType: undefined }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setGarbageType(item.value);
                              if (validationErrors.garbageType) {
                                setValidationErrors((prev) => ({ ...prev, garbageType: undefined }));
                              }
                            }
                          }}
                          role="radio"
                          tabIndex={0}
                          aria-checked={isSelected}
                        >
                          <div className="type-card-top">
                            <span className="type-card-icon" aria-hidden="true">{item.icon}</span>
                            <span className={`type-check-bubble ${isSelected ? 'active' : ''}`} aria-hidden="true">
                              {isSelected ? '✓' : ''}
                            </span>
                          </div>
                          <div className="type-card-info">
                            <span className="type-card-title">{item.shortLabel}</span>
                            <span className="type-card-desc">{item.subtitle}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {validationErrors.garbageType && (
                    <span className="field-error-message" role="alert" style={{ marginTop: '0.75rem' }}>
                      <span aria-hidden="true">⚠️</span> {validationErrors.garbageType}
                    </span>
                  )}
                </section>

                {/* Section Card: Severity Level */}
                <section className="form-section-card">
                  <div className="section-card-header">
                    <div className="section-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="section-card-title">
                        Severity Level <span className="req-star" aria-hidden="true">*</span>
                      </h2>
                      <p className="section-card-sub">Indicate urgency to help dispatch teams prioritize high-risk hazards</p>
                    </div>
                  </div>

                  {/* 4 Polished Severity Cards */}
                  <div className="severity-levels-grid" role="radiogroup" aria-label="Severity level options">
                    {SEVERITY_LEVELS.map((level) => {
                      const isSelected = severity === level.value;
                      return (
                        <div
                          key={level.value}
                          className={`severity-card ${level.colorKey} ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSeverity(level.value);
                            if (validationErrors.severity) {
                              setValidationErrors((prev) => ({ ...prev, severity: undefined }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSeverity(level.value);
                              if (validationErrors.severity) {
                                setValidationErrors((prev) => ({ ...prev, severity: undefined }));
                              }
                            }
                          }}
                          role="radio"
                          tabIndex={0}
                          aria-checked={isSelected}
                        >
                          <div className="severity-card-head">
                            <div className="severity-indicator-group">
                              <span className={`severity-dot ${level.colorKey}`} aria-hidden="true" />
                              <span className="severity-name">{level.title}</span>
                            </div>
                            <span className={`severity-badge ${level.colorKey}`}>{level.badge}</span>
                          </div>
                          <p className="severity-desc">{level.subtitle}</p>
                          <div className="severity-card-footer">
                            <span className={`severity-select-tag ${isSelected ? 'active' : ''}`}>
                              {isSelected ? '✓ Selected' : 'Select'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {validationErrors.severity && (
                    <span className="field-error-message" role="alert" style={{ marginTop: '0.75rem' }}>
                      <span aria-hidden="true">⚠️</span> {validationErrors.severity}
                    </span>
                  )}
                </section>
              </div>

              {/* RIGHT / SUPPORTING COLUMN: Incident Location & Photo Evidence */}
              <div className="workspace-column right-column">
                {/* Section Card: Incident Location */}
                <section className="form-section-card location-card">
                  <div className="section-card-header">
                    <div className="section-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="section-card-title">
                        Incident Location <span className="req-star" aria-hidden="true">*</span>
                      </h2>
                      <p className="section-card-sub">Pinpoint coordinates to guide collection trucks and field crews</p>
                    </div>
                  </div>

                  {/* Leaflet Map & GPS Toolbar */}
                  <IncidentLocationPicker
                    latitude={latitude}
                    longitude={longitude}
                    onLocationChange={({ lat, lng }) => {
                      setLatitude(lat);
                      setLongitude(lng);
                      setDuplicateResult(null);
                      setDuplicateError('');
                      setSubmissionError('');
                      if (validationErrors.location) {
                        setValidationErrors((prev) => ({ ...prev, location: undefined }));
                      }
                    }}
                    locationStatus={locationStatus}
                    setLocationStatus={setLocationStatus}
                    locationError={locationError}
                    setLocationError={setLocationError}
                  />

                  {validationErrors.location && (
                    <span className="field-error-message" role="alert" style={{ marginTop: '0.5rem' }}>
                      <span aria-hidden="true">⚠️</span> {validationErrors.location}
                    </span>
                  )}

                  {/* Street Address / Landmark Input Field */}
                  <div className="form-field-item address-field-item">
                    <label htmlFor="report-address" className="form-label">
                      Street Address or Landmark <span className="optional-tag">(Optional)</span>
                    </label>
                    <input
                      id="report-address"
                      type="text"
                      className="form-input-text"
                      placeholder="e.g., Near Bus Terminal 4, behind Green Mart"
                      maxLength={200}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                    <span className="field-hint">
                      Provide visible landmarks to help drivers navigate quickly. If left blank, GPS coordinates will be used.
                    </span>
                  </div>
                </section>

                {/* Section Card: Photo Evidence */}
                <section className="form-section-card photo-card">
                  <div className="section-card-header">
                    <div className="section-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="section-card-title">Photo Evidence</h2>
                      <p className="section-card-sub">Upload an image of the waste accumulation to accelerate dispatch review</p>
                    </div>
                  </div>

                  <div className="photo-upload-workspace">
                    {selectedPhoto ? (
                      <div className="photo-preview-box">
                        <div className="preview-top-row">
                          <div className="preview-img-frame">
                            {photoPreviewUrl ? (
                              <img
                                src={photoPreviewUrl}
                                alt="Selected incident preview"
                                className="preview-img"
                              />
                            ) : (
                              <span aria-hidden="true">🖼️</span>
                            )}
                          </div>
                          <div className="preview-meta">
                            <span className="preview-filename">{selectedPhoto.name}</span>
                            <span className="preview-filesize">
                              {(selectedPhoto.size / 1024).toFixed(0)} KB • {selectedPhoto.type || 'image'}
                            </span>
                            {photoUploading && (
                              <span className="upload-tag uploading" role="status">
                                <span className="status-spinner-small" aria-hidden="true" />
                                Uploading to secure storage...
                              </span>
                            )}
                            {photoUploadSuccess && (
                              <span className="upload-tag success">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                Uploaded securely
                              </span>
                            )}
                            {photoError && (
                              <span className="upload-tag error" role="alert">
                                <span>⚠️</span> {photoError}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="preview-action-row">
                          {photoError && (
                            <button
                              type="button"
                              className="btn-retry-upload"
                              onClick={handleRetryUpload}
                              disabled={photoUploading}
                            >
                              Retry Upload
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-remove-photo"
                            onClick={handleRemovePhoto}
                            disabled={photoUploading}
                            aria-label="Remove selected photo"
                          >
                            Remove Photo
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="photo-dropzone-box">
                        <input
                          id="report-photo-input"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="dropzone-file-input"
                          onChange={handlePhotoSelect}
                          aria-label="Select photo of garbage incident"
                          aria-describedby={photoError ? 'photo-error-msg' : 'photo-hint-msg'}
                        />
                        <div className="dropzone-inner-content">
                          <div className="dropzone-icon-circle" aria-hidden="true">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </div>
                          <p className="dropzone-main-text">Click or tap to upload photo</p>
                          <p id="photo-hint-msg" className="dropzone-sub-text">
                            JPEG, PNG, or WebP up to 5 MB. Uploaded securely to private municipal storage.
                          </p>
                        </div>
                      </div>
                    )}

                    {photoError && !selectedPhoto && (
                      <span id="photo-error-msg" className="field-error-message" role="alert" style={{ marginTop: '0.5rem' }}>
                        <span aria-hidden="true">⚠️</span> {photoError}
                      </span>
                    )}

                    {validationErrors.photo && (
                      <span id="photo-validation-error-msg" className="field-error-message" role="alert" style={{ marginTop: '0.5rem' }}>
                        <span aria-hidden="true">⚠️</span> {validationErrors.photo}
                      </span>
                    )}
                  </div>
                </section>
              </div>
            </div>

            {/* 10. Submit Area (Clear final action area) */}
            <div className="report-submit-bar">
              <div className="submit-assurance-box">
                <div className="assurance-icon-circle" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div className="assurance-text">
                  <span className="assurance-title">Municipal Dispatch Guarantee</span>
                  <span className="assurance-desc">
                    Reports are logged in realtime with municipal field crews. You will receive notifications as work progresses.
                  </span>
                </div>
              </div>

              <div className="submit-actions-group">
                <button
                  type="button"
                  className="btn-cancel-report"
                  onClick={handleBack}
                  disabled={submitting || photoUploading || duplicateChecking}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit-report"
                  disabled={submitting || photoUploading || duplicateChecking || supportingReport}
                >
                  {submitting || duplicateChecking || photoUploading ? (
                    <span className="status-spinner-small" aria-hidden="true" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                  <span>
                    {submitting
                      ? 'Submitting Report...'
                      : duplicateChecking
                      ? 'Verifying Location...'
                      : photoUploading
                      ? 'Uploading Photo...'
                      : 'Submit Report'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
