"use client";

import { setProductActive } from "@/actions/admin-catalog";
import { setCouponActive } from "@/actions/admin-coupons";
import { setBlockEnabled } from "@/actions/admin-content";
import { setFeatureFlag } from "@/actions/admin-settings";
import type { ActionResult } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";
import { useAdminAction } from "./use-admin-action";

/** Accessible on/off switch that calls a server action. Disabled (read-only) when `canEdit` is false. */
function Switch({ checked, label, canEdit, call }: { checked: boolean; label: string; canEdit: boolean; call: (next: boolean) => Promise<ActionResult> }) {
  const { pending, run } = useAdminAction();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={!canEdit || pending}
      onClick={() => run(() => call(!checked))}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors duration-300 disabled:cursor-not-allowed",
        checked ? "border-gold bg-gold/20" : "border-line-strong bg-transparent",
        pending && "opacity-50",
        !canEdit && "opacity-60",
      )}
    >
      <span className={cn("absolute size-3 transition-transform duration-300", checked ? "translate-x-[1.1rem] bg-gold" : "translate-x-[0.2rem] bg-subtle")} />
    </button>
  );
}

export function ProductActiveToggle({ id, name, isActive, canEdit }: { id: string; name: string; isActive: boolean; canEdit: boolean }) {
  return <Switch checked={isActive} canEdit={canEdit} label={`${name} visible in store`} call={(next) => setProductActive({ id, isActive: next })} />;
}

export function CouponActiveToggle({ id, code, isActive, canEdit }: { id: string; code: string; isActive: boolean; canEdit: boolean }) {
  return <Switch checked={isActive} canEdit={canEdit} label={`${code} active`} call={(next) => setCouponActive({ id, isActive: next })} />;
}

export function BlockEnabledToggle({ id, type, enabled, canEdit }: { id: string; type: string; enabled: boolean; canEdit: boolean }) {
  return <Switch checked={enabled} canEdit={canEdit} label={`Show ${type} block`} call={(next) => setBlockEnabled({ id, enabled: next })} />;
}

export function FeatureFlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  return <Switch checked={enabled} canEdit label={`Feature ${flagKey}`} call={(next) => setFeatureFlag({ key: flagKey, enabled: next })} />;
}
