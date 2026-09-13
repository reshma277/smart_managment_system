import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import IncidentLocationPicker from '../../components/citizen/IncidentLocationPicker';
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
const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export default function ReportGarbage() {
  const navigate = useNavigate();

  // Form field states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [garbageType, setGarbageType] = useState('');
  const [severity, setSeverity] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);

  // Location states (Step 3) - null initially per requirements
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [locationError, setLocationError] = useState('');

  // Validation & workflow states
  const [validationErrors, setValidationErrors] = useState({});
  const [photoError, setPhotoError] = useState('');
  const [isFormReady, setIsFormReady] = useState(false);

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
    latitude !== null ||
    longitude !== null
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

  const handlePhotoSelect = (e) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate MIME type
    if (!ALLOWED_PHOTO_MIMES.includes(file.type) && !file.type.startsWith('image/')) {
      setPhotoError('Unsupported file format. Please choose an image (JPEG, PNG, or WebP).');
      return;
    }

    // Validate file size
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`Photo exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please select a smaller image.`);
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
  };

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setSelectedPhoto(null);
    setPhotoPreviewUrl(null);
    setPhotoError('');
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

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const isValid = validateForm();
    if (!isValid) {
      setIsFormReady(false);
      return;
    }

    // Per Phase 2 Step 3 requirements:
    // DO NOT send data to Supabase yet.
    // Display temporary informational state confirming validation success.
    setIsFormReady(true);
  };

  const handleResetForEdit = () => {
    setIsFormReady(false);
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
              <strong>Step 3 Location Foundation Completed:</strong> Form details and pin coordinates are validated. 30-meter duplicate detection, photo upload to Supabase Storage, and live report submission will be connected in the next implementation steps.
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
                  {selectedPhoto ? `${selectedPhoto.name} (${(selectedPhoto.size / 1024).toFixed(0)} KB)` : 'None attached'}
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
                        <span className="photo-status-tag">
                          ✓ Image selected locally (upload to storage enabled next)
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-remove-photo"
                      onClick={handleRemovePhoto}
                      aria-label="Remove selected photo"
                    >
                      Remove Photo
                    </button>
                  </div>
                ) : (
                  <div className="photo-dropzone">
                    <input
                      id="report-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      className="photo-file-input"
                      onChange={handlePhotoSelect}
                      aria-label="Select photo of garbage incident (optional)"
                      aria-describedby={photoError ? 'photo-error-msg' : 'photo-hint-msg'}
                    />
                    <div className="dropzone-inner">
                      <span className="dropzone-icon" aria-hidden="true">📸</span>
                      <p className="dropzone-title">Click or tap to choose a photo</p>
                      <p id="photo-hint-msg" className="dropzone-hint">
                        JPEG, PNG, or WebP up to 5 MB. Image upload will be handled securely in the next step.
                      </p>
                    </div>
                  </div>
                )}

                {photoError && (
                  <span id="photo-error-msg" className="field-error-message" role="alert">
                    <span aria-hidden="true">⚠️</span> {photoError}
                  </span>
                )}
              </div>
            </fieldset>

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
              >
                <span>Review &amp; Validate Form</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
