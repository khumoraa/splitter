import axios, { AxiosError } from 'axios';
import { getToken } from '@/shared/lib/utils/token-storage';
import { emitUnauthorized } from '@/shared/api/auth-events';
import { ApiError } from '@/shared/api/api-error';
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
    if (token) {
      const headers: any = config.headers ?? {};
      if (typeof headers.set === 'function') {
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('Content-Type', headers.get?.('Content-Type') ?? 'application/json');
      } else {
        config.headers = {
          ...headers,
          Authorization: `Bearer ${token}`,
          'Content-Type': headers['Content-Type'] ?? 'application/json',
        };
      }
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
    if (__DEV__) {
      console.error('[API] Error details:', {
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
      const serverMsg: string | undefined =
        typeof data === 'string' ? data : data?.message || data?.error;

      // Server-provided messages (validation details, OCR errors) are kept; fallbacks are translated.
      switch (status) {
        case 401:
          emitUnauthorized();
          throw new ApiError(i18n.t('errors.unauthorized'), 'http', status);
        case 422:
          throw new ApiError(serverMsg || i18n.t('errors.validation'), 'http', status);
        default:
          if (status >= 500) {
            throw new ApiError(serverMsg || i18n.t('errors.server'), 'http', status);
          }
          throw new ApiError(serverMsg || i18n.t('errors.request', { status }), 'http', status);
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

/**
 * POST /auth/logout (если у бэка нет — можно удалять этот метод)
 * Параметр token не обязателен — интерсептор и так подставит.
 */
export async function logout(token?: string): Promise<void> {
  await apiClient.post(
    '/auth/logout',
    {},
    {
      headers: token
        ? (h => {
            if (typeof (h as any).set === 'function') {
              (h as any).set('Authorization', `Bearer ${token}`);
              return h;
            }
            return { ...(h || {}), Authorization: `Bearer ${token}` };
          })((apiClient.defaults.headers.common as any) ?? {})
        : undefined,
    }
  );
}
/**
 * POST /uploads/avatar
 * Uploads a new avatar file and returns the CDN URL.
 */
export interface UploadAvatarResponse {
  success: boolean;
  avatarUrl: string;
  key: string;
}

export async function uploadAvatar(formData: FormData): Promise<UploadAvatarResponse> {
  const { data } = await apiClient.post<UploadAvatarResponse>('/uploads/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export interface UpdateAvatarPayload {
  avatarUrl: string;
}

/**
 * PATCH /users/me/avatar
 * Updates the current user's avatar URL.
 */
export async function updateAvatar(payload: UpdateAvatarPayload): Promise<User> {
  // The server answers { success, avatarUrl }, not a User: reload the full profile.
  await apiClient.patch('/users/me/avatar', payload);
  return getCurrentUser();
}

export interface UpdateUsernamePayload {
  username: string;
}

/**
 * PATCH /user/username
 * Updates the current user's username.
 */
export async function updateUsername(payload: UpdateUsernamePayload): Promise<User> {
  const response = await apiClient.patch<User | null>('/user/username', payload);
  if (response.data) {
    return response.data;
  }
  return getCurrentUser();
}

export interface UpdateEmailPayload {
  email: string;
}

/**
 * PATCH /user/email
 * Updates the current user's email address.
 */
export async function updateEmail(payload: UpdateEmailPayload): Promise<User> {
  const response = await apiClient.patch<User | null>('/user/email', payload);
  if (response.data) {
    return response.data;
  }
  return getCurrentUser();
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/**
 * PATCH /user/password
 * Changes the current user's password.
 */
export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await apiClient.patch('/user/password', payload);
}

/**
 * DELETE /users/me/avatar
 * Resets the current user's avatar to default (null in DB).
 */
export async function resetAvatar(): Promise<User> {
  // The server answers { success, avatarUrl: <placeholder> }, not a User: reload the full profile
  // (its avatarUrl is null after a reset).
  await apiClient.delete('/users/me/avatar');
  return getCurrentUser();
}
