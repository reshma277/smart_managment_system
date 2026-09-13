import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';

export default function WorkerDashboard() {
  const { profile, user } = useAuth();
  const displayName = profile?.full_name || user?.email || 'Field Worker';

  return (
    <div className="dashboard-container">
      <UserNavbar />
      <main className="dashboard-main" role="main">
        <div className="dashboard-card">
          <div className="dashboard-header">
            <span className="dashboard-icon" aria-hidden="true">🚛</span>
            <h1>Field Worker Operations</h1>
          </div>
          <p className="welcome-text">
            Welcome, <strong>{displayName}</strong>! Worker credentials verified.
          </p>
          <div className="placeholder-info-box">
            <span className="info-icon" aria-hidden="true">ℹ️</span>
            <div>
              <h3>Assigned Tasks Queue & Resolution</h3>
              <p>
                The field worker dispatch queue (duty status toggle, task navigation, and completion photo upload) 
                will be implemented in the next phase.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
