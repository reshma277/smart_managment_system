import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function UserNavbar() {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email || 'User';
  const displayRole = role ? role.toUpperCase() : 'CITIZEN';

  return (
    <header className="user-navbar" role="banner">
      <div className="user-navbar-brand">
        <span className="brand-logo" aria-hidden="true">🌱</span>
        <span className="brand-title">CleanAlert</span>
        <span className="brand-subtitle">Municipal Management</span>
      </div>

      <div className="user-navbar-actions">
        <div className="user-profile-info">
          <span className="user-name">{displayName}</span>
          <span className={`role-badge role-${role || 'citizen'}`} aria-label={`Role: ${displayRole}`}>
            {displayRole}
          </span>
        </div>

        <button 
          type="button" 
          onClick={handleSignOut} 
          className="sign-out-button"
          aria-label="Sign out of your account"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
