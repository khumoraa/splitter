import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router/react-navigation';
import { isApiError } from '@/shared/api/api-error';
import { socialErrorKey } from '@/features/social/lib/errors';
import { PaymentsApi, type Ledger } from '../api/payments.api';

/** Loads a bill's debts every time the screen gets focus (e.g. after closing the payment sheet). */
export function useLedger(sessionId: number | undefined) {
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await PaymentsApi.ledger(sessionId);
      if (mine === seq.current) { setData(d); setErrorKey(null); }
    } catch (e) {
      if (mine === seq.current) setErrorKey(isApiError(e) && e.status === 404 ? 'payments.errors.noAccess' : socialErrorKey(isApiError(e) ? e : {}));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [sessionId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return { data, setData, loading, errorKey, reload: load };
}
