import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useNetInfo } from '@react-native-community/netinfo';
import { isApiError } from '@/shared/api/api-error';
import { ScanApi, type QuotaDto } from '../api/scan.api';
import { getScanOptions, type ScanOptions } from './scan-options';

export interface ScanQuotaState {
  status: 'loading' | 'ok' | 'error';
  quota: QuotaDto | null;
  options: ScanOptions;
  online: boolean;
  reload: () => void;
}

/** Loads the remaining recognitions every time the screen gets focus and derives what the user may do. */
export function useScanQuota(): ScanQuotaState {
  const net = useNetInfo();
  const online = !(net.isConnected === false || net.isInternetReachable === false);
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; quota: QuotaDto | null; kind?: 'network' | 'timeout' | 'http' | 'unknown'; httpStatus?: number }>({ status: 'loading', quota: null });
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const ctrl = new AbortController();
      setState((s) => ({ ...s, status: s.quota ? 'ok' : 'loading' }));
      ScanApi.quota(ctrl.signal)
        .then((quota) => setState({ status: 'ok', quota }))
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          if (isApiError(e) && e.kind === 'cancelled') return;
          if (isApiError(e)) setState((s) => ({ status: 'error', quota: s.quota, kind: e.kind === 'cancelled' ? 'unknown' : e.kind, ...(e.status !== undefined ? { httpStatus: e.status } : {}) }));
          else setState((s) => ({ status: 'error', quota: s.quota, kind: 'unknown' }));
        });
      return () => ctrl.abort();
      // re-run when the connection comes back or Retry is pressed, not only on focus
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, online])
  );

  const options = getScanOptions({
    online,
    quotaStatus: state.status,
    remaining: state.quota ? state.quota.remaining : null,
    quotaErrorKind: state.kind,
    quotaErrorStatus: state.httpStatus,
  });
  return { status: state.status, quota: state.quota, options, online, reload: () => setTick((n) => n + 1) };
}
