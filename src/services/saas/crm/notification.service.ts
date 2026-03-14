import { getCrmModels } from "@lib/tenant/crm.models";
import { tenantLogger } from "@/lib/logger";
import { ActionExecutor } from "@services/saas/automation/actionExecutor.service";

/**
 * Creates a new notification record.
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
 * Retries the action associated with a notification.
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
