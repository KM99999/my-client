import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";

// A transaction client or the base client — so events can be logged inside the
// same transaction as the state change they describe.
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Comprehensive event logging for all actions (client requirement).
 * Call at every state transition: slot reserved, reservation expired,
 * payment approved, webhook received, refund issued.
 *
 * Pass `tx` to record the event atomically with the change it describes.
 */
export async function logEvent(
  type: string,
  data: { slotId?: string; refId?: string; payload?: unknown } = {},
  db: Db = prisma
) {
  await db.eventLog.create({
    data: {
      type,
      slotId: data.slotId,
      refId: data.refId,
      payload: (data.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
