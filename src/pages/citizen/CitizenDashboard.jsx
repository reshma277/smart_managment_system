import { useState } from 'react';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import '../../styles/citizen.css';

export default function CitizenDashboard() {
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [reportNoticeVisible, setReportNoticeVisible] = useState(false);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || 'Citizen';
  const displayEmail = profile?.email || user?.email || '';

  const handleReportGarbageClick = () => {
    setReportNoticeVisible(true);
  };

  return (
    <div className="citizen-layout">
      {/* Universal authenticated navigation bar */}
      <UserNavbar />

      <main className="citizen-main-content" role="main">
        {/* Hero & Page Header */}
        <header className="citizen-hero-card">
          <div className="citizen-hero-top">
            <div className="citizen-header-info">
              <div className="citizen-header-avatar" aria-hidden="true">
                📍
              </div>
              <div className="citizen-header-text">
                <h1>Citizen Waste Portal</h1>
                <div className="citizen-meta">
                  <span>Welcome, <strong>{displayName}</strong></span>
                  {displayEmail && <span className="citizen-email">{displayEmail}</span>}
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="citizen-nav-tabs" aria-label="Citizen portal sections">
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
                aria-current={activeTab === 'overview' ? 'page' : undefined}
              >
                <span aria-hidden="true">📊</span> Overview
              </button>
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'my-reports' ? 'active' : ''}`}
                onClick={() => setActiveTab('my-reports')}
                aria-current={activeTab === 'my-reports' ? 'page' : undefined}
              >
                <span aria-hidden="true">📋</span> My Reports
              </button>
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
                onClick={() => setActiveTab('notifications')}
                aria-current={activeTab === 'notifications' ? 'page' : undefined}
              >
                <span aria-hidden="true">🔔</span> Notifications
              </button>
            </nav>
          </div>

          <p className="citizen-hero-description">
            Report public waste accumulation, track assigned municipal cleanup teams, and verify incident resolution in real time.
          </p>

          {/* Prominent Primary Action Bar */}
          <div className="citizen-actions-bar">
            <button
              type="button"
              className="btn-report-garbage"
              onClick={handleReportGarbageClick}
              aria-label="Report Garbage Incident"
            >
              <span className="btn-icon" aria-hidden="true">📢</span>
              <span>Report Garbage</span>
            </button>

            <span className="section-badge">Municipal Dispatch Area</span>
          </div>

          {/* Action Notice (shown when user clicks Report Garbage during foundation phase) */}
          {reportNoticeVisible && (
            <div className="action-notice-banner" role="status">
              <span>
                ℹ️ <strong>Incident Reporting Form:</strong> The GPS geolocation capture, camera photo upload, and 30-meter duplicate detection will be activated in the next step.
              </span>
              <button
                type="button"
                onClick={() => setReportNoticeVisible(false)}
                aria-label="Close notification"
              >
                ✕
              </button>
            </div>
          )}
        </header>

        {/* Summary-Card Placeholders (No fake numbers; shows awaiting live data state) */}
        <section aria-labelledby="summary-heading">
          <div className="section-header">
            <h2 id="summary-heading">Reports Summary</h2>
            <span className="section-badge">Awaiting Live Database Queries</span>
          </div>

          <div className="citizen-stats-grid">
            {/* Card 1: Total Reports */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Total Reports</h3>
                <div className="stat-card-icon stat-icon-total" aria-hidden="true">
                  📋
                </div>
              </div>
              <div className="stat-card-value">
                <span className="stat-placeholder-dash">—</span>
                <span className="stat-state-badge">No data</span>
              </div>
              <p className="stat-card-description">
                Total waste incidents reported by your account
              </p>
            </article>

            {/* Card 2: Active Reports */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Active Reports</h3>
                <div className="stat-card-icon stat-icon-active" aria-hidden="true">
                  ⏳
                </div>
              </div>
              <div className="stat-card-value">
                <span className="stat-placeholder-dash">—</span>
                <span className="stat-state-badge">No data</span>
              </div>
              <p className="stat-card-description">
                Reports currently pending, assigned, or in progress
              </p>
            </article>

            {/* Card 3: Resolved Reports */}
            <article className="stat-card">
              <div className="stat-card-header">
                <h3 className="stat-card-title">Resolved Reports</h3>
                <div className="stat-card-icon stat-icon-resolved" aria-hidden="true">
                  ✅
                </div>
              </div>
              <div className="stat-card-value">
                <span className="stat-placeholder-dash">—</span>
                <span className="stat-state-badge">No data</span>
              </div>
              <p className="stat-card-description">
                Incidents cleaned and verified by municipal sanitation teams
              </p>
            </article>
          </div>
        </section>

        {/* Tab Content Panels */}
        <section className="citizen-panel-card" aria-label="Selected View">
          {activeTab === 'overview' && (
            <div className="panel-empty-state">
              <span className="empty-icon" aria-hidden="true">🌱</span>
              <h3>Civic Waste Management</h3>
              <p>
                As a registered citizen, you can report unattended waste, track nearby reports, and follow progress directly through the municipal dispatch pipeline.
              </p>

              <div className="step-roadmap-grid">
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 1 — Foundation</span>
                  <h4>Citizen Dashboard</h4>
                  <p>Authenticated access, responsive navigation, and summary cards.</p>
                </div>
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 2 — Next</span>
                  <h4>Report Incident</h4>
                  <p>GPS auto-geolocation, photo capture, and 30m duplicate check.</p>
                </div>
                <div className="roadmap-item">
                  <span className="roadmap-step-badge">Step 3 — Tracking</span>
                  <h4>Live Status Updates</h4>
                  <p>Real-time status changes from Reported to Resolved.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'my-reports' && (
            <div className="panel-empty-state">
              <span className="empty-icon" aria-hidden="true">📋</span>
              <h3>My Reports</h3>
              <p>
                You haven&apos;t filed any waste incident reports yet. When you submit reports via the &quot;Report Garbage&quot; action, your submissions and their current statuses will appear here.
              </p>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="panel-empty-state">
              <span className="empty-icon" aria-hidden="true">🔔</span>
              <h3>Notifications</h3>
              <p>
                No notifications to display. You will receive alerts when your reports are assigned to workers or marked as resolved.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
