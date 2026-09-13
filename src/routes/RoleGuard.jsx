import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountDeactivated from '../components/auth/AccountDeactivated';

/**
 * Route wrapper that restricts access based on the authenticated user's role.
 * Maintains loading state until both user and role are completely resolved,
 * preventing premature redirection to default routes.
 */
export default function RoleGuard({ allowedRoles = [] }) {
  const { user, role, loading, isDeactivated } = useAuth();

  // Loading state remains active while auth initializes OR while role is resolving
  const isAuthResolving = loading || (user !== null && role === null);

  if (isAuthResolving) {
    return (
      <div className="auth-loading-container" aria-live="polite">
        <div className="auth-spinner" />
        <p>Verifying role authorization...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Deactivated users are blocked from all role routes
  if (isDeactivated || role === 'disabled') {
    return <AccountDeactivated />;
  }

  // Check if user's current role is permitted for this route
  const isAllowed = allowedRoles.includes(role);

  if (!isAllowed) {
    // Route user to their own role-appropriate landing page
    const destination = role === 'admin' 
      ? '/admin' 
      : role === 'worker' 
      ? '/worker' 
      : role === 'citizen'
      ? '/citizen'
      : '/login';

    return <Navigate to={destination} replace />;
  }

  return <Outlet />;
}
