import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import IncidentLocationPicker from '../../components/citizen/IncidentLocationPicker';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/report-garbage.css';

const GARBAGE_TYPES = [
  { value: 'household', label: 'Household Waste' },
  { value: 'commercial', label: 'Commercial Waste' },
  { value: 'construction', label: 'Construction / Debris' },
  { value: 'organic', label: 'Organic / Food Waste' },
  { value: 'plastic', label: 'Plastic / Recyclable Packaging' },
  { value: 'electronic', label: 'Electronic Waste (E-waste)' },
  { value: 'hazardous', label: 'Hazardous / Chemical / Biohazard' },
  { value: 'other', label: 'Other / Mixed Waste' },
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

  // Form field states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [garbageType, setGarbageType] = useState('');
  const [severity, setSeverity] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);

  // Photo upload states (Step 4)
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadSuccess, setPhotoUploadSuccess] = useState(false);
  const [uploadedPhotoPath, setUploadedPhotoPath] = useState(null);

  // Location states (Step 3) - null initially per requirements
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [locationError, setLocationError] = useState('');

  // Validation & workflow states
  const [validationErrors, setValidationErrors] = useState({});
  const [photoError, setPhotoError] = useState('');
  const [isFormReady, setIsFormReady] = useState(false);

  // Duplicate detection states (Step 5)
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState(null);
  const [noDuplicateFound, setNoDuplicateFound] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');
  const [selectedDuplicateId, setSelectedDuplicateId] = useState(null);
  const [duplicateConfirmedSame, setDuplicateConfirmedSame] = useState(false);

  // Clean up object URLs when photo changes or component unmounts
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  // Track if user has modified any field
  const isDirty = Boolean(
    title.trim() ||
    description.trim() ||
    garbageType ||
    severity ||
    selectedPhoto ||
    uploadedPhotoPath ||
    latitude !== null ||
    longitude !== null ||
    selectedDuplicateId !== null
  );

  const handleBack = () => {
    if (isDirty && !isFormReady) {
      const confirmLeave = window.confirm(
        'You have unsaved form details. Are you sure you want to discard this report and return to the dashboard?'
      );
      if (!confirmLeave) return;
    }
    navigate('/citizen');
  };

  /**
   * Uploads the selected photo to the private report-photos bucket.
   * Path format: report-photos/{authenticated-user-id}/{unique-file-name}
   */
  const uploadPhotoToStorage = async (file) => {
    if (!user?.id) {
      setPhotoError('You must be signed in to upload an incident photo.');
      return null;
    }

    setPhotoUploading(true);
    setPhotoUploadSuccess(false);
    setPhotoError('');

    // Clean up previous temporary uploaded photo if citizen replaces image
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

    // Reset file input so identical file can be re-selected if desired
    e.target.value = '';

    // Validate MIME type (JPEG, PNG, WebP only)
    if (!ALLOWED_PHOTO_MIMES.includes(file.type)) {
      setPhotoError('Unsupported format. Only JPEG, PNG, and WebP images are permitted.');
      return;
    }

    // Validate file size (max 5 MB)
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`Photo exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please select an image under 5 MB.`);
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    setSelectedPhoto(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));

    // Clear any previous photo validation error
    if (validationErrors.photo) {
      setValidationErrors((prev) => ({ ...prev, photo: undefined }));
    }

    // Trigger storage upload
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
      errors.photo = 'Photo is currently uploading. Please wait for the upload to complete before validating.';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Runs duplicate detection via check_duplicate_report RPC.
   * Proximity evaluation is performed at exactly 30 meters on the database.
   */
  const runDuplicateCheck = async () => {
    if (duplicateChecking) return;
    if (latitude === null || longitude === null) return;

    setDuplicateChecking(true);
    setDuplicateError('');
    setDuplicateResult(null);
    setNoDuplicateFound(false);
    setSelectedDuplicateId(null);
    setDuplicateConfirmedSame(false);

    try {
      const { data, error: rpcErr } = await supabase.rpc('check_duplicate_report', {
        p_latitude: latitude,
        p_longitude: longitude,
      });

      if (rpcErr) {
        console.error('Duplicate detection RPC error:', rpcErr);
        setDuplicateError('Unable to check for nearby reports right now. Please verify your connection and try again.');
        setDuplicateChecking(false);
        return;
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
          console.warn('Could not fetch additional duplicate report details:', repErr);
        }

        setDuplicateResult({
          id: row.existing_report_id,
          status: row.existing_status,
          distance: row.distance_meters,
          supportersCount: row.supporters_count,
          title: extraTitle,
          garbageType: extraType,
        });
        setNoDuplicateFound(false);
        setIsFormReady(false);
      } else {
        setDuplicateResult(null);
        setNoDuplicateFound(true);
        setIsFormReady(true);
      }
    } catch (err) {
      console.error('Duplicate detection exception:', err);
      setDuplicateError('Network error while checking for nearby reports. Please try again.');
    } finally {
      setDuplicateChecking(false);
    }
  };

  const handleConfirmSameReport = () => {
    if (!duplicateResult?.id) return;
    setSelectedDuplicateId(duplicateResult.id);
    setDuplicateConfirmedSame(true);
  };

  const handleConfirmDifferentReport = () => {
    setSelectedDuplicateId(null);
    setDuplicateConfirmedSame(false);
    setDuplicateResult(null);
    setNoDuplicateFound(true);
    setIsFormReady(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const isValid = validateForm();
    if (!isValid) {
      setIsFormReady(false);
      return;
    }

    // Step 5: Run duplicate detection before final report submission
    await runDuplicateCheck();
  };

  const handleResetForEdit = () => {
    setIsFormReady(false);
    setDuplicateResult(null);
    setDuplicateConfirmedSame(false);
    setSelectedDuplicateId(null);
  };

  return (
    <div className="report-garbage-layout">
      {/* Universal authenticated navigation bar */}
      <UserNavbar />

      <main className="report-garbage-container" role="main">
        {/* Navigation & Header */}
        <div className="report-nav-header">
          <button
            type="button"
            className="btn-back-link"
            onClick={handleBack}
            aria-label="Return to Citizen Dashboard"
          >
            <span aria-hidden="true">←</span> Back to Dashboard
          </button>
        </div>

        <header className="report-page-header">
          <div className="report-header-badge-row">
            <span className="report-header-badge">Citizen Incident Filing</span>
          </div>
          <h1>Report Garbage</h1>
          <p>
            Report an uncollected or hazardous garbage accumulation. Provide incident details below so the municipal dispatch team can prioritize and schedule cleanup.
          </p>
        </header>

        {/* Temporary Informational Ready State (Shown only after client validation succeeds) */}
        {isFormReady ? (
          <section className="report-ready-card" aria-live="polite">
            <div className="ready-card-icon" aria-hidden="true">
              ✅
            </div>
            <h2>Form Validated &amp; Ready</h2>
            <div className="ready-status-alert" role="status">
              <strong>Step 5 Duplicate Detection Completed:</strong> {noDuplicateFound ? 'No nearby duplicate report found. ' : ''}Form details, 30-meter proximity verification, pin coordinates, and photo storage path (report-photos/{user?.id || 'citizen'}/...) are validated. Live report submission will be connected in the next step.
            </div>

            <div className="report-ready-summary">
              <div className="summary-row">
                <span className="summary-row-label">Title:</span>
                <span className="summary-row-value">{title}</span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Garbage Type:</span>
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
                <span className="summary-row-label">Photo:</span>
                <span className="summary-row-value">
                  {uploadedPhotoPath ? (
                    <>
                      <span style={{ color: '#059669', fontWeight: 600 }}>✓ Uploaded</span> (report-photos/{uploadedPhotoPath})
                    </>
                  ) : selectedPhoto ? (
                    `${selectedPhoto.name} (Upload pending)`
                  ) : (
                    'None attached'
                  )}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Location:</span>
                <span className="summary-row-value">
                  {latitude !== null && longitude !== null
                    ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
                    : 'Location not selected'}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Duplicate Check:</span>
                <span className="summary-row-value" style={{ color: '#059669', fontWeight: 600 }}>
                  ✓ No nearby duplicate report found within 30m
                </span>
              </div>
            </div>

            <div className="ready-actions-row">
              <button
                type="button"
                className="btn-form-cancel"
                onClick={handleResetForEdit}
              >
                Edit Report Details
              </button>
              <button
                type="button"
                className="btn-form-submit"
                onClick={() => navigate('/citizen')}
              >
                Return to Dashboard
              </button>
            </div>
          </section>
        ) : (
          /* Report Garbage Form */
          <form
            onSubmit={handleSubmit}
            className="report-form-card"
            noValidate
            aria-label="Report garbage incident form"
          >
            {/* Duplicate Detection Confirmation Card (Step 5) */}
            {duplicateResult && (
              <section className="duplicate-alert-card" aria-live="polite">
                <div className="duplicate-card-header">
                  <span className="duplicate-icon" aria-hidden="true">📍</span>
                  <div>
                    <h3>Nearby Report Detected</h3>
                    <p>An active report was found within 30 meters of your selected incident location.</p>
                  </div>
                </div>

                <div className="duplicate-info-box">
                  {duplicateResult.title && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Report Title:</span>
                      <span className="dup-value"><strong>{duplicateResult.title}</strong></span>
                    </div>
                  )}
                  {duplicateResult.garbageType && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Garbage Type:</span>
                      <span className="dup-value">
                        {GARBAGE_TYPES.find((t) => t.value === duplicateResult.garbageType)?.label || duplicateResult.garbageType}
                      </span>
                    </div>
                  )}
                  <div className="duplicate-info-row">
                    <span className="dup-label">Status:</span>
                    <span className="dup-value dup-status-badge">{duplicateResult.status}</span>
                  </div>
                  {duplicateResult.distance !== null && duplicateResult.distance !== undefined && (
                    <div className="duplicate-info-row">
                      <span className="dup-label">Approximate Distance:</span>
                      <span className="dup-value">~{Math.round(duplicateResult.distance)} meters away</span>
                    </div>
                  )}
                  <div className="duplicate-info-row">
                    <span className="dup-label">Supporters:</span>
                    <span className="dup-value">{duplicateResult.supportersCount || 0} citizen{duplicateResult.supportersCount === 1 ? '' : 's'}</span>
                  </div>
                </div>

                {duplicateConfirmedSame ? (
                  <div className="duplicate-same-confirmed" role="status">
                    <p>
                      <strong>Existing report selected. Support action will be connected in the next step.</strong>{' '}
                      {selectedDuplicateId && (
                        <span style={{ opacity: 0.85, fontSize: '0.85rem' }}>
                          (Report ID: {selectedDuplicateId})
                        </span>
                      )}
                    </p>
                    <div className="ready-actions-row" style={{ marginTop: '0.85rem' }}>
                      <button
                        type="button"
                        className="btn-form-cancel"
                        onClick={() => {
                          setDuplicateConfirmedSame(false);
                          setSelectedDuplicateId(null);
                        }}
                      >
                        Change Selection
                      </button>
                      <button
                        type="button"
                        className="btn-form-submit"
                        onClick={() => navigate('/citizen')}
                      >
                        Return to Dashboard
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="duplicate-actions-box">
                    <p className="duplicate-question">Is this the same garbage accumulation you are reporting?</p>
                    <div className="duplicate-buttons-row">
                      <button
                        type="button"
                        id="btn-duplicate-same"
                        className="btn-duplicate-action btn-duplicate-yes"
                        onClick={handleConfirmSameReport}
                      >
                        Yes, this is the same issue
                      </button>
                      <button
                        type="button"
                        id="btn-duplicate-no"
                        className="btn-duplicate-action btn-duplicate-no"
                        onClick={handleConfirmDifferentReport}
                      >
                        No, create a new report
                      </button>
                    </div>
                  </div>
                )}
              </section>
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
                  placeholder="e.g., Overflowing dumpster behind market"
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
                  Provide a concise, descriptive summary of the incident (5–100 characters).
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
                    <option value="">-- Select severity --</option>
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
                  placeholder="Describe the waste situation, landmarks, odor, or safety concerns (min 10 characters)..."
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
                  Include relevant details such as approximate volume, blockages, or nearby landmarks.
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
                  setNoDuplicateFound(false);
                  setDuplicateError('');
                  setSelectedDuplicateId(null);
                  setDuplicateConfirmedSame(false);
                  setIsFormReady(false);
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
                <span id="location-error" className="field-error-message" role="alert" style={{ marginTop: '0.25rem' }}>
                  <span aria-hidden="true">⚠️</span> {validationErrors.location}
                </span>
              )}
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
                            <span aria-hidden="true">✓</span> Stored in report-photos/{uploadedPhotoPath}
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
                      aria-label="Select photo of garbage incident (optional)"
                      aria-describedby={photoError ? 'photo-error-msg' : 'photo-hint-msg'}
                    />
                    <div className="dropzone-inner">
                      <span className="dropzone-icon" aria-hidden="true">📸</span>
                      <p className="dropzone-title">Click or tap to choose a photo</p>
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

            {/* Duplicate Checking and Error Banners */}
            {duplicateChecking && (
              <div className="duplicate-checking-banner" role="status">
                <span className="status-spinner" aria-hidden="true" />
                <span>Checking for nearby reports...</span>
              </div>
            )}

            {duplicateError && (
              <div className="duplicate-error-banner" role="alert">
                <span>⚠️ {duplicateError}</span>
                <button
                  type="button"
                  onClick={runDuplicateCheck}
                  className="btn-retry-check"
                >
                  Retry Check
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="form-actions-row">
              <button
                type="button"
                className="btn-form-cancel"
                onClick={handleBack}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-form-submit"
                disabled={photoUploading || duplicateChecking}
              >
                <span>
                  {duplicateChecking
                    ? 'Checking for nearby reports...'
                    : photoUploading
                    ? 'Uploading Photo...'
                    : 'Review & Validate Form'}
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
