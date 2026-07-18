'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchRun, sendEvent, sendInstruction, terminateRun, pauseRun, resumeRun } from '@/lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Toast = { msg: string; type: 'success' | 'error' } | null;

const EVENT_TYPES = [
  { value: 'payment_failed',            label: 'Payment Failed' },
  { value: 'payment_confirmed',         label: 'Payment Confirmed' },
  { value: 'shipment_delayed',          label: 'Shipment Delayed' },
  { value: 'refund_requested',          label: 'Refund Requested' },
  { value: 'customer_message_received', label: 'Customer Message' },
  { value: 'delivered',                 label: 'Delivered' },
];

// ---- Derive current order state from the last meaningful activity ----
function deriveCurrentState(activities: any[]): { label: string; sub: string; color: string; bg: string; icon: string } {
  if (!activities.length) return { label: 'No activity yet', sub: 'Waiting for first event', color: '#555', bg: 'transparent', icon: '○' };

  // Walk backwards to find a meaningful event
  for (let i = activities.length - 1; i >= 0; i--) {
    const act = activities[i];
    if (act.type === 'sleep_decision' || act.type === 'wake_decision') {
      continue;
    }
    if (act.type === 'agent_action') {
      const tool = act.content?.tool ?? '';
      const msg = act.content?.message ?? act.content?.note ?? '';
      const toolMap: Record<string, string> = {
        message_customer:         'Messaged customer',
        message_fulfillment_team: 'Notified fulfillment team',
        message_payments_team:    'Notified payments team',
        message_logistics_team:   'Notified logistics team',
        create_internal_note:     'Internal note created',
      };
      return { label: toolMap[tool] ?? 'AI acted', sub: msg.slice(0, 100), color: '#3ecf8e', bg: 'rgba(62,207,142,0.08)', icon: '✓' };
    }

    if (act.type === 'event') {
      const evType = act.content?.type ?? '';
      const evMap: Record<string, { label: string; color: string; bg: string; icon: string }> = {
        payment_failed:            { label: 'Payment failed',         color: '#f55353', bg: 'rgba(245,83,83,0.08)',    icon: '✗' },
        payment_confirmed:         { label: 'Payment confirmed',      color: '#3ecf8e', bg: 'rgba(62,207,142,0.08)',  icon: '✓' },
        shipment_delayed:          { label: 'Shipment delayed',       color: '#f5c518', bg: 'rgba(245,197,24,0.08)',  icon: '⚠' },
        refund_requested:          { label: 'Refund requested',       color: '#f55353', bg: 'rgba(245,83,83,0.08)',   icon: '↩' },
        customer_message_received: { label: 'Customer message',       color: '#4a9eff', bg: 'rgba(74,158,255,0.08)', icon: '💬' },
        delivered:                 { label: 'Order delivered',        color: '#3ecf8e', bg: 'rgba(62,207,142,0.08)', icon: '📦' },
      };
      const ev = evMap[evType];
      if (ev) return { ...ev, sub: `Event received at ${new Date(act.timestamp).toLocaleTimeString()}` };
    }
  }
  return { label: 'Processing', sub: '', color: '#8a8a8a', bg: 'transparent', icon: '…' };
}

// ---- Per-activity visual config ----
function activityStyle(type: string, content: any) {
  if (type === 'sleep_decision') return { label: 'Waiting', color: '#444', dot: '#444', text: 'var(--text-muted)' };
  if (type === 'wake_decision')  return { label: content?.wake ? 'Wake: YES' : 'Wake: NO', color: '#f5c518', dot: '#f5c518', text: 'var(--text-secondary)' };
  if (type === 'agent_action') {
    const tool = content?.tool ?? '';
    const toolLabels: Record<string, string> = {
      message_customer: 'Messaged Customer', message_fulfillment_team: 'Notified Fulfillment',
      message_payments_team: 'Notified Payments', message_logistics_team: 'Notified Logistics',
      create_internal_note: 'Internal Note',
    };
    return { label: toolLabels[tool] ?? 'AI Action', color: '#3ecf8e', dot: '#3ecf8e', text: 'var(--text-primary)' };
  }
  if (type === 'event') {
    const t = content?.type ?? '';
    const danger = ['payment_failed','refund_requested'].includes(t);
    const warn = ['shipment_delayed'].includes(t);
    return {
      label: t.replace(/_/g, ' '),
      color: danger ? '#f55353' : warn ? '#f5c518' : '#4a9eff',
      dot:   danger ? '#f55353' : warn ? '#f5c518' : '#4a9eff',
      text:  'var(--text-primary)',
    };
  }
  return { label: type.replace(/_/g, ' '), color: 'var(--accent)', dot: 'var(--accent)', text: 'var(--text-secondary)' };
}

