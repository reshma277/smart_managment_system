import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountDeactivated from '../components/auth/AccountDeactivated';

/**
 * Route wrapper that ensures the user is authenticated and active before accessing the route.
 * Keeps loading active until user is null OR profile/role is completely resolved.
 * Displays AccountDeactivated view if is_active === false.
 */
export default function ProtectedRoute() {
  const { user, role, loading, isDeactivated } = useAuth();
  const location = useLocation();

  // Authentication initialization remains active until user is null OR role is fully resolved
  const isAuthResolving = loading || (user !== null && role === null);

  if (isAuthResolving) {
    return (
      <div className="auth-loading-container" aria-live="polite">
        <div className="auth-spinner" />
        <p>Verifying authentication session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Intercept inactive/suspended accounts before rendering protected route content
  if (isDeactivated || role === 'disabled') {
    return <AccountDeactivated />;
  }

  return <Outlet />;
}
