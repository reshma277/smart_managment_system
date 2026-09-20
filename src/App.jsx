import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import RoleGuard from './routes/RoleGuard';
import AccountDeactivated from './components/auth/AccountDeactivated';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import UpdatePassword from './pages/auth/UpdatePassword';

import CitizenDashboard from './pages/citizen/CitizenDashboard';
import ReportGarbage from './pages/citizen/ReportGarbage';
import MyReports from './pages/citizen/MyReports';
import ReportDetails from './pages/citizen/ReportDetails';
import CitizenNotifications from './pages/citizen/CitizenNotifications';
import WorkerDashboard from './pages/worker/WorkerDashboard';
import WorkerReports from './pages/worker/WorkerReports';
import WorkerReportDetails from './pages/worker/WorkerReportDetails';
import WorkerNotifications from './pages/worker/WorkerNotifications';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminReports from './pages/admin/AdminReports';
import AdminReportDetails from './pages/admin/AdminReportDetails';
import AdminWorkers from './pages/admin/AdminWorkers';
import AdminSchedules from './pages/admin/AdminSchedules';
import AdminDispatchMap from './pages/admin/AdminDispatchMap';
import AdminNotifications from './pages/admin/AdminNotifications';
import AdminFleet from './pages/admin/AdminFleet';

import './styles/auth.css';

/**
 * Handles root (/) navigation based on authentication status and user role.
 * Maintains loading state until both user and role are resolved to prevent race conditions.
 */
function RootRedirect() {
  const { user, role, loading, isDeactivated } = useAuth();

  // Keep loading active until auth and role are completely resolved
  const isAuthResolving = loading || (user !== null && role === null);

  if (isAuthResolving) {
    return (
      <div className="auth-loading-container" aria-live="polite">
        <div className="auth-spinner" />
        <p>Loading application session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Suspended or deactivated profiles must not be routed to any role dashboard
  if (isDeactivated || role === 'disabled') {
    return <AccountDeactivated />;
  }

  if (role === 'admin') {
    return <Navigate to="/admin" replace />;
  }
  if (role === 'worker') {
    return <Navigate to="/worker" replace />;
  }
  if (role === 'citizen') {
    return <Navigate to="/citizen" replace />;
  }
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root Route with Dynamic Role Redirection */}
        <Route path="/" element={<RootRedirect />} />

        {/* Public Authentication Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/update-password" element={<UpdatePassword />} />

        {/* Protected Citizen Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<RoleGuard allowedRoles={['citizen']} />}>
            <Route path="/citizen" element={<CitizenDashboard />} />
            <Route path="/citizen/report" element={<ReportGarbage />} />
            <Route path="/citizen/reports" element={<MyReports />} />
            <Route path="/citizen/notifications" element={<CitizenNotifications />} />
          </Route>
          <Route element={<RoleGuard allowedRoles={['citizen', 'admin']} />}>
            <Route path="/citizen/reports/:reportId" element={<ReportDetails />} />
          </Route>
        </Route>

        {/* Protected Field Worker Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<RoleGuard allowedRoles={['worker']} />}>
            <Route path="/worker" element={<WorkerDashboard />} />
            <Route path="/worker/dashboard" element={<WorkerDashboard />} />
            <Route path="/worker/reports" element={<WorkerReports />} />
            <Route path="/worker/reports/:reportId" element={<WorkerReportDetails />} />
            <Route path="/worker/notifications" element={<WorkerNotifications />} />
          </Route>
        </Route>

        {/* Protected Municipal Admin Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<RoleGuard allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/reports/:reportId" element={<AdminReportDetails />} />
            <Route path="/admin/map" element={<AdminDispatchMap />} />
            <Route path="/admin/workers" element={<AdminWorkers />} />
            <Route path="/admin/schedules" element={<AdminSchedules />} />
            <Route path="/admin/fleet" element={<AdminFleet />} />
            <Route path="/admin/notifications" element={<AdminNotifications />} />
          </Route>
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
