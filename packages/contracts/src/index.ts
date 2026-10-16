export const APP_NAME = '拼团哇';

// Only the infrastructure demo is shared here; product contracts follow the PRD.
export interface HealthResponse {
  status: 'ok';
  service: 'pintuan-server';
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null
    && 'status' in value && value.status === 'ok'
    && 'service' in value && value.service === 'pintuan-server';
}

export * from './group';
