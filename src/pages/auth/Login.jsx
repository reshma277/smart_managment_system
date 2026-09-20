import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { user, role, loading, signIn, error, setError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Clear any stale errors on component mount
  useEffect(() => {
    setError(null);
  }, [setError]);

  // Only redirect already-authenticated users when NOT actively submitting the form
  // AND once both session and role have fully resolved
  if (!submitting && !loading && user && role) {
    const destination = role === 'admin' 
      ? '/admin' 
      : role === 'worker' 
      ? '/worker' 
      : '/citizen';
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(trimmedEmail, password);

      if (result.success) {
        if (!result.isActive || result.role === 'disabled') {
          navigate('/', { replace: true });
          return;
        }

        // Redirect based on role or intended destination
        const from = location.state?.from?.pathname;
        if (from && from !== '/login') {
          navigate(from, { replace: true });
        } else {
          const destination = result.role === 'admin' 
            ? '/admin' 
            : result.role === 'worker' 
            ? '/worker' 
            : '/citizen';
          navigate(destination, { replace: true });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activeError = validationError || error;

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand & Header */}
        <div className="auth-header">
          <div className="auth-brand">
            <div className="auth-brand-tile" aria-hidden="true">
              🌱
            </div>
            <div>
              <span className="auth-brand-name">CleanAlert</span>
              <span className="auth-brand-sub">Municipal Operations</span>
            </div>
          </div>
          <div className="auth-eyebrow-wrapper">
            <span className="auth-eyebrow-chip">SECURE PORTAL ACCESS</span>
          </div>
          <h1 className="auth-main-title">Sign in to your CleanAlert account</h1>
          <p className="auth-subtitle">Access your municipal operations portal.</p>
        </div>

        {/* Role-Aware Portal Banner */}
        <div className="auth-portal-hint-box" role="note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Citizens, Field Workers, and Dispatch Administrators sign in here.</span>
        </div>

        {activeError && (
          <div className="auth-alert auth-alert-error" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <span>{activeError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="login-password">Password</label>
              <Link to="/forgot-password" className="forgot-link">
                Forgot password?
              </Link>
            </div>
            <div className="password-input-wrapper">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
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
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={submitting}
          >
            {submitting ? 'Signing In...' : 'Sign In to Portal'}
          </button>
        </form>

        <div className="auth-footer">
          <p className="auth-switch-prompt">
            Need citizen access?{' '}
            <Link to="/register" className="auth-switch-link">
              Create Citizen Account
            </Link>
          </p>
          <p className="auth-worker-note">
            Worker and Administrator accounts are provisioned directly by municipal authorities.
          </p>
        </div>
      </div>
    </div>
  );
}
