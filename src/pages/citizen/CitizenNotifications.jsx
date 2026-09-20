import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen-tracking.css';

const NOTIFICATION_TYPE_CONFIG = {
  status_update: { label: 'Status Update', icon: '🔄', badgeClass: 'badge-status' },
  assignment: { label: 'Dispatch Assigned', icon: '👷', badgeClass: 'badge-dispatch' },
  resolution: { label: 'Cleanup Resolved', icon: '✅', badgeClass: 'badge-resolution' },
  support_confirmation: { label: 'Support Confirmed', icon: '🤝', badgeClass: 'badge-support' },
  report_update: { label: 'Report Update', icon: '📋', badgeClass: 'badge-status' },
};

function getNotificationTypeMeta(type) {
  return (
    NOTIFICATION_TYPE_CONFIG[type] || {
      label: type ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Notification',
      icon: '🔔',
      badgeClass: 'badge-general',
    }
  );
}

export default function CitizenNotifications() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' or 'unread'
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let isMounted = true;

    async function loadNotifications() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('notifications')
          .select('id, user_id, report_id, title, message, type, is_read, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching notifications:', fetchErr);
          if (isMounted) setError('Unable to load notifications. Please try again.');
          return;
        }

        if (isMounted) {
          setNotifications(data || []);
          setError(null);
        }
      } catch (err) {
        console.error('Notifications exception:', err);
        if (isMounted) setError('Network error while retrieving notifications.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadNotifications();

    // Realtime subscription on citizen notifications
    const notifChannel = supabase
      .channel(`citizen-notifs-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(notifChannel);
    };
  }, [user, refreshKey]);

  // Handle clicking a notification card
  const handleNotificationClick = async (notif) => {
    // 1. Mark as read if currently unread
    if (!notif.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );

      try {
        await supabase.rpc('mark_notification_read', {
          p_notification_id: notif.id,
        });
      } catch (err) {
        console.error('mark_notification_read exception:', err);
      }
    }

    // 2. Navigate to linked report if present
    if (notif.report_id) {
      navigate(`/citizen/reports/${notif.report_id}`);
    }
  };

  // Mark single notification read using existing RPC: mark_notification_read(p_notification_id)
  const handleMarkSingleRead = async (e, notificationId) => {
    e.stopPropagation(); // Prevent card navigation

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
    );

    try {
      const { error: rpcErr } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
      });

      if (rpcErr) {
        console.error('mark_notification_read error:', rpcErr);
      }
    } catch (err) {
      console.error('Exception marking notification read:', err);
    }
  };

  // Mark all notifications read using existing RPC: mark_all_notifications_read()
  const handleMarkAllRead = async () => {
    if (markingAll || unreadCount === 0) return;

    setMarkingAll(true);

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    try {
      const { error: rpcErr } = await supabase.rpc('mark_all_notifications_read');

      if (rpcErr) {
        console.error('mark_all_notifications_read error:', rpcErr);
      }
    } catch (err) {
      console.error('Exception marking all read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const displayedNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.is_read;
    return true;
  });

  return (
    <div className="citizen-layout">
      {/* Universal CleanAlert header */}
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Navigation Breadcrumb / Operational Bar */}
        <div className="tracking-nav-bar">
          <Link to="/citizen" className="btn-tracking-back">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Dashboard</span>
          </Link>

          <div className="tracking-header-meta">
            <span className="tracking-meta-pill">
              <span className="tracking-meta-dot" aria-hidden="true" />
              Realtime Inbox Live
            </span>
          </div>
        </div>

        {/* CleanAlert Base44 Page Header */}
        <header className="tracking-header-card">
          <div className="tracking-header-content">
            <div className="tracking-eyebrow-wrapper">
              <span className="tracking-eyebrow">NOTIFICATIONS</span>
            </div>
            <h1 className="tracking-title">Notifications</h1>
            <p className="tracking-subtitle">
              Stay updated on your reports and municipal cleanup activity.
            </p>
          </div>

          <div className="tracking-header-actions">
            <button
              type="button"
              className="btn-mark-all-pill"
              onClick={handleMarkAllRead}
              disabled={markingAll || unreadCount === 0}
              title={unreadCount === 0 ? 'No unread notifications' : 'Mark all alerts as read'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{markingAll ? 'Marking read...' : `Mark all as read (${unreadCount})`}</span>
            </button>
          </div>
        </header>

        {/* Segmented Filter Bar */}
        <section className="reports-filter-section" aria-label="Notification view filters">
          <div className="filter-segmented-bar" role="tablist" aria-label="Filter notifications">
            <button
              type="button"
              role="tab"
              className={`filter-segment-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
              aria-selected={activeTab === 'all'}
            >
              <span>All Alerts</span>
              <span className="filter-count-badge">{notifications.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`filter-segment-btn ${activeTab === 'unread' ? 'active' : ''}`}
              onClick={() => setActiveTab('unread')}
              aria-selected={activeTab === 'unread'}
            >
              <span>Unread Only</span>
              <span className="filter-count-badge">{unreadCount}</span>
            </button>
          </div>
        </section>

        {/* Loading State */}
        {loading && (
          <div className="state-card-box" aria-live="polite">
            <div className="clean-spinner" />
            <h2 className="state-card-title">Loading notifications...</h2>
            <p className="state-card-desc">Checking for dispatch updates and resolution alerts.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-card-box error" role="alert">
            <div className="state-card-icon error-icon" aria-hidden="true">⚠️</div>
            <h2 className="state-card-title">Error Loading Notifications</h2>
            <p className="state-card-desc">{error}</p>
            <button
              type="button"
              className="btn-retry-action"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State: No notifications at all */}
        {!loading && !error && notifications.length === 0 && (
          <div className="state-card-box">
            <div className="state-card-icon" aria-hidden="true">🔔</div>
            <h2 className="state-card-title">You&apos;re all caught up</h2>
            <p className="state-card-desc">
              When municipal workers update dispatch or resolve your submitted reports, real-time alerts will appear here.
            </p>
            <button
              type="button"
              className="btn-state-cta"
              onClick={() => navigate('/citizen/report')}
            >
              <span>Report Garbage</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        )}

        {/* Unread Empty State */}
        {!loading && !error && notifications.length > 0 && displayedNotifications.length === 0 && (
          <div className="state-card-box">
            <div className="state-card-icon" aria-hidden="true">✅</div>
            <h2 className="state-card-title">You&apos;re all caught up!</h2>
            <p className="state-card-desc">You have no unread notifications in your inbox.</p>
            <div className="state-actions-cluster">
              <button
                type="button"
                className="btn-clear-filters"
                onClick={() => setActiveTab('all')}
              >
                View All Notifications
              </button>
            </div>
          </div>
        )}

        {/* Notification Feed */}
        {!loading && !error && displayedNotifications.length > 0 && (
          <div className="notifications-feed-list" role="feed" aria-label="Notifications inbox">
            {displayedNotifications.map((notif) => {
              const typeMeta = getNotificationTypeMeta(notif.type);
              const notifDate = new Date(notif.created_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={notif.id}
                  className={`notification-row-card ${!notif.is_read ? 'unread' : 'read'} ${notif.report_id ? 'clickable' : ''}`}
                  onClick={() => handleNotificationClick(notif)}
                  role={notif.report_id ? 'button' : 'article'}
                  tabIndex={0}
                  aria-label={`${notif.title}: ${notif.message}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNotificationClick(notif);
                    }
                  }}
                >
                  {/* Left Indicator & Icon */}
                  <div className="notif-indicator-column">
                    <div className="notif-type-bubble" aria-hidden="true">
                      {typeMeta.icon}
                    </div>
                    {!notif.is_read && (
                      <span className="notif-unread-glow-dot" title="Unread alert" />
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="notif-body-column">
                    <div className="notif-top-meta-row">
                      <div className="notif-badge-group">
                        <span className={`notif-type-tag ${typeMeta.badgeClass}`}>
                          {typeMeta.label}
                        </span>
                        {notif.report_id && (
                          <span className="report-ref-chip" title={`Linked Incident: ${notif.report_id}`}>
                            Incident #{notif.report_id.slice(0, 8)}
                          </span>
                        )}
                      </div>

                      <time className="notif-timestamp" dateTime={notif.created_at}>
                        {notifDate}
                      </time>
                    </div>

                    <h2 className="notif-item-title">{notif.title}</h2>
                    <p className="notif-item-message">{notif.message}</p>

                    <div className="notif-bottom-row">
                      {notif.report_id ? (
                        <span className="notif-linked-action">
                          <span>View Report Details</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </span>
                      ) : (
                        <span className="notif-system-tag">System Notification</span>
                      )}

                      {!notif.is_read && (
                        <button
                          type="button"
                          className="btn-mark-single-read"
                          onClick={(e) => handleMarkSingleRead(e, notif.id)}
                          aria-label="Mark notification as read"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
