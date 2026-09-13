import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function UpdatePassword() {
  const { user, loading, updatePassword, error, setError } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    setError(null);

    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match. Please re-enter.');
      return;
    }

    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);

    if (result.success) {
      setUpdateSuccess(true);
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1800);
    }
  };

  const activeError = validationError || error;

  if (loading) {
    return (
      <div className="auth-loading-container" aria-live="polite">
        <div className="auth-spinner" />
        <p>Verifying recovery session...</p>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand">
            <span className="brand-icon" aria-hidden="true">🌱</span>
            <h2>CleanAlert</h2>
          </div>
          <h1>Set New Password</h1>
          <p className="auth-subtitle">Enter your replacement password below</p>
        </div>

        {/* Inform user if visiting without an active session */}
        {!user && !updateSuccess && (
          <div className="auth-info-banner" role="note">
            <strong>Note:</strong> If you did not arrive via a password reset email link, please{' '}
            <Link to="/forgot-password" className="auth-switch-link">
              request a recovery link first
            </Link>.
          </div>
        )}

        {activeError && (
          <div className="auth-alert auth-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <span>{activeError}</span>
          </div>
        )}

        {updateSuccess ? (
          <div className="auth-alert auth-alert-success" role="status">
            <span className="alert-icon" aria-hidden="true">✅</span>
            <div>
              <strong>Password updated successfully!</strong>
              <p>Your password has been changed. Redirecting to your dashboard...</p>
              <div style={{ marginTop: '0.75rem' }}>
                <Link to="/" className="auth-submit-btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Continue to Dashboard
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="form-group">
              <label htmlFor="update-password">New Password *</label>
              <div className="password-input-wrapper">
                <input
                  id="update-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <span className="form-hint">Must contain at least 6 characters</span>
            </div>

            <div className="form-group">
              <label htmlFor="update-confirm-password">Confirm New Password *</label>
              <input
                id="update-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={submitting}
            >
              {submitting ? 'Updating Password...' : 'Save New Password'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <p>
            <Link to="/login" className="auth-switch-link">
              Back to Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
