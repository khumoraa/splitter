import { create } from 'zustand';

/** The photo travelling camera/gallery -> preview -> processing. In memory only; the file lives in the app cache and is deleted after sending. */
export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
  source: 'camera' | 'gallery';
  /** guide-frame crop in the photo's own pixels (camera only); null = use the whole photo */
  frameCrop: { originX: number; originY: number; width: number; height: number } | null;
}

interface CaptureStore {
  photo: CapturedPhoto | null;
  /** prepared JPEG sent to the server; kept until the attempt ends so Retry reuses the same bytes and Idempotency-Key */
  prepared: { base64: string; uri: string; idempotencyKey: string } | null;
  setPhoto: (photo: CapturedPhoto | null) => void;
  setPrepared: (p: CaptureStore['prepared']) => void;
}

export const useCaptureStore = create<CaptureStore>((set) => ({
  photo: null,
  prepared: null,
  setPhoto: (photo) => set({ photo, prepared: null }),
  setPrepared: (prepared) => set({ prepared }),
}));
