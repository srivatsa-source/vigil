'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchSupervisors, fetchRuns, createSupervisor, startRun } from '@/lib/api';
import Link from 'next/link';

type Toast = { msg: string; type: 'success' | 'error' } | null;

// Human-readable labels and colours derived from the last activity entry
const EVENT_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  event:          { label: 'Event received',   color: '#4a9eff', bg: 'rgba(74,158,255,0.12)' },
  wake_decision:  { label: 'Processing…',      color: '#f5c518', bg: 'rgba(245,197,24,0.12)' },
  agent_action:   { label: 'AI acted',         color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)' },
  sleep_decision: { label: 'Waiting for event',color: '#8a8a8a', bg: 'rgba(138,138,138,0.1)' },
};

// Derive a friendly order state from the last event *content*
function deriveOrderStatus(lastEventType: string | null, lastEventContent: any): string {
  if (!lastEventType) return 'No activity';
  if (lastEventType === 'sleep_decision') {
    const content = lastEventContent as any;
    return content?.instruction ?? 'Waiting for event';
  }
  if (lastEventType === 'event') {
    const t = (lastEventContent as any)?.type ?? '';
    const map: Record<string, string> = {
      payment_failed:            'Payment failed',
      payment_confirmed:         'Payment confirmed',
      shipment_delayed:          'Shipment delayed',
      refund_requested:          'Refund requested',
      customer_message_received: 'Customer message received',
      delivered:                 'Delivered',
    };
    return map[t] ?? t.replace(/_/g, ' ');
  }
  if (lastEventType === 'agent_action') {
    const tool = (lastEventContent as any)?.tool ?? '';
    const map: Record<string, string> = {
      message_customer:         'Messaged customer',
      message_fulfillment_team: 'Notified fulfillment',
      message_payments_team:    'Notified payments',
      message_logistics_team:   'Notified logistics',
      create_internal_note:     'Note created',
    };
    return map[tool] ?? 'AI acted';
  }
  if (lastEventType === 'wake_decision') return 'Processing event…';
  return lastEventType.replace(/_/g, ' ');
}

