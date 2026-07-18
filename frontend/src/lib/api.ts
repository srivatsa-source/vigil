export const API_BASE = 'http://127.0.0.1:8000/api';

export async function fetchSupervisors() {
  const res = await fetch(`${API_BASE}/supervisors`);
  return res.json();
}

export async function fetchRuns() {
  const res = await fetch(`${API_BASE}/runs`);
  return res.json();
}

export async function fetchRun(id: string) {
  const res = await fetch(`${API_BASE}/runs/${id}`);
  return res.json();
}

export async function createSupervisor(data: any) {
  const res = await fetch(`${API_BASE}/supervisors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function startRun(orderId: string, supervisorId: number) {
  const res = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, supervisor_id: supervisorId }),
  });
  return res.json();
}

export async function sendEvent(runId: string, type: string, data: any = {}) {
  const res = await fetch(`${API_BASE}/runs/${runId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
  return res.json();
}

export async function sendInstruction(runId: string, instruction: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}/instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
  return res.json();
}

export async function terminateRun(runId: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}/terminate`, {
    method: 'POST',
  });
  return res.json();
}

export async function pauseRun(runId: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}/pause`, {
    method: 'POST',
  });
  return res.json();
}

export async function resumeRun(runId: string) {
  const res = await fetch(`${API_BASE}/runs/${runId}/resume`, {
    method: 'POST',
  });
  return res.json();
}
