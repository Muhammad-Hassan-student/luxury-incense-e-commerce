import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { getIntegration } from "@/server/integrations";
import { getPreferences, listDevices } from "@/server/push";
import { NotificationSettings } from "@/components/pwa/notification-settings";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

/** "Chrome on Android" from a user agent — just enough to tell devices apart. */
function deviceLabel(ua: string | null) {
  if (!ua) return "Browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}${/Mobile/.test(ua) && os !== "iPhone" ? " (Mobile)" : ""}` : browser;
}

export default async function NotificationsPage() {
  const user = await requireUser("/account/notifications");
  const [t, format, prefs, devices, push] = await Promise.all([getTranslations("notifications"), getFormatter(), getPreferences(user.id), listDevices(user.id), getIntegration("push")]);
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-3">{t("title")}</p>
        <p className="max-w-xl text-sm text-muted">{t("intro")}</p>
      </div>
      <NotificationSettings
        enabled={push.enabled}
        prefs={prefs}
        devices={devices.map((d) => ({ id: d.id, endpoint: d.endpoint, label: deviceLabel(d.userAgent), added: format.dateTime(d.createdAt, { dateStyle: "medium" }) }))}
      />
    </div>
  );
}
