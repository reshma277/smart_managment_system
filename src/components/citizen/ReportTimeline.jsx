import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ReportStatusBadge from './ReportStatusBadge';

export default function ReportTimeline({ reportId }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchTimeline() {
      if (!reportId) return;
      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchErr } = await supabase
          .from('report_timeline')
          .select('id, report_id, actor_id, previous_status, new_status, notes, created_at')
          .eq('report_id', reportId)
          .order('created_at', { ascending: true });

        if (fetchErr) {
          console.error('Error fetching report timeline:', fetchErr);
          if (isMounted) setError('Unable to load timeline updates.');
          return;
        }

        // Fetch actor display names from public.public_profiles where actor_id is present
        const actorIds = [...new Set((data || []).map((t) => t.actor_id).filter(Boolean))];
        let actorMap = {};

        if (actorIds.length > 0) {
          const { data: actors } = await supabase
            .from('public_profiles')
            .select('id, full_name, role')
            .in('id', actorIds);

          if (actors) {
            actorMap = actors.reduce((acc, a) => {
              acc[a.id] = a;
              return acc;
            }, {});
          }
        }

        if (isMounted) {
          const enriched = (data || []).map((t) => ({
            ...t,
            actor: actorMap[t.actor_id] || null,
          }));
          setTimeline(enriched);
        }
      } catch (err) {
        console.error('Timeline fetch exception:', err);
        if (isMounted) setError('Network error loading status history.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchTimeline();

    // Subscribe to realtime status updates on this report's timeline
    const timelineChannel = supabase
      .channel(`timeline-${reportId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'report_timeline',
          filter: `report_id=eq.${reportId}`,
        },
        async (payload) => {
          if (!isMounted || !payload.new) return;
          const newEntry = payload.new;

          let actor = null;
          if (newEntry.actor_id) {
            const { data: actorData } = await supabase
              .from('public_profiles')
              .select('id, full_name, role')
              .eq('id', newEntry.actor_id)
              .maybeSingle();
            actor = actorData;
          }

          setTimeline((prev) => [...prev, { ...newEntry, actor }]);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(timelineChannel);
    };
  }, [reportId]);

  if (loading) {
    return (
      <div className="state-box" style={{ padding: '1.5rem' }}>
        <div className="auth-spinner" style={{ width: '24px', height: '24px' }} />
        <p style={{ margin: 0, fontSize: '0.85rem' }}>Loading report status history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-box" style={{ padding: '1.5rem' }}>
        <span aria-hidden="true">⚠️</span>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#dc2626' }}>{error}</p>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="state-box" style={{ padding: '1.5rem' }}>
        <span className="state-icon" aria-hidden="true">⏳</span>
        <p className="state-title" style={{ fontSize: '1rem' }}>No status transitions recorded yet</p>
        <p className="state-desc" style={{ fontSize: '0.825rem' }}>
          When municipal dispatch reviews or assigns this incident, milestones will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="timeline-container" role="list" aria-label="Incident status history">
      <div className="timeline-track-line" aria-hidden="true" />

      {timeline.map((event, index) => {
        const eventDate = new Date(event.created_at).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        const actorLabel = event.actor
          ? `${event.actor.full_name} (${event.actor.role})`
          : 'Municipal Dispatch Team';

        return (
          <div key={event.id || index} className="timeline-item" role="listitem">
            <div className="timeline-marker-dot" aria-hidden="true" />
            <div className="timeline-item-header">
              <div className="timeline-status-transition">
                {event.previous_status ? (
                  <>
                    <ReportStatusBadge status={event.previous_status} size="small" />
                    <span aria-hidden="true">&rarr;</span>
                    <ReportStatusBadge status={event.new_status} size="small" />
                  </>
                ) : (
                  <ReportStatusBadge status={event.new_status} size="small" />
                )}
              </div>
              <time className="timeline-date" dateTime={event.created_at}>
                {eventDate}
              </time>
            </div>

            {event.notes && <p className="timeline-notes">{event.notes}</p>}

            <span className="timeline-actor">
              Updated by: <strong>{actorLabel}</strong>
            </span>
          </div>
        );
      })}
    </div>
  );
}
