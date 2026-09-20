import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export default function UserNavbar() {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(location.pathname);

  // Automatically close mobile menu on route changes
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

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
    setMobileMenuOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const displayRole = role ? role.toUpperCase() : 'CITIZEN';

  const brandRoute = role === 'citizen' ? '/citizen' : role === 'worker' ? '/worker' : role === 'admin' ? '/admin' : '/';
  const roleSubtitle = role === 'citizen' ? 'Citizen Portal' : role === 'worker' ? 'Field Operations' : role === 'admin' ? 'Municipal Command' : 'CleanFlow Platform';

  const renderNavLinks = (isMobile = false) => {
    const linkClass = ({ isActive }) =>
      `user-nav-link ${isActive ? 'active' : ''} ${isMobile ? 'mobile-nav-link' : ''}`;

    const handleLinkClick = () => {
      if (isMobile) setMobileMenuOpen(false);
    };

    if (role === 'citizen') {
      return (
        <>
          <NavLink to="/citizen" end className={linkClass} onClick={handleLinkClick}>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/citizen/report" className={linkClass} onClick={handleLinkClick}>
            <span>Report Garbage</span>
          </NavLink>
          <NavLink to="/citizen/reports" className={linkClass} onClick={handleLinkClick}>
            <span>My Reports</span>
          </NavLink>
          <NavLink to="/citizen/notifications" className={linkClass} onClick={handleLinkClick}>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadCount} unread notifications`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        </>
      );
    }

    if (role === 'worker') {
      return (
        <>
          <NavLink to="/worker" end className={linkClass} onClick={handleLinkClick}>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/worker/reports" className={linkClass} onClick={handleLinkClick}>
            <span>Assigned Tasks</span>
          </NavLink>
          <NavLink to="/worker/notifications" className={linkClass} onClick={handleLinkClick}>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadCount} unread notifications`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        </>
      );
    }

    if (role === 'admin') {
      return (
        <>
          <NavLink to="/admin" end className={linkClass} onClick={handleLinkClick}>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/admin/map" className={linkClass} onClick={handleLinkClick}>
            <span>Dispatch Map</span>
          </NavLink>
          <NavLink to="/admin/reports" className={linkClass} onClick={handleLinkClick}>
            <span>Manage Reports</span>
          </NavLink>
          <NavLink to="/admin/workers" className={linkClass} onClick={handleLinkClick}>
            <span>Worker Management</span>
          </NavLink>
          <NavLink to="/admin/schedules" className={linkClass} onClick={handleLinkClick}>
            <span>Collection Schedules</span>
          </NavLink>
          <NavLink to="/admin/fleet" className={linkClass} onClick={handleLinkClick}>
            <span>Fleet</span>
          </NavLink>
          <NavLink to="/admin/notifications" className={linkClass} onClick={handleLinkClick}>
            <span>Alerts</span>
            {unreadCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadCount} unread alerts`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        </>
      );
    }

    return null;
  };

  return (
    <header className="user-navbar" role="banner">
      <div className="user-navbar-container">
        {/* Left: Brand Identity & Subtitle */}
        <div className="user-navbar-left">
          <NavLink to={brandRoute} className="user-navbar-brand">
            <div className="brand-icon-tile" aria-hidden="true">
              🌱
            </div>
            <div className="brand-text-block">
              <span className="brand-title">CleanAlert</span>
              <span className="brand-role-subtitle">{roleSubtitle}</span>
            </div>
          </NavLink>
        </div>

        {/* Center: Desktop Navigation */}
        <div className="user-navbar-center">
          <nav className="user-navbar-nav desktop-nav" aria-label={`${displayRole} Desktop Navigation`}>
            {renderNavLinks(false)}
          </nav>
        </div>

        {/* Right: Profile Info, Logout & Mobile Hamburger Toggle */}
        <div className="user-navbar-actions">
          <div className="user-profile-info">
            <span className="user-name" title={displayName}>{displayName}</span>
            <span className={`role-badge role-${role || 'citizen'}`} aria-label={`Role: ${displayRole}`}>
              {displayRole}
            </span>
          </div>

          <button 
            type="button" 
            onClick={handleSignOut} 
            className="sign-out-button desktop-sign-out"
            aria-label="Sign out of your account"
          >
            Sign Out
          </button>

          {/* Mobile Menu Hamburger Button */}
          <button
            type="button"
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            <span className="hamburger-icon" aria-hidden="true">
              {mobileMenuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Mobile Navigation Menu">
          <nav className="mobile-nav-links">
            {renderNavLinks(true)}
          </nav>
          <div className="mobile-nav-footer">
            <div className="mobile-user-row">
              <span className="user-name">{displayName}</span>
              <span className={`role-badge role-${role || 'citizen'}`}>{displayRole}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="sign-out-button mobile-sign-out-btn"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
