// api.js — wrapper fetch qua API Gateway (/api/* + Bearer JWT)
import { state } from './store.js';

export async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Yêu cầu thất bại');
  return data;
}
