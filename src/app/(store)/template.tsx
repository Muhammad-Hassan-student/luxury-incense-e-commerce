"use client";

import { motion } from "framer-motion";
import { ease } from "@/lib/motion";

/** Re-mounts on every navigation: each page settles in with a slow lift. */
export default function StoreTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease }}>
      {children}
    </motion.div>
  );
}