export default function HomeClient() {
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOrder, setNewOrder] = useState('');
  const [selectedSup, setSelectedSup] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupInstruction, setNewSupInstruction] = useState('');
  const [newSupTools, setNewSupTools] = useState<string[]>(['message_customer', 'message_logistics_team', 'message_payments_team', 'message_fulfillment_team', 'create_internal_note']);
  const [toast, setToast] = useState<Toast>(null);

  const availableTools = ['message_customer', 'message_logistics_team', 'message_payments_team', 'message_fulfillment_team', 'create_internal_note'];

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    try {
      const [sups, rns] = await Promise.all([fetchSupervisors(), fetchRuns()]);
      setSupervisors(Array.isArray(sups) ? sups : []);
      setRuns(Array.isArray(rns) ? rns : []);
      if (Array.isArray(sups) && sups.length > 0 && selectedSup === '') {
        setSelectedSup(sups[0].id);
      }
    } catch {
      showToast('Failed to reach backend. Is it running?', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedSup]);

  useEffect(() => { loadData(); }, []);

  // Auto-refresh runs list every 5 s
  useEffect(() => {
    const t = setInterval(loadData, 5000);
    return () => clearInterval(t);
  }, [loadData]);

  const handleCreateSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim() || !newSupInstruction.trim() || newSupTools.length === 0) {
      showToast('Please fill all fields and select at least one tool', 'error');
      return;
    }
    setCreating(true);
    try {
      await createSupervisor({
        name: newSupName,
        base_instruction: newSupInstruction,
        tools: newSupTools
      });
      await loadData();
      showToast('Supervisor template created', 'success');
      setShowCreateForm(false);
      setNewSupName('');
      setNewSupInstruction('');
    } catch {
      showToast('Failed to create supervisor', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleStartRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.trim() || !selectedSup) return;
    setSubmitting(true);
    try {
      const result = await startRun(newOrder.trim(), Number(selectedSup));
      if (result?.run_id || result?.id) {
        setNewOrder('');
        await loadData();
        showToast('Run started successfully', 'success');
      } else {
        showToast(result?.detail || 'Failed to start run', 'error');
      }
    } catch {
      showToast('Failed to start run', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { active: 'badge-active', completed: 'badge-completed', error: 'badge-error' };
    return `badge ${map[status] ?? 'badge-completed'}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top Bar */}
      <header style={{
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
        padding: '0 24px', height: '52px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 28, height: 28, background: 'var(--accent)', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff'
          }}>V</div>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Vigil</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/ Dashboard</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <div className="spinner" />}
          <button onClick={loadData} className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}>↻ Refresh</button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', flex: 1, overflow: 'hidden', height: 'calc(100vh - 52px)' }}>

        {/* Sidebar */}
        <aside style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* New Run */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>New Run</div>
            <form onSubmit={handleStartRun} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input type="text" placeholder="Order ID (e.g. ORD-001)" value={newOrder}
                onChange={e => setNewOrder(e.target.value)} className="input mono" required />
              {supervisors.length > 0 && (
                <select value={selectedSup} onChange={e => setSelectedSup(Number(e.target.value))} className="input">
                  {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <button type="submit" className="btn btn-primary"
                disabled={submitting || !supervisors.length || !newOrder.trim()} style={{ width: '100%' }}>
                {submitting ? <><div className="spinner" /> Starting…</> : '▶  Start Run'}
              </button>
              {!supervisors.length && !loading && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Create a supervisor template first →</p>
              )}
            </form>
          </div>

          {/* Templates */}
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Templates</div>
              <button onClick={() => setShowCreateForm(!showCreateForm)} className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}>
                {showCreateForm ? 'Cancel' : '+ Create'}
              </button>
            </div>
            
            {showCreateForm && (
              <form onSubmit={handleCreateSupervisor} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, background: 'var(--bg-primary)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                <input type="text" placeholder="Supervisor Name" value={newSupName} onChange={e => setNewSupName(e.target.value)} className="input" required style={{ fontSize: 12, padding: '6px' }} />
                <textarea placeholder="Base Instruction" value={newSupInstruction} onChange={e => setNewSupInstruction(e.target.value)} className="input" required style={{ fontSize: 12, padding: '6px', minHeight: 60 }} />
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>Available Tools:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {availableTools.map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={newSupTools.includes(t)} onChange={(e) => {
                        if (e.target.checked) setNewSupTools([...newSupTools, t]);
                        else setNewSupTools(newSupTools.filter(tool => tool !== t));
                      }} />
                      {t}
                    </label>
                  ))}
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating} style={{ marginTop: 4, padding: '6px', fontSize: 12 }}>
                  {creating ? 'Saving...' : 'Save Template'}
                </button>
              </form>
            )}

            {!showCreateForm && (
              supervisors.length === 0
                ? <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No templates yet.</div>
                : supervisors.map(s => (
                  <div key={s.id} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{s.base_instruction}</div>
                  </div>
                ))
            )}
          </div>
        </aside>

        {/* Main — runs list */}
        <main style={{ overflowY: 'auto', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Runs</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>All Runs</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{runs.length} total</div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '40px 0' }}>
              <div className="spinner" style={{ borderTopColor: 'var(--accent)' }} /> Loading…
            </div>
          ) : runs.length === 0 ? (
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
              <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>No runs yet</div>
              <div style={{ fontSize: 12 }}>Create a supervisor template and start your first run</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {runs.map(r => {
                const evInfo = EVENT_LABEL[r.last_event_type] ?? EVENT_LABEL['sleep_decision'];
                const orderState = deriveOrderStatus(r.last_event_type, r.last_event_content);

                return (
                  <Link href={`/runs/${r.id}`} key={r.id} style={{ textDecoration: 'none', display: 'block' }} className="fade-up">
                    <div
                      style={{
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
                        transition: 'border-color 0.15s, background 0.15s',
                        display: 'flex', flexDirection: 'column', gap: 8,
                      }}
                      onMouseEnter={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'var(--border-light)'; d.style.background = 'var(--bg-tertiary)'; }}
                      onMouseLeave={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'var(--border)'; d.style.background = 'var(--bg-secondary)'; }}
                    >
                      {/* Row 1 — ID + status badge + arrow */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.id}
                        </span>
                        <span className={`badge badge-${r.status === 'active' ? 'active' : r.status === 'error' ? 'error' : 'completed'}`}>{r.status}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>›</span>
                      </div>

                      {/* Row 2 — Current order status chip */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: evInfo.bg, borderRadius: 4,
                          padding: '3px 8px', fontSize: 11, fontWeight: 500,
                          color: evInfo.color,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: evInfo.color, display: 'inline-block', flexShrink: 0 }} />
                          {orderState}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
