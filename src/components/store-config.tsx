"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Store settings the client UI needs everywhere (cards, quick view) without prop-drilling through server pages. */
export type StoreConfig = { lowStock: number };

const Ctx = createContext<StoreConfig>({ lowStock: 10 });

export function StoreConfigProvider({ value, children }: { value: StoreConfig; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStoreConfig = () => useContext(Ctx);
