import axios, { AxiosError, isCancel } from 'axios';
import { getToken } from '@/shared/lib/utils/token-storage';
import { emitUnauthorized } from '@/shared/api/auth-events';
import { ApiError, logLevelForStatus } from '@/shared/api/api-error';
import i18n from '@/shared/config/i18n';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await getToken();
    // A multipart body must NOT get a Content-Type from us: the native networking layer adds it together with the
    // boundary. A hand-written 'multipart/form-data' (or the instance default 'application/json') breaks the upload.
    const isForm = typeof FormData !== 'undefined' && config.data instanceof FormData;
    if (token) {
      const headers: any = config.headers ?? {};
      if (typeof headers.set === 'function') {
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('Content-Type', isForm ? false : headers.get?.('Content-Type') ?? 'application/json');
      } else {
        config.headers = {
          ...headers,
          Authorization: `Bearer ${token}`,
          'Content-Type': isForm ? false : headers['Content-Type'] ?? 'application/json',
        };
      }
    } else if (isForm && typeof (config.headers as any)?.set === 'function') {
      (config.headers as any).set('Content-Type', false);
    }
  } catch {
    // If token retrieval fails we keep going; request will likely return 401.
  }

  if (__DEV__) {
    const method = (config.method || 'GET').toUpperCase();
    const url = `${config.baseURL}${config.url}`;
    console.log(`[API] ${method} ${url}`);
    if (config.params) console.log('[API] Params:', config.params);
    if (config.data) console.log('[API] Request data:', config.data);
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (__DEV__) {
      console.log('[API] Response:', response.data);
      console.log('[API] Status:', response.status);
    }
    return response;
  },
  (error: AxiosError<any>) => {
    // An aborted request is not a network failure: keep it distinguishable (see isCancelled)
    if (isCancel(error)) {
      throw new ApiError('Request cancelled', 'cancelled');
    }

    if (__DEV__) {
      // 4xx (e.g. 401 invalid token) is an expected outcome handled below: warn, so the dev red screen
      // does not pop up. 5xx / no response stay console.error.
      const level = logLevelForStatus(error.response?.status);
      console[level]('[API] Error details:', {
        message: error.message,
        code: (error as any).code,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
      });
    }

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as any;
      const serverCode: string | undefined = typeof data?.code === 'string' ? data.code : undefined;
      const serverMsg: string | undefined =
        typeof data === 'string' ? data : data?.message || data?.error;

      // Server-provided messages (validation details, OCR errors) are kept; fallbacks are translated.
      switch (status) {
        case 401:
          emitUnauthorized();
          throw new ApiError(i18n.t('errors.unauthorized'), 'http', status, serverCode);
        default:
          if (status >= 500) {
            throw new ApiError(serverMsg || i18n.t('errors.server'), 'http', status, serverCode);
          }
          throw new ApiError(serverMsg || i18n.t('errors.request', { status }), 'http', status, serverCode);
      }
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new ApiError(i18n.t('errors.timeout'), 'timeout');
    } else if (error.request) {
      throw new ApiError(i18n.t('errors.network'), 'network');
    }

    throw new ApiError(i18n.t('errors.unexpected'), 'unknown');
  }
);
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    username: string;
    uniqueId: string;
    avatarUrl: string | null;
  };
}

export interface User {
  id: number;
  email: string;
  username: string;
  uniqueId: string;
  avatarUrl: string | null;
}

/** ===== Auth API ===== */

/** POST /auth/login */
export async function login(payload: LoginRequest): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/login', payload);
  return data;
}

/** POST /auth/register */
export async function register(payload: RegisterRequest): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/register', payload);
  return data;
}

/**
 * GET /auth/me
 * Параметр token не обязателен — интерсептор и так подставит.
 * Оставлен для обратной совместимости: если передан, мы явно проставим header.
 */
export async function getCurrentUser(token?: string): Promise<User> {
  const { data } = await apiClient.get<User>('/auth/me', {
    headers: token
      ? (h => {
          // тот же трюк с AxiosHeaders
          if (typeof (h as any).set === 'function') {
            (h as any).set('Authorization', `Bearer ${token}`);
            return h;
          }
          return { ...(h || {}), Authorization: `Bearer ${token}` };
        })((apiClient.defaults.headers.common as any) ?? {})
      : undefined,
  });
  return data;
}

// Profile changes (name, email, password, avatar, account deletion) live in src/features/profile/api/profile.api.ts
