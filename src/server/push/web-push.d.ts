// Minimal types for the `web-push` package (it ships none; only the calls we use).
declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }
  export interface RequestOptions {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    timeout?: number;
  }
  export class WebPushError extends Error {
    statusCode: number;
    body: string;
    endpoint: string;
  }
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(subscription: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): Promise<SendResult>;
  const webpush: { generateVAPIDKeys: typeof generateVAPIDKeys; sendNotification: typeof sendNotification; WebPushError: typeof WebPushError };
  export default webpush;
}
