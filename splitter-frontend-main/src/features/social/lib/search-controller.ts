/**
 * Debounced, cancellable search with "load more". Framework-free so it can be unit tested with a fake clock.
 * Rules: a new query cancels the previous request (AbortSignal) and its late answer is ignored; queries shorter than
 * `minLen` never reach the network; typing keeps the old results visible while the new ones load.
 */
export interface Page<T> { results: T[]; nextOffset: number | null; tooShort?: boolean }

export type SearchStatus = 'idle' | 'tooShort' | 'loading' | 'loadingMore' | 'done' | 'error';

export interface SearchState<T> {
  status: SearchStatus;
  query: string;
  results: T[];
  nextOffset: number | null;
  /** server/client error code when status === 'error' */
  errorCode: string | null;
}

export interface Options<T> {
  fetcher: (query: string, offset: number, signal: AbortSignal) => Promise<Page<T>>;
  onChange: (state: SearchState<T>) => void;
  /** maps a thrown error to a code; `null` means "it was a cancellation, ignore" */
  classify: (error: unknown) => string | null;
  debounceMs?: number;
  minLen?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class SearchController<T extends { id: number }> {
  private opts: Options<T>;
  private state: SearchState<T> = { status: 'idle', query: '', results: [], nextOffset: null, errorCode: null };
  private timer: unknown = null;
  private ctrl: AbortController | null = null;
  private seq = 0;
  private debounceMs: number;
  private minLen: number;

  constructor(opts: Options<T>) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? 400;
    this.minLen = opts.minLen ?? 2;
  }

  getState(): SearchState<T> {
    return this.state;
  }

  private set(patch: Partial<SearchState<T>>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange(this.state);
  }

  private cancelPending() {
    if (this.timer !== null) {
      (this.opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
    this.ctrl?.abort();
    this.ctrl = null;
    this.seq++;
  }

  setQuery(raw: string) {
    const query = raw.trim();
    if (query === this.state.query && this.state.status !== 'idle') return;
    this.cancelPending();
    if (query === '') return this.set({ status: 'idle', query: '', results: [], nextOffset: null, errorCode: null });
    if (Array.from(query).length < this.minLen) return this.set({ status: 'tooShort', query, results: [], nextOffset: null, errorCode: null });
    this.set({ status: 'loading', query, errorCode: null });
    const schedule = this.opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = schedule(() => {
      this.timer = null;
      void this.run(query, 0, false);
    }, this.debounceMs);
  }

  /** Runs the current query again at once (Retry). */
  retry() {
    const q = this.state.query;
    if (!q || Array.from(q).length < this.minLen) return;
    this.cancelPending();
    this.set({ status: 'loading', errorCode: null });
    void this.run(q, 0, false);
  }

  loadMore() {
    const { status, nextOffset, query } = this.state;
    if (status !== 'done' || nextOffset === null) return;
    this.cancelPending();
    this.set({ status: 'loadingMore' });
    void this.run(query, nextOffset, true);
  }

  /** Re-fetches the first page of the current query without clearing the list (after an action changed relations). */
  refresh() {
    const q = this.state.query;
    if (!q || Array.from(q).length < this.minLen || this.state.status === 'loading') return;
    this.cancelPending();
    void this.run(q, 0, false, true);
  }

  dispose() {
    this.cancelPending();
  }

  private async run(query: string, offset: number, append: boolean, silent = false) {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const mine = ++this.seq;
    try {
      const page = await this.opts.fetcher(query, offset, ctrl.signal);
      if (mine !== this.seq || ctrl.signal.aborted) return; // superseded
      const merged = append ? [...this.state.results, ...page.results.filter((r) => !this.state.results.some((x) => x.id === r.id))] : page.results;
      this.set({ status: page.tooShort ? 'tooShort' : 'done', results: merged, nextOffset: page.nextOffset, errorCode: null });
    } catch (e) {
      if (mine !== this.seq || ctrl.signal.aborted) return;
      const code = this.opts.classify(e);
      if (code === null) return;
      if (silent) return; // a background refresh failing must not wipe the list
      this.set({ status: 'error', errorCode: code, ...(append ? {} : { results: [] }) });
    }
  }
}
