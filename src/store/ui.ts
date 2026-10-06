import { create } from "zustand";

type Panel = "cart" | "search" | "menu" | null;

type UIState = {
  panel: Panel;
  open: (p: Exclude<Panel, null>) => void;
  close: () => void;
  toggle: (p: Exclude<Panel, null>) => void;
  /** True once the intro loader has finished (or was skipped). Scenes wait for it before animating in. */
  introDone: boolean;
  setIntroDone: () => void;
};

export const useUI = create<UIState>((set) => ({
  panel: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
  toggle: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  introDone: false,
  setIntroDone: () => set({ introDone: true }),
}));
