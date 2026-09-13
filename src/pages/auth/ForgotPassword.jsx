import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ForgotPassword() {
  const { user, loading, resetPassword, error, setError } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [sentSuccess, setSentSuccess] = useState(false);

  // Redirect authenticated users away from forgot password page
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    setError(null);

    if (!email.trim()) {
      setValidationError('Please enter your account email address.');
      return;
    }

    setSubmitting(true);
    const result = await resetPassword(email);
    setSubmitting(false);

    if (result.success) {
      setSentSuccess(true);
    }
  };

  const activeError = validationError || error;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand">
            <span className="brand-icon" aria-hidden="true">🌱</span>
            <h2>CleanAlert</h2>
          </div>
          <h1>Reset Password</h1>
          <p className="auth-subtitle">Enter your email and we'll send you a password recovery link</p>
        </div>

        {activeError && (
          <div className="auth-alert auth-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <span>{activeError}</span>
          </div>
        )}

        {sentSuccess ? (
          <div className="auth-alert auth-alert-success" role="status">
            <span className="alert-icon" aria-hidden="true">✉️</span>
            <div>
              <strong>Recovery link dispatched!</strong>
              <p>
                If an account exists for <strong>{email}</strong>, a password reset email has been sent.
                Follow the link in that email to choose a new password.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Link to="/login" className="auth-submit-btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Return to Sign In
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="form-group">
              <label htmlFor="reset-email">Account Email Address</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={submitting}
            >
              {submitting ? 'Sending Link...' : 'Send Recovery Link'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <p>
            Remembered your password?{' '}
            <Link to="/login" className="auth-switch-link">
              Back to Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
