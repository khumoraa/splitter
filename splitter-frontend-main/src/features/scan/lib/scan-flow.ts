/**
 * State machine of one recognition attempt (processing screen). Pure reducer, no React.
 * uploading -> reading -> checking -> done, with error / cancelled as terminal states.
 */
export type ScanPhase = 'idle' | 'uploading' | 'reading' | 'checking' | 'done' | 'error' | 'cancelled';

export interface ScanFlowState {
  phase: ScanPhase;
  /** server/client error code when phase === 'error' */
  errorCode: string | null;
  /** true when the request takes longer than expected: the UI explains it and keeps Cancel visible */
  slow: boolean;
}

export type ScanFlowEvent =
  | { type: 'START' }
  | { type: 'UPLOADED' }
  | { type: 'RESPONSE_OK' }
  | { type: 'FINISHED' }
  | { type: 'FAIL'; code: string }
  | { type: 'SLOW' }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export const initialScanFlow: ScanFlowState = { phase: 'idle', errorCode: null, slow: false };

const ACTIVE: ScanPhase[] = ['uploading', 'reading', 'checking'];

export function scanFlowReducer(state: ScanFlowState, event: ScanFlowEvent): ScanFlowState {
  switch (event.type) {
    case 'START':
      return ACTIVE.includes(state.phase) ? state : { phase: 'uploading', errorCode: null, slow: false };
    case 'UPLOADED':
      return state.phase === 'uploading' ? { ...state, phase: 'reading' } : state;
    case 'RESPONSE_OK':
      return ACTIVE.includes(state.phase) ? { ...state, phase: 'checking', slow: false } : state;
    case 'FINISHED':
      return state.phase === 'checking' ? { ...state, phase: 'done' } : state;
    case 'FAIL':
      return ACTIVE.includes(state.phase) ? { phase: 'error', errorCode: event.code, slow: false } : state;
    case 'SLOW':
      return ACTIVE.includes(state.phase) ? { ...state, slow: true } : state;
    case 'CANCEL':
      return ACTIVE.includes(state.phase) ? { phase: 'cancelled', errorCode: null, slow: false } : state;
    case 'RESET':
      return initialScanFlow;
    default:
      return state;
  }
}

/** Index of the step to highlight (0 uploading, 1 reading, 2 checking), -1 when none. */
export const stepIndex = (phase: ScanPhase): number => (phase === 'uploading' ? 0 : phase === 'reading' ? 1 : phase === 'checking' || phase === 'done' ? 2 : -1);
