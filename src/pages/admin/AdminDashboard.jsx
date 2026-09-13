import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';

export default function AdminDashboard() {
  const { profile, user } = useAuth();
  const displayName = profile?.full_name || user?.email || 'Administrator';

  return (
    <div className="dashboard-container">
      <UserNavbar />
      <main className="dashboard-main" role="main">
        <div className="dashboard-card">
          <div className="dashboard-header">
            <span className="dashboard-icon" aria-hidden="true">🛡️</span>
            <h1>Municipal Operations Console</h1>
          </div>
          <p className="welcome-text">
            Welcome, <strong>{displayName}</strong>! Administrator session confirmed.
          </p>
          <div className="placeholder-info-box">
            <span className="info-icon" aria-hidden="true">ℹ️</span>
            <div>
              <h3>City Dispatch & Staff Management</h3>
              <p>
                The administrative command center (live PostGIS incident map, worker assignment controls, 
                and pickup schedule coordination) will be implemented in the next phase.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
