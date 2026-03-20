import { getCrmModels } from "@lib/tenant/crm.models";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";
import { tenantLogger } from "@/lib/logger";

/**
 * Creates a new notification record.
 */
/**
 * Creates a new system notification and emits a real-time event.
 *
 * **WORKING PROCESS:**
 * 1. Model Initialization: Connects to the tenant's `Notification` model.
 * 2. Record Creation: Persists the notification with the provided payload (title, message, type, actionData).
 * 3. Real-time Dispatch: Uses the global Socket.IO instance (`io`) to emit the `notification:new` event to the client's room.
 *
 * **EDGE CASES:**
 * - Socket Offline: If the global `io` is not defined, the notification is still saved to the DB but not emitted in real-time.
 */
export const createNotification = async (
  clientCode: string,
  input: Record<string, any>,
) => {
  const { Notification } = await getCrmModels(clientCode);
  const notif = await Notification.create({
    clientCode,
    ...input,
  });

  // Emit real-time creation event
  const io = (global as any).io;
  if (io) {
    io.to(clientCode).emit("notification:new", notif.toObject());
  }

  return notif.toObject();
};

/**
 * Lists unread notifications, populated with lead info.
 */
export const getUnreadNotifications = async (clientCode: string) => {
  const { Notification } = await getCrmModels(clientCode);
  return await Notification.find({
    clientCode,
    status: "unread",
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("actionData.leadId", "firstName lastName phone email _id")
    .lean();
};

/**
 * Marks a notification as dismissed.
 */
export const dismissNotification = async (clientCode: string, id: string) => {
  const { Notification } = await getCrmModels(clientCode);
  const notif = await Notification.findOneAndUpdate(
    { _id: id, clientCode },
    { $set: { status: "dismissed" } },
    { returnDocument: "after" },
  ).lean();

  if (!notif) throw new Error("Notification not found");

  // Emit real-time dismissal event
  const io = (global as any).io;
  if (io) {
    io.to(clientCode).emit("notification:dismissed", { id });
  }

  return notif;
};

/**
 * Marks all unread notifications as dismissed for a tenant.
 */
export const dismissAllNotifications = async (clientCode: string) => {
  const { Notification } = await getCrmModels(clientCode);
  await Notification.updateMany(
    { clientCode, status: "unread" },
    { $set: { status: "dismissed" } },
  );

  // Emit real-time bulk dismissal event
  const io = (global as any).io;
  if (io) {
    io.to(clientCode).emit("notification:dismissed_all");
  }

  return { success: true };
};

/**
 * Retries the action associated with a notification.
 */
/**
 * Re-attempts an automation action that previously failed or required manual intervention.
 *
 * **WORKING PROCESS:**
 * 1. Verification: Fetches the unread notification and ensures it contains the necessary `actionData`.
 * 2. Lead Validation: Verifies the target lead still exists in the CRM.
 * 3. Action Execution: Re-runs the `ActionExecutor.execute` logic with the original context snapshot.
 * 4. State Transition: Upon success, marks the notification as "resolved" and emits a real-time update.
 *
 * **EDGE CASES:**
 * - Stale Data: If the lead has been deleted, the retry fails with an explicit error.
 * - Double Retry: Prevents retrying notifications that aren't in the "unread" status.
 */
export const retryNotificationAction = async (
  clientCode: string,
  id: string,
) => {
  const { Notification, Lead } = await getCrmModels(clientCode);

  const notif = await Notification.findOne({
    _id: id,
    clientCode,
    status: "unread",
  }).lean();

  if (!notif) throw new Error("Notification not found or already resolved");

  const { actionConfig, leadId, contextSnapshot } = notif.actionData || {};

  if (!actionConfig || !leadId) {
    throw new Error(
      "Missing action configuration or Lead ID in notification payload",
    );
  }

  const lead = await Lead.findOne({ _id: leadId, clientCode }).lean();
  if (!lead) throw new Error("Lead no longer exists");

  const safeVariables = (contextSnapshot as any) || {};

  // Try executing the action again
  try {
    await ActionExecutor.execute(
      clientCode,
      { type: actionConfig.type, config: actionConfig },
      { lead: lead as any, variables: safeVariables },
      (global as any).io,
    );

    // If it succeeds, mark as resolved
    await Notification.updateOne(
      { _id: id, clientCode },
      { $set: { status: "resolved" } },
    ).lean();

    // Emit real-time resolution event
    const io = (global as any).io;
    if (io) {
      io.to(clientCode).emit("notification:resolved", { id });
    }

    tenantLogger(clientCode).info(
      { notificationId: id },
      "Notification action successfully retried",
    );
    return { success: true };
  } catch (err: any) {
    tenantLogger(clientCode).error(
      { err, notificationId: id },
      "Notification retry failed",
    );
    throw err;
  }
};
