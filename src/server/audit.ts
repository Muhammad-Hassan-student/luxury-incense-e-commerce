import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

export function audit(
  actorId: string,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({ data: { actorId, action, entity, entityId, meta } });
}
