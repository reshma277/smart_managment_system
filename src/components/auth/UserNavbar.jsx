import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export default function UserNavbar() {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const userId = user?.id;
    if (!userId || (role !== 'citizen' && role !== 'worker')) return;

    let isMounted = true;

    async function getUnreadCount() {
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false);

        if (!error && count !== null && isMounted) {
          setUnreadCount(count);
        }
      } catch {
        // Silently fall back
      }
    }

    getUnreadCount();

    const channel = supabase
      .channel(`navbar-notifs-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          getUnreadCount();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [user, role]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email || 'User';
  const displayRole = role ? role.toUpperCase() : 'CITIZEN';

  const brandRoute = role === 'citizen' ? '/citizen' : role === 'worker' ? '/worker' : role === 'admin' ? '/admin' : '/';

  return (
    <header className="user-navbar" role="banner">
      <div className="user-navbar-left">
        <NavLink to={brandRoute} className="user-navbar-brand">
          <span className="brand-logo" aria-hidden="true">🌱</span>
          <span className="brand-title">CleanAlert</span>
          <span className="brand-subtitle">Municipal Management</span>
        </NavLink>

        {role === 'citizen' && (
          <nav className="user-navbar-nav" aria-label="Citizen Navigation">
            <NavLink
              to="/citizen"
              end
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Dashboard</span>
            </NavLink>
            <NavLink
              to="/citizen/report"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Report Garbage</span>
            </NavLink>
            <NavLink
              to="/citizen/reports"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>My Reports</span>
            </NavLink>
            <NavLink
              to="/citizen/notifications"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span
                  className="nav-badge"
                  aria-label={`${unreadCount} unread notifications`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          </nav>
        )}

        {role === 'worker' && (
          <nav className="user-navbar-nav" aria-label="Worker Navigation">
            <NavLink
              to="/worker"
              end
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Dashboard</span>
            </NavLink>
            <NavLink
              to="/worker/reports"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Assigned Reports</span>
            </NavLink>
            <NavLink
              to="/worker/notifications"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span
                  className="nav-badge"
                  aria-label={`${unreadCount} unread notifications`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          </nav>
        )}

        {role === 'admin' && (
          <nav className="user-navbar-nav" aria-label="Admin Navigation">
            <NavLink
              to="/admin"
              end
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Dashboard</span>
            </NavLink>
            <NavLink
              to="/admin/reports"
              className={({ isActive }) => `user-nav-link ${isActive ? 'active' : ''}`}
            >
              <span>Manage Reports</span>
            </NavLink>
          </nav>
        )}
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

