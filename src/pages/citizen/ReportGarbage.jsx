import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import IncidentLocationPicker from '../../components/citizen/IncidentLocationPicker';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/report-garbage.css';

const GARBAGE_TYPES = [
  { value: 'plastic', dbType: 'plastic', label: 'Plastic (Bottles, packaging, bags)' },
  { value: 'glass', dbType: 'general', label: 'Glass (Bottles, jars, broken glass)' },
  { value: 'can', dbType: 'general', label: 'Can (Aluminum cans, tin, metal)' },
  { value: 'trash', dbType: 'general', label: 'Trash / General Waste' },
  { value: 'organic', dbType: 'organic', label: 'Organic / Food Waste' },
  { value: 'hazardous', dbType: 'hazardous', label: 'Hazardous / Chemical / Biohazard' },
  { value: 'electronic', dbType: 'electronic', label: 'Electronic Waste (E-waste)' },
  { value: 'construction', dbType: 'construction', label: 'Construction / Debris' },
  { value: 'bulk', dbType: 'bulk', label: 'Bulk / Large Items / Furniture' },
  { value: 'other', dbType: 'general', label: 'Other / Mixed Waste' },
];

const SEVERITY_LEVELS = [
  { value: 'low', label: 'Low — Minor litter / non-blocking accumulation' },
  { value: 'medium', label: 'Medium — Noticeable pile / potential nuisance' },
  { value: 'high', label: 'High — Significant blockage / offensive odor' },
  { value: 'critical', label: 'Critical — Roadway obstruction / urgent health hazard' },
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

    setSelectedPhoto(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));

    if (validationErrors.photo) {
      setValidationErrors((prev) => ({ ...prev, photo: undefined }));
    }

    await uploadPhotoToStorage(file);
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
      errors.description = 'Description is required. Please describe the incident location and conditions.';
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
   */
  const executeSubmission = async () => {
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
      });

      if (rpcErr) {
        console.error('submit_garbage_report RPC error:', rpcErr);
        setSubmissionError('Database error occurred while submitting your report. Please try again.');
        return;
      }

      if (data?.success === false) {
        if (data.code === 'DUPLICATE_REPORT') {
          // Backend caught duplicate at submit time
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
      // Duplicate found: show warning and allow citizen to choose support or proceed
      return;
    }

    await executeSubmission();
  };

  /**
   * Citizen chooses to proceed with their own report despite nearby duplicate.
   */
  const handleProceedWithSubmission = async () => {
    setDuplicateResult(null);
    await executeSubmission();
  };

  return (
    <div className="report-garbage-layout">
      {/* Universal authenticated navigation bar */}
      <UserNavbar />

      <main className="report-garbage-container" role="main">
        {/* Navigation Header */}
        <div className="report-nav-header">
          <button
            type="button"
            className="btn-back-link"
            onClick={handleBack}
            aria-label="Return to Citizen Dashboard"
          >
            <span aria-hidden="true">&larr;</span> Back to Dashboard
          </button>
        </div>

        {/* Page Header */}
        <header className="report-page-header">
          <div className="report-header-badge-row">
            <span className="report-header-badge">Citizen Incident Filing</span>
          </div>
          <h1>Report Garbage Incident</h1>
          <p>
            Report uncollected or hazardous waste accumulation. Provide incident details below so the municipal dispatch team can prioritize and schedule field cleanup.
          </p>
        </header>

        {/* 8. Success State View */}
        {submissionResult ? (
          <section className="report-ready-card" aria-live="polite">
            <div className="ready-card-icon" aria-hidden="true">
              🎉
            </div>
            <h2>Report Submitted Successfully!</h2>
            <div className="ready-status-alert" role="status">
              Your report has been received by municipal dispatch and is now in <strong>{submissionResult.status}</strong> status.
              {submissionResult.assignedWorkerId ? ' An available cleanup worker has been auto-assigned.' : ' It will be assigned to a field crew shortly.'}
            </div>

            <div className="report-ready-summary">
              <div className="summary-row">
                <span className="summary-row-label">Report ID:</span>
                <span className="summary-row-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {submissionResult.reportId}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Title:</span>
                <span className="summary-row-value">{title}</span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Category:</span>
                <span className="summary-row-value">
                  {GARBAGE_TYPES.find((t) => t.value === garbageType)?.label || garbageType}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Severity:</span>
                <span className="summary-row-value">
                  {SEVERITY_LEVELS.find((s) => s.value === severity)?.label || severity}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Location:</span>
                <span className="summary-row-value">
                  {address.trim() || `${latitude?.toFixed(5)}°, ${longitude?.toFixed(5)}°`}
                </span>
              </div>
              {uploadedPhotoPath && (
                <div className="summary-row">
                  <span className="summary-row-label">Photo Evidence:</span>
                  <span className="summary-row-value" style={{ color: '#059669', fontWeight: 600 }}>
                    &check; Attached
                  </span>
                </div>
              )}
            </div>

            <div className="ready-actions-row">
              <button
                type="button"
                className="btn-form-submit"
                onClick={() => navigate(`/citizen/reports/${submissionResult.reportId}`)}
              >
                <span>View Report Details</span>
                <span aria-hidden="true">&rarr;</span>
              </button>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => navigate('/citizen/reports')}
              >
                Go to My Reports
              </button>
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => navigate('/citizen')}
              >
                Back to Dashboard
              </button>
            </div>
          </section>
        ) : (
          /* Main Report Garbage Form */
          <form
            onSubmit={handleSubmit}
            className="report-form-card"
            noValidate
            aria-label="Report garbage incident form"
          >
            {/* 4. Duplicate Detection Warning Banner & Action Card */}
            {duplicateResult && (
              <section className="duplicate-alert-card" aria-live="polite">
                <div className="duplicate-card-header">
                  <span className="duplicate-icon" aria-hidden="true">📍</span>
                  <div>
                    <h3>Nearby Incident Detected</h3>
                    <p>An active report was found within 30 meters of your selected incident location.</p>
                  </div>
                </div>

                <div className="duplicate-info-box">
                  {duplicateResult.title && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Existing Report:</span>
                      <span className="dup-value"><strong>{duplicateResult.title}</strong></span>
                    </div>
                  )}
                  {duplicateResult.garbageType && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Garbage Type:</span>
                      <span className="dup-value">{duplicateResult.garbageType}</span>
                    </div>
                  )}
                  <div className="duplicate-info-row">
                    <span className="dup-label">Status:</span>
                    <span className="dup-value dup-status-badge">{duplicateResult.status}</span>
                  </div>
                  {duplicateResult.distance !== null && duplicateResult.distance !== undefined && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Proximity:</span>
                      <span className="dup-value">~{Math.round(duplicateResult.distance)} meters away</span>
                    </div>
                  )}
                  <div className="duplicate-info-row">
                    <span className="dup-label">Citizens Supporting:</span>
                    <span className="dup-value">
                      {duplicateResult.supportersCount || 0} citizen{duplicateResult.supportersCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                {supportSuccess ? (
                  <div className="duplicate-same-confirmed" role="status">
                    <p>
                      <strong>✅ You are now supporting and tracking this report!</strong>
                      <br />
                      You will receive notifications as municipal teams update and resolve this incident.
                    </p>
                    <div className="ready-actions-row" style={{ marginTop: '1rem' }}>
                      <button
                        type="button"
                        className="btn-form-submit"
                        onClick={() => navigate(`/citizen/reports/${duplicateResult.id}`)}
                      >
                        View Supported Report &rarr;
                      </button>
                      <button
                        type="button"
                        className="btn-form-cancel"
                        onClick={() => navigate('/citizen')}
                      >
                        Return to Dashboard
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="duplicate-actions-box">
                    <p className="duplicate-question">
                      Is this the same incident you are reporting? You can support the existing report to help prioritize dispatch, or continue submitting your own.
                    </p>

                    {supportError && (
                      <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.75rem' }} role="alert">
                        ⚠️ {supportError}
                      </p>
                    )}

                    <div className="duplicate-buttons-row">
                      <button
                        type="button"
                        className="btn-duplicate-action btn-duplicate-yes"
                        onClick={handleSupportExistingReport}
                        disabled={supportingReport || submitting}
                      >
                        {supportingReport ? 'Supporting...' : '👍 Support Existing Report (+1)'}
                      </button>
                      <button
                        type="button"
                        className="btn-duplicate-action btn-duplicate-no"
                        onClick={handleProceedWithSubmission}
                        disabled={supportingReport || submitting}
                      >
                        {submitting ? 'Submitting...' : 'Continue Submitting My Report →'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Submission Error Banner */}
            {submissionError && (
              <div className="location-error-alert" role="alert" style={{ marginBottom: '1.25rem' }}>
                <span className="alert-icon" aria-hidden="true">⚠️</span>
                <p>{submissionError}</p>
              </div>
            )}

            {/* Fieldset: Incident Details */}
            <fieldset className="form-fieldset">
              <legend className="fieldset-legend">
                <span className="legend-icon" aria-hidden="true">📋</span> Incident Details
              </legend>

              {/* Title Field */}
              <div className="form-field-group">
                <label htmlFor="report-title">
                  <span>Report Title <span className="required-indicator" aria-hidden="true">*</span></span>
                  <span className="char-counter">{title.length}/100</span>
                </label>
                <input
                  id="report-title"
                  type="text"
                  className="form-input-text"
                  placeholder="e.g., Overflowing dumpster behind grocery store"
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
                <span id="report-title-hint" className="form-field-hint">
                  Provide a concise, descriptive title (5–100 characters).
                </span>
                {validationErrors.title && (
                  <span id="report-title-error" className="field-error-message" role="alert">
                    <span aria-hidden="true">⚠️</span> {validationErrors.title}
                  </span>
                )}
              </div>

              {/* Two Column Row: Garbage Type & Severity */}
              <div className="form-two-col">
                {/* Garbage Type Dropdown */}
                <div className="form-field-group">
                  <label htmlFor="report-garbage-type">
                    <span>Garbage Type <span className="required-indicator" aria-hidden="true">*</span></span>
                  </label>
                  <select
                    id="report-garbage-type"
                    className="form-select"
                    value={garbageType}
                    onChange={(e) => {
                      setGarbageType(e.target.value);
                      if (validationErrors.garbageType) {
                        setValidationErrors((prev) => ({ ...prev, garbageType: undefined }));
                      }
                    }}
                    aria-required="true"
                    aria-invalid={Boolean(validationErrors.garbageType)}
                    aria-describedby={validationErrors.garbageType ? 'garbage-type-error' : undefined}
                  >
                    <option value="">-- Select waste type --</option>
                    {GARBAGE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  {validationErrors.garbageType && (
                    <span id="garbage-type-error" className="field-error-message" role="alert">
                      <span aria-hidden="true">⚠️</span> {validationErrors.garbageType}
                    </span>
                  )}
                </div>

                {/* Severity Dropdown */}
                <div className="form-field-group">
                  <label htmlFor="report-severity">
                    <span>Severity Level <span className="required-indicator" aria-hidden="true">*</span></span>
                  </label>
                  <select
                    id="report-severity"
                    className="form-select"
                    value={severity}
                    onChange={(e) => {
                      setSeverity(e.target.value);
                      if (validationErrors.severity) {
                        setValidationErrors((prev) => ({ ...prev, severity: undefined }));
                      }
                    }}
                    aria-required="true"
                    aria-invalid={Boolean(validationErrors.severity)}
                    aria-describedby={validationErrors.severity ? 'severity-error' : undefined}
                  >
                    <option value="">-- Select severity level --</option>
                    {SEVERITY_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                  {validationErrors.severity && (
                    <span id="severity-error" className="field-error-message" role="alert">
                      <span aria-hidden="true">⚠️</span> {validationErrors.severity}
                    </span>
                  )}
                </div>
              </div>

              {/* Description Field */}
              <div className="form-field-group">
                <label htmlFor="report-description">
                  <span>Detailed Description <span className="required-indicator" aria-hidden="true">*</span></span>
                  <span className="char-counter">{description.length}/1000</span>
                </label>
                <textarea
                  id="report-description"
                  className="form-textarea"
                  rows={4}
                  placeholder="Describe the waste situation, landmarks, smell, or safety hazards (min 10 characters)..."
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
                <span id="report-desc-hint" className="form-field-hint">
                  Include relevant details such as approximate volume, blockages, or odor intensity.
                </span>
                {validationErrors.description && (
                  <span id="report-desc-error" className="field-error-message" role="alert">
                    <span aria-hidden="true">⚠️</span> {validationErrors.description}
                  </span>
                )}
              </div>
            </fieldset>

            {/* Fieldset: Incident Location */}
            <fieldset className="form-fieldset">
              <legend className="fieldset-legend">
                <span className="legend-icon" aria-hidden="true">📍</span> Incident Location <span className="required-indicator" aria-hidden="true">*</span>
              </legend>

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
                <span id="location-error" className="field-error-message" role="alert" style={{ marginTop: '0.5rem' }}>
                  <span aria-hidden="true">⚠️</span> {validationErrors.location}
                </span>
              )}

              {/* Location / Landmark Details Input */}
              <div className="form-field-group" style={{ marginTop: '1rem' }}>
                <label htmlFor="report-address">
                  <span>Location / Street Address / Landmark</span>
                </label>
                <input
                  id="report-address"
                  type="text"
                  className="form-input-text"
                  placeholder="e.g., Near Bus Terminal 4, behind Sunrise Supermarket"
                  maxLength={200}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <span className="form-field-hint">
                  Specify street address or landmarks to help field workers locate the waste. If left blank, GPS coordinates will be used.
                </span>
              </div>
            </fieldset>

            {/* Fieldset: Photo Evidence */}
            <fieldset className="form-fieldset">
              <legend className="fieldset-legend">
                <span className="legend-icon" aria-hidden="true">📷</span> Photo Evidence
              </legend>

              <div className="photo-upload-container">
                {selectedPhoto ? (
                  <div className="photo-preview-card">
                    <div className="photo-preview-left">
                      <div className="photo-thumbnail-wrapper">
                        {photoPreviewUrl ? (
                          <img
                            src={photoPreviewUrl}
                            alt="Selected incident preview"
                            className="photo-thumbnail"
                          />
                        ) : (
                          <span aria-hidden="true">🖼️</span>
                        )}
                      </div>
                      <div className="photo-details">
                        <span className="photo-filename">{selectedPhoto.name}</span>
                        <span className="photo-filesize">
                          {(selectedPhoto.size / 1024).toFixed(0)} KB • {selectedPhoto.type || 'image'}
                        </span>
                        {photoUploading && (
                          <span className="photo-status-tag uploading" role="status">
                            <span className="status-spinner" aria-hidden="true" /> Uploading to secure storage...
                          </span>
                        )}
                        {photoUploadSuccess && (
                          <span className="photo-status-tag success">
                            <span aria-hidden="true">&check;</span> Uploaded securely
                          </span>
                        )}
                        {photoError && (
                          <span className="photo-status-tag error" role="alert">
                            <span aria-hidden="true">⚠️</span> {photoError}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="photo-preview-actions">
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
                  <div className="photo-dropzone">
                    <input
                      id="report-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="photo-file-input"
                      onChange={handlePhotoSelect}
                      aria-label="Select photo of garbage incident"
                      aria-describedby={photoError ? 'photo-error-msg' : 'photo-hint-msg'}
                    />
                    <div className="dropzone-inner">
                      <span className="dropzone-icon" aria-hidden="true">📸</span>
                      <p className="dropzone-title">Click or tap to upload a photo</p>
                      <p id="photo-hint-msg" className="dropzone-hint">
                        JPEG, PNG, or WebP up to 5 MB. Automatically uploaded to private municipal storage.
                      </p>
                    </div>
                  </div>
                )}

                {photoError && !selectedPhoto && (
                  <span id="photo-error-msg" className="field-error-message" role="alert">
                    <span aria-hidden="true">⚠️</span> {photoError}
                  </span>
                )}

                {validationErrors.photo && (
                  <span id="photo-validation-error-msg" className="field-error-message" role="alert">
                    <span aria-hidden="true">⚠️</span> {validationErrors.photo}
                  </span>
                )}
              </div>
            </fieldset>

            {/* Duplicate Checking Indicator */}
            {duplicateChecking && (
              <div className="duplicate-checking-banner" role="status">
                <span className="status-spinner" aria-hidden="true" />
                <span>Checking for nearby reports within 30 meters...</span>
              </div>
            )}

            {duplicateError && (
              <div className="duplicate-error-banner" role="alert">
                <span>⚠️ {duplicateError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="form-actions-row">
              <button
                type="button"
                className="btn-form-cancel"
                onClick={handleBack}
                disabled={submitting || photoUploading || duplicateChecking}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-form-submit"
                disabled={submitting || photoUploading || duplicateChecking || supportingReport}
              >
                <span>
                  {submitting
                    ? 'Submitting Report...'
                    : duplicateChecking
                    ? 'Verifying Location...'
                    : photoUploading
                    ? 'Uploading Photo...'
                    : 'Submit Garbage Report'}
                </span>
                <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
