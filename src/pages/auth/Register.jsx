import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Register() {
  const { user, loading, signUp, error, setError } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  // Redirect authenticated users away from register page
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    setError(null);

    // Form validations
    if (!fullName.trim()) {
      setValidationError('Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match. Please re-enter.');
      return;
    }

    setSubmitting(true);
    const result = await signUp({
      fullName,
      email,
      phoneNumber,
      password,
    });
    setSubmitting(false);

    if (result.success) {
      if (result.sessionCreated) {
        // Immediate session: redirect directly to citizen portal
        navigate('/citizen', { replace: true });
      } else {
        // Email confirmation required by Supabase settings
        setRegistrationSuccess(true);
      }
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
          <h1>Create Citizen Account</h1>
          <p className="auth-subtitle">Join your community in keeping our city clean</p>
        </div>

        {/* Informational Role Notice */}
        <div className="auth-info-banner" role="note">
          <strong>Notice:</strong> All public registrations are created with <em>Citizen</em> access.
          Field Worker and Municipal Administrator accounts are provisioned directly by city administration.
        </div>

        {activeError && (
          <div className="auth-alert auth-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <span>{activeError}</span>
          </div>
        )}

        {registrationSuccess ? (
          <div className="auth-alert auth-alert-success" role="status">
            <span className="alert-icon" aria-hidden="true">✉️</span>
            <div>
              <strong>Verification link sent!</strong>
              <p>
                We've sent a confirmation email to <strong>{email}</strong>. 
                Please click the link in your email to activate your account, then sign in.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Link to="/login" className="auth-submit-btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Proceed to Sign In
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="form-group">
              <label htmlFor="reg-fullname">Full Name *</label>
              <input
                id="reg-fullname"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jane Doe"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-email">Email Address *</label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-phone">
                Phone Number <span className="label-optional">(Optional)</span>
              </label>
              <input
                id="reg-phone"
                type="tel"
                autoComplete="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. +1 (555) 000-0000"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-password">Password *</label>
              <div className="password-input-wrapper">
                <input
                  id="reg-password"
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
              <label htmlFor="reg-confirm-password">Confirm Password *</label>
              <input
                id="reg-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={submitting}
            >
              {submitting ? 'Creating Account...' : 'Register as Citizen'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-switch-link">
              Sign In here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
