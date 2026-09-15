import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/citizen-tracking.css';

const NOTIFICATION_TYPE_CONFIG = {
  status_update: { label: 'Status Update', icon: '🔄', badgeClass: 'notif-badge-status' },
  assignment: { label: 'Dispatch Assigned', icon: '👷', badgeClass: 'notif-badge-dispatch' },
  resolution: { label: 'Cleanup Resolved', icon: '✅', badgeClass: 'notif-badge-resolution' },
  support_confirmation: { label: 'Support Confirmed', icon: '🤝', badgeClass: 'notif-badge-support' },
  report_update: { label: 'Report Update', icon: '📋', badgeClass: 'notif-badge-status' },
};

function getNotificationTypeMeta(type) {
  return (
    NOTIFICATION_TYPE_CONFIG[type] || {
      label: type ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Notification',
      icon: '🔔',
      badgeClass: '',
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
      <UserNavbar />

      <main className="tracking-container" role="main">
        {/* Header */}
        <header className="tracking-header">
          <div className="tracking-header-text">
            <nav className="details-breadcrumb-nav" aria-label="Breadcrumb" style={{ marginBottom: '0.5rem' }}>
              <Link to="/citizen" className="btn-back-crumb">
                &larr; Dashboard
              </Link>
            </nav>
            <h1>Citizen Notification Center</h1>
            <p>Real-time progress alerts, dispatch status changes, and cleanup completions.</p>
          </div>

          <div className="tracking-actions-bar">
            <Link
              to="/citizen"
              className="btn-form-cancel"
              style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem', textDecoration: 'none' }}
            >
              Dashboard
            </Link>

            <button
              type="button"
              className="btn-mark-all-read"
              onClick={handleMarkAllRead}
              disabled={markingAll || unreadCount === 0}
              title={unreadCount === 0 ? 'No unread notifications' : 'Mark all notifications as read'}
            >
              <span aria-hidden="true">✓✓</span>
              {markingAll ? 'Updating...' : `Mark All Read (${unreadCount})`}
            </button>
          </div>
        </header>

        {/* Tab Filters */}
        <div className="tracking-filter-bar">
          <div className="filter-pills" role="tablist" aria-label="Filter notifications">
            <button
              type="button"
              role="tab"
              className={`filter-pill-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
              aria-selected={activeTab === 'all'}
            >
              All Alerts <span className="filter-pill-count">{notifications.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`filter-pill-btn ${activeTab === 'unread' ? 'active' : ''}`}
              onClick={() => setActiveTab('unread')}
              aria-selected={activeTab === 'unread'}
            >
              Unread Only <span className="filter-pill-count">{unreadCount}</span>
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="state-title">Loading notifications...</p>
            <p className="state-desc">Checking for status alerts from municipal services.</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="state-box" role="alert">
            <span className="state-icon" aria-hidden="true">⚠️</span>
            <p className="state-title">Error Loading Notifications</p>
            <p className="state-desc">{error}</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && notifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">🔔</span>
            <h2 className="state-title">No Notifications Yet</h2>
            <p className="state-desc">
              You will receive automatic alerts here when your filed reports are assigned to municipal workers, scheduled for collection, or marked as resolved.
            </p>
            <button
              type="button"
              className="btn-form-submit state-action-btn"
              onClick={() => navigate('/citizen/report')}
            >
              File a Waste Report &rarr;
            </button>
          </div>
        )}

        {/* Unread Empty State */}
        {!loading && !error && notifications.length > 0 && displayedNotifications.length === 0 && (
          <div className="state-box">
            <span className="state-icon" aria-hidden="true">✅</span>
            <p className="state-title">All caught up!</p>
            <p className="state-desc">You have no unread notifications.</p>
            <button
              type="button"
              className="btn-form-cancel state-action-btn"
              onClick={() => setActiveTab('all')}
            >
              View All Notifications
            </button>
          </div>
        )}

        {/* Notifications List */}
        {!loading && !error && displayedNotifications.length > 0 && (
          <div className="notifications-list" role="feed" aria-label="Notifications list">
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
                  className={`notification-card ${!notif.is_read ? 'unread' : 'read'} ${notif.report_id ? 'clickable' : ''}`}
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
                  <div className="notif-icon-col">
                    {!notif.is_read ? (
                      <span className="notification-unread-dot" title="Unread alert" />
                    ) : (
                      <span className="notification-read-icon" aria-hidden="true">
                        {typeMeta.icon}
                      </span>
                    )}
                  </div>

                  <div className="notification-content">
                    <div className="notification-header-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span className={`notif-type-badge ${typeMeta.badgeClass}`}>
                          <span aria-hidden="true">{typeMeta.icon}</span> {typeMeta.label}
                        </span>
                        {notif.report_id && (
                          <span className="report-card-ref-badge" title={`Linked Incident Reference: ${notif.report_id}`}>
                            Incident #{notif.report_id.slice(0, 8)}
                          </span>
                        )}
                      </div>

                      <time className="notification-date-text" dateTime={notif.created_at}>
                        {notifDate}
                      </time>
                    </div>

                    <h2 className="notification-card-title">{notif.title}</h2>
                    <p className="notification-card-msg">{notif.message}</p>

                    <div className="notification-card-footer">
                      <div>
                        {notif.report_id ? (
                          <span className="report-card-link-text">
                            View Linked Incident &rarr;
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text)', opacity: 0.8 }}>
                            System Alert
                          </span>
                        )}
                      </div>

                      {!notif.is_read && (
                        <button
                          type="button"
                          className="btn-mark-read"
                          onClick={(e) => handleMarkSingleRead(e, notif.id)}
                          aria-label="Mark notification as read"
                        >
                          Mark Read
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
