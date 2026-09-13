import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';

export default function CitizenDashboard() {
  const { profile, user } = useAuth();
  const displayName = profile?.full_name || user?.email || 'Citizen';

  return (
    <div className="dashboard-container">
      <UserNavbar />
      <main className="dashboard-main" role="main">
        <div className="dashboard-card">
          <div className="dashboard-header">
            <span className="dashboard-icon" aria-hidden="true">📍</span>
            <h1>Citizen Portal</h1>
          </div>
          <p className="welcome-text">
            Welcome, <strong>{displayName}</strong>! Your account has been authenticated successfully.
          </p>
          <div className="placeholder-info-box">
            <span className="info-icon" aria-hidden="true">ℹ️</span>
            <div>
              <h3>Citizen Garbage Reporting & History</h3>
              <p>
                The complete citizen waste reporting system (GPS incident capture, 30-meter duplicate detection, 
                and live status tracking) will be implemented in the next phase.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
