import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/shared/api/api-error';
import { FriendsApi } from '@/features/friends/api/friends.api';
import type { SearchHit } from '@/features/friends/model/types';
import { SearchController, type SearchState } from './search-controller';

const INITIAL: SearchState<SearchHit> = { status: 'idle', query: '', results: [], nextOffset: null, errorCode: null };

/** React wrapper around SearchController: debounced, cancellable user search (optionally in the context of a group). */
export function useUserSearch(groupId?: number) {
  const [state, setState] = useState<SearchState<SearchHit>>(INITIAL);
  const ref = useRef<SearchController<SearchHit> | null>(null);

  useEffect(() => {
    const c = new SearchController<SearchHit>({
      fetcher: (q, offset, signal) => FriendsApi.search(q, { offset, signal, ...(groupId !== undefined ? { groupId } : {}) }),
      onChange: setState,
      classify: (e) => {
        if (isApiError(e)) return e.kind === 'cancelled' ? null : e.code ?? e.kind;
        return e instanceof Error && e.name === 'CanceledError' ? null : 'unknown';
      },
    });
    ref.current = c;
    return () => c.dispose();
  }, [groupId]);

  return {
    state,
    setQuery: (q: string) => ref.current?.setQuery(q),
    loadMore: () => ref.current?.loadMore(),
    retry: () => ref.current?.retry(),
    refresh: () => ref.current?.refresh(),
  };
}
