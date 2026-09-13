import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AccountDeactivated() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.full_name || user?.email || 'User';

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }} aria-hidden="true">
          🚫
        </div>
        <h1 style={{ fontSize: '1.6rem', color: '#ef4444', marginBottom: '0.75rem' }}>
          Account Deactivated
        </h1>
        <p style={{ color: 'var(--text-h)', fontWeight: 500, marginBottom: '0.5rem' }}>
          Hello, {displayName}
        </p>
        <div 
          className="auth-alert auth-alert-error" 
          role="alert" 
          style={{ textAlign: 'left', margin: '1.25rem 0' }}
        >
          <span className="alert-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Access Suspended</strong>
            <p>
              Your account has been deactivated. Please contact the municipal administrator to reactivate your access.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="auth-submit-btn"
          style={{ backgroundColor: '#ef4444' }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