export default function RunDetailClient() {
  const params = useParams();
  const id = params.id as string;

  const [run, setRun] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState('shipment_delayed');
  const [instruction, setInstruction] = useState('');
  const [sendingEvent, setSendingEvent] = useState(false);
  const [sendingInstruction, setSendingInstruction] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newestFirst, setNewestFirst] = useState(true);

  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async (silent = false) => {
    try {
      const data = await fetchRun(id);
      setRun(data.run);
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch {
      if (!silent) showToast('Failed to fetch run data', 'error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => loadData(true), 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const handleSendEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingEvent(true);
    try {
      const result = await sendEvent(id, eventType);
      if (result?.status === 'event sent') {
        showToast(`✓ "${eventType}" sent — AI processing…`, 'success');
      } else {
        showToast(result?.detail || 'Failed to send event', 'error');
      }
      await loadData(true);
    } catch {
      showToast('Failed to send event', 'error');
    } finally {
      setSendingEvent(false);
    }
  };

  const handleSendInstruction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) return;
    setSendingInstruction(true);
    try {
      const result = await sendInstruction(id, instruction.trim());
      if (result?.status === 'instruction sent') {
        showToast('Instruction sent', 'success');
        setInstruction('');
      } else {
        showToast(result?.detail || 'Failed to send instruction', 'error');
      }
      await loadData(true);
    } catch {
      showToast('Failed to send instruction', 'error');
    } finally {
      setSendingInstruction(false);
    }
  };

  const handleTerminate = async () => {
    if (!confirm('Terminate this run?')) return;
    setTerminating(true);
    try {
      const result = await terminateRun(id);
      if (result?.status) {
        showToast('Termination signal sent', 'success');
        setAutoRefresh(false);
      } else {
        showToast(result?.detail || 'Failed to terminate', 'error');
      }
      await loadData(true);
    } catch {
      showToast('Failed to terminate run', 'error');
    } finally {
      setTerminating(false);
    }
  };

  const handlePause = async () => {
    setPausing(true);
    try {
      const result = await pauseRun(id);
      if (result?.status) {
        showToast('Run paused', 'success');
      } else {
        showToast(result?.detail || 'Failed to pause', 'error');
      }
      await loadData(true);
    } catch {
      showToast('Failed to pause run', 'error');
    } finally {
      setPausing(false);
    }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      const result = await resumeRun(id);
      if (result?.status) {
        showToast('Run resumed', 'success');
      } else {
        showToast(result?.detail || 'Failed to resume', 'error');
      }
      await loadData(true);
    } catch {
      showToast('Failed to resume run', 'error');
    } finally {
      setResuming(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ width: 20, height: 20, borderTopColor: 'var(--accent)' }} /> Loading run…
    </div>
  );
  if (!run) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12 }}>
      <div style={{ fontSize: 24 }}>🔍</div>
      <div style={{ color: 'var(--text-secondary)' }}>Run not found</div>
      <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 13 }}>← Back to Dashboard</Link>
    </div>
  );

  const isActive = run.status === 'active';
  const currentState = deriveCurrentState(activities);
  const displayActivities = newestFirst ? [...activities].reverse() : activities;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top Bar */}
      <header style={{
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
        padding: '0 20px', height: '52px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 13, flexShrink: 0 }}>← Runs</Link>
          <span style={{ color: 'var(--border)', flexShrink: 0 }}>/</span>
          <span className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.id}</span>
          <span className={`badge badge-${run.status === 'active' ? 'active' : run.status === 'error' ? 'error' : 'completed'}`}>
            {isActive && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', marginRight: 4 }} />}
            {run.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setAutoRefresh(a => !a)} className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 11 }}>
            {autoRefresh ? '⏸ Auto-refresh Off' : '▶ Auto-refresh On'}
          </button>
          {isActive && (
            <button onClick={handlePause} className="btn btn-secondary" disabled={pausing}>
              {pausing ? <div className="spinner" /> : '⏸ Pause'}
            </button>
          )}
          {run.status === 'paused' && (
            <button onClick={handleResume} className="btn btn-primary" disabled={resuming}>
              {resuming ? <div className="spinner" /> : '▶ Resume'}
            </button>
          )}
          {(isActive || run.status === 'paused') && (
            <button onClick={handleTerminate} className="btn btn-danger" disabled={terminating}>
              {terminating ? <div className="spinner" /> : '⏹ Terminate'}
            </button>
          )}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', flex: 1, overflow: 'hidden', height: 'calc(100vh - 52px)' }}>

        {/* Main Panel */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Current Order Status Banner ── */}
          <div style={{
            background: currentState.bg || 'var(--bg-secondary)',
            border: `1px solid ${currentState.color}33`,
            borderRadius: 8,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}>
            <div style={{ fontSize: 22, flexShrink: 0, width: 36, height: 36, borderRadius: 8, background: `${currentState.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {currentState.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Current Order Status</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: currentState.color }}>{currentState.label}</div>
              {currentState.sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentState.sub}</div>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{activities.length} events</div>
          </div>

          {/* ── Memory Summary ── */}
          <div className="panel">
            <div className="panel-header">
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Memory Summary</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI state</span>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <pre className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {run.memory_summary || 'No memory yet.'}
              </pre>
            </div>
          </div>

          {/* ── Activity Timeline ── */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Activity Timeline</span>
              <button
                onClick={() => setNewestFirst(n => !n)}
                style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {newestFirst ? '↓ Newest first' : '↑ Oldest first'}
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {activities.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                  No activity yet. Send an event to wake the AI.
                </div>
              ) : (
                <div>
                  {displayActivities.map((act, i) => {
                    const style = activityStyle(act.type, act.content);
                    const isSleep = act.type === 'sleep_decision';

                    // Collapse sleep_decision nodes — they're just noise between real events
                    if (isSleep) return (
                      <div key={act.id ?? i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 0 4px 20px', marginBottom: 6,
                        borderLeft: '1px dashed var(--border)',
                        color: 'var(--text-muted)', fontSize: 11,
                      }}>
                        <span style={{ marginLeft: -24, marginRight: 8, fontSize: 10, color: 'var(--border-light)' }}>—</span>
                        Waiting for next event
                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10 }}>{new Date(act.timestamp).toLocaleTimeString()}</span>
                      </div>
                    );

                    return (
                      <div key={act.id ?? i} className="timeline-item fade-up">
                        <div className="timeline-dot" style={{ background: style.dot, border: '2px solid var(--bg-primary)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                              fontFamily: 'JetBrains Mono, monospace',
                              background: `${style.color}18`, color: style.color,
                              textTransform: 'uppercase',
                            }}>{act.type.replace(/_/g, ' ')}</span>
                            <span style={{ fontWeight: 500, fontSize: 13, color: style.text, textTransform: 'capitalize' }}>
                              {style.label}
                            </span>
                          </div>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                            {new Date(act.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <pre className="mono" style={{
                          margin: 0, background: 'var(--bg-primary)', border: '1px solid var(--border)',
                          borderRadius: 5, padding: '8px 10px', fontSize: 11,
                          color: 'var(--text-secondary)', overflowX: 'auto',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto',
                        }}>
                          {JSON.stringify(act.content, null, 2)}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar — Controls */}
        <aside style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Inject Event */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Inject Event</div>
            <form onSubmit={handleSendEvent} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select value={eventType} onChange={e => setEventType(e.target.value)} disabled={!isActive} className="input">
                {EVENT_TYPES.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
              </select>
              <div style={{ background: 'var(--bg-primary)', borderRadius: 5, padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)' }}>
                <span className="mono" style={{ color: 'var(--green)' }}>POST</span>
                <span className="mono" style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>/runs/{'{id}'}/events</span>
              </div>
              <button type="submit" className="btn btn-primary" disabled={!isActive || sendingEvent} style={{ width: '100%' }}>
                {sendingEvent ? <><div className="spinner" /> Sending…</> : '▶ Send Event'}
              </button>
            </form>
          </div>

          {/* Override Instruction */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Override Instruction</div>
            <form onSubmit={handleSendInstruction} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea value={instruction} onChange={e => setInstruction(e.target.value)} disabled={!isActive}
                placeholder="e.g. Do not message customer for this run." className="input" rows={4} />
              <div style={{ background: 'var(--bg-primary)', borderRadius: 5, padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)' }}>
                <span className="mono" style={{ color: 'var(--green)' }}>POST</span>
                <span className="mono" style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>/runs/{'{id}'}/instructions</span>
              </div>
              <button type="submit" className="btn btn-blue" disabled={!isActive || !instruction.trim() || sendingInstruction} style={{ width: '100%' }}>
                {sendingInstruction ? <><div className="spinner" /> Sending…</> : '↳ Add Instruction'}
              </button>
            </form>
          </div>

          {/* Run Info */}
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Run Info</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Run ID',     value: run.id },
                { label: 'Supervisor', value: run.supervisor_id },
                { label: 'Status',     value: run.status },
                { label: 'Created',    value: run.created_at ? new Date(run.created_at).toLocaleString() : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{value ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
