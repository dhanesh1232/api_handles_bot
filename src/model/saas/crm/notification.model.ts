/**
 * @module CRM/NotificationModel
 * @responsibility Manages tenant alerts and required actions for CRM users.
 *
 * **WORKING PROCESS:**
 * 1. Actionability: Notifications of type `action_required` store a `contextSnapshot`.
 * 2. Resolution: Users can "resolve" (retry action) or "dismiss" (hide).
 * 3. Context: Tracks the original lead and automation config that triggered the alert.
 */
import mongoose, { type Schema } from "mongoose";

const notificationSchema: Schema<INotification> = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["action_required", "alert", "info"],
      default: "info",
    },
    status: {
      type: String,
      enum: ["unread", "resolved", "dismissed"],
      default: "unread",
      index: true,
    },
    actionData: {
      actionConfig: { type: mongoose.Schema.Types.Mixed },
      leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lead",
        index: true,
      },
      contextSnapshot: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true },
);

notificationSchema.index({ clientCode: 1, status: 1 });
notificationSchema.index({ clientCode: 1, createdAt: -1 });

export { notificationSchema as NotificationSchema };
export default notificationSchema;
