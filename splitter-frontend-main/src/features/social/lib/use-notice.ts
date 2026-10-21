import { useCallback, useEffect, useRef, useState } from 'react';

export interface Notice { kind: 'error' | 'success' | 'info'; text: string }

/** A message that clears itself after a few seconds (used for "Request sent", errors, ...). */
export function useNotice(ms = 4500): [Notice | null, (n: Notice | null) => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((n: Notice | null) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(n);
    if (n) timer.current = setTimeout(() => setNotice(null), ms);
  }, [ms]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [notice, show];
}
