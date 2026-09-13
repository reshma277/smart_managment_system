import { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { user, loading, signIn, error, setError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Redirect authenticated users away from login page
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');
    setError(null);

    // Basic client validation
    if (!email.trim()) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);

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
          <h1>Sign In to Your Account</h1>
          <p className="auth-subtitle">Municipal waste reporting & dispatch management</p>
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
              placeholder="you@example.com"
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
            {submitting ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <Link to="/register" className="auth-switch-link">
              Register as a Citizen
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
