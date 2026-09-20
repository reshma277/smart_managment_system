import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import UserNavbar from '../../components/auth/UserNavbar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import '../../styles/admin.css';

export default function AdminNotifications() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'unread' | 'sla' | 'dispatch'
  const [refreshKey, setRefreshKey] = useState(0);

  // Evaluating alerts state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalFeedback, setEvalFeedback] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let isMounted = true;

    async function loadNotifications() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (fetchErr) {
          console.error('Error fetching admin notifications:', fetchErr);
          if (isMounted) setError('Unable to load municipal operational alerts.');
          return;
        }

        if (isMounted) {
          setNotifications(data || []);
          setError(null);
        }
      } catch (err) {
        console.error('Exception fetching notifications:', err);
        if (isMounted) setError('Network error while retrieving alerts.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadNotifications();

    // Supabase Realtime subscription on admin notifications
    const channel = supabase
      .channel(`admin-notifs-${userId}`)
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
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshKey]);

  // Trigger server-side SLA alert evaluation RPC
  const handleEvaluateSlaAlerts = async () => {
    if (isEvaluating) return;
    setIsEvaluating(true);
    setEvalFeedback(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('evaluate_sla_alerts');

      if (rpcErr) {
        console.error('evaluate_sla_alerts error:', rpcErr);
        setEvalFeedback({
          type: 'error',
          message: rpcErr.message || 'Could not evaluate SLA alerts.',
        });
      } else {
        const count = data?.alerts_created ?? 0;
        setEvalFeedback({
          type: 'success',
          message: count > 0
            ? `SLA evaluation complete: ${count} new operational alert${count === 1 ? '' : 's'} generated.`
            : 'SLA evaluation complete: No new SLA breach alerts generated. All active reports within limits.',
        });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Exception during SLA evaluation:', err);
      setEvalFeedback({
        type: 'error',
        message: 'Network error occurred while evaluating SLA alerts.',
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  // Mark single notification read
  const handleMarkSingleRead = async (e, notificationId) => {
    e.stopPropagation();
    try {
      const { error: rpcErr } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
      });

      if (!rpcErr) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
        );
      }
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  // Mark all notifications read
  const handleMarkAllRead = async () => {
    if (markingAll || notifications.filter((n) => !n.is_read).length === 0) return;
    setMarkingAll(true);
    try {
      const { error: rpcErr } = await supabase.rpc('mark_all_notifications_read');
      if (!rpcErr) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      }
    } catch (err) {
      console.error('Error marking all notifications read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  // Navigate to associated report
  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      await supabase.rpc('mark_notification_read', { p_notification_id: notif.id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
    }

    if (notif.report_id) {
      navigate(`/admin/reports/${notif.report_id}`);
    }
  };

  // Filter tab subsets
  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const slaCount = notifications.filter((n) => (n.type || '').startsWith('sla_')).length;
  const dispatchCount = notifications.filter((n) => n.type === 'dispatch_failed').length;

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.is_read;
    if (activeTab === 'sla') return (n.type || '').startsWith('sla_');
    if (activeTab === 'dispatch') return n.type === 'dispatch_failed';
    return true;
  });

  const getAlertBadge = (type) => {
    if (type === 'sla_assignment_breached') {
      return { label: 'ASSIGNMENT SLA BREACH', className: 'sla-badge sla-breached' };
    }
    if (type === 'sla_resolution_breached') {
      return { label: 'RESOLUTION SLA BREACH', className: 'sla-badge sla-breached' };
    }
    if (type === 'dispatch_failed') {
      return { label: 'DISPATCH FAILURE', className: 'sla-badge sla-approaching' };
    }
    return { label: 'OPERATIONAL ALERT', className: 'sla-badge sla-within' };
  };

  const formatAlertDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="admin-layout">
      <UserNavbar />

      <main className="admin-main" role="main">
        {/* HEADER */}
        <header className="admin-page-header">
          <div className="admin-header-content">
            <div className="admin-eyebrow-row">
              <span className="admin-eyebrow">MUNICIPAL COMMAND</span>
              <span className="admin-role-badge">
                <span aria-hidden="true">🔔</span> Alert Center
              </span>
            </div>
            <h1 className="admin-title">Operational Alerts</h1>
            <p className="admin-subtitle">
              Real-time SLA breach warnings, dispatch exceptions, and automated service alerts.
            </p>
          </div>

          <div className="admin-header-actions">
            <button
              type="button"
              className="btn-admin-primary"
              onClick={handleEvaluateSlaAlerts}
              disabled={isEvaluating}
              id="btn-evaluate-sla"
            >
              {isEvaluating ? 'Evaluating SLAs...' : '⚡ Evaluate SLA Alerts'}
            </button>
            <button
              type="button"
              className="btn-admin-secondary"
              onClick={handleMarkAllRead}
              disabled={markingAll || unreadCount === 0}
              id="btn-mark-all-read"
            >
              {markingAll ? 'Marking...' : '✓ Mark All Read'}
            </button>
          </div>
        </header>

        {/* FEEDBACK BANNER */}
        {evalFeedback && (
          <div
            className={`admin-feedback-banner ${evalFeedback.type}`}
            style={{
              padding: '0.85rem 1.15rem',
              borderRadius: '12px',
              border: evalFeedback.type === 'error' ? '1px solid #FCA5A5' : '1px solid #86EFAC',
              background: evalFeedback.type === 'error' ? '#FEE2E2' : '#DCFCE7',
              color: evalFeedback.type === 'error' ? '#991B1B' : '#166534',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
            role="status"
          >
            {evalFeedback.type === 'error' ? '⚠️ ' : '✅ '}
            {evalFeedback.message}
          </div>
        )}

        {/* ERROR STATE */}
        {error && (
          <div className="admin-state-box" role="alert">
            <span className="admin-state-icon" aria-hidden="true">⚠️</span>
            <p className="admin-state-title">Alert Center Error</p>
            <p className="admin-state-desc">{error}</p>
            <button
              type="button"
              className="btn-admin-primary"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {/* TABS BAR */}
        <div className="admin-toolbar-card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`dispatch-filter-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All Alerts ({notifications.length})
            </button>
            <button
              type="button"
              className={`dispatch-filter-btn ${activeTab === 'unread' ? 'active' : ''}`}
              onClick={() => setActiveTab('unread')}
            >
              Unread ({unreadCount})
            </button>
            <button
              type="button"
              className={`dispatch-filter-btn ${activeTab === 'sla' ? 'active' : ''}`}
              onClick={() => setActiveTab('sla')}
            >
              SLA Breaches ({slaCount})
            </button>
            <button
              type="button"
              className={`dispatch-filter-btn ${activeTab === 'dispatch' ? 'active' : ''}`}
              onClick={() => setActiveTab('dispatch')}
            >
              Dispatch Failures ({dispatchCount})
            </button>
          </div>
        </div>

        {/* NOTIFICATION FEED */}
        {loading ? (
          <div className="admin-state-box" aria-live="polite">
            <div className="auth-spinner" style={{ width: '32px', height: '32px' }} />
            <p className="admin-state-title">Loading Operational Alerts...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="admin-state-box">
            <span className="admin-state-icon" aria-hidden="true">✅</span>
            <h3 className="admin-state-title">No Alerts in this Category</h3>
            <p className="admin-state-desc">
              All municipal operational queues are clear and meeting service standards.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredNotifications.map((notif) => {
              const badge = getAlertBadge(notif.type);
              const isUnread = !notif.is_read;

              return (
                <article
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    padding: '1.15rem 1.35rem',
                    background: isUnread ? '#FFFFFF' : 'var(--admin-bg)',
                    border: isUnread ? '1.5px solid var(--admin-border)' : '1px solid var(--admin-border-subtle)',
                    borderRadius: 'var(--admin-radius)',
                    boxShadow: isUnread ? 'var(--admin-shadow)' : 'none',
                    cursor: notif.report_id ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                  className="admin-notif-card"
                  title={notif.report_id ? 'Click to inspect related incident report' : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className={badge.className}>{badge.label}</span>
                      {isUnread && (
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: 'var(--admin-primary)',
                          }}
                          title="Unread notification"
                        />
                      )}
                    </div>
                    <span className="alert-meta-time">
                      {formatAlertDate(notif.created_at)}
                    </span>
                  </div>

                  <h3 style={{ margin: 0, fontSize: '0.975rem', fontWeight: 800, color: 'var(--admin-text-h)' }}>
                    {notif.title}
                  </h3>

                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--admin-text-body)', lineHeight: 1.5 }}>
                    {notif.message}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.35rem' }}>
                    {notif.report_id ? (
                      <span style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--admin-primary)' }}>
                        Inspect Incident #{notif.report_id.slice(0, 8)} &rarr;
                      </span>
                    ) : <span />}

                    {isUnread && (
                      <button
                        type="button"
                        className="btn-admin-secondary btn-admin-sm"
                        style={{ padding: '0.2rem 0.6rem', fontSize: '0.725rem' }}
                        onClick={(e) => handleMarkSingleRead(e, notif.id)}
                        title="Mark as read"
                      >
                        ✓ Mark Read
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
