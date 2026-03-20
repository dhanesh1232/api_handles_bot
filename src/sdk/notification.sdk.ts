/**
 * @file notification.sdk.ts
 * @module NotificationSDK
 * @responsibility Facade for managing actionable notifications and failure alerts.
 * @dependencies notification.service.ts
 */

import { tenantLogger } from "@lib/logger";
import {
  createNotification,
  dismissAllNotifications,
  dismissNotification,
  getUnreadNotifications,
  retryNotificationAction,
} from "@services/saas/crm/notification.service";

export class NotificationSDK {
  constructor(private readonly clientCode: string) {}

  /**
   * Retrieves a list of unread notifications for the current tenant.
   *
   * @returns {Promise<INotification[]>}
   */
  async listUnread() {
    return getUnreadNotifications(this.clientCode);
  }

  /**
   * Dispatches a new notification to the tenant's admin dashboard.
   *
   * **WORKING PROCESS:**
   * 1. Logs the notification intent.
   * 2. Saves the notification document to the `Notification` collection.
   * 3. Emits a Socket.io event to provide real-time UI updates.
   *
   * @param {object} data - Title, message, level (alert/info), and metadata.
   * @returns {Promise<INotification>}
   */
  async create(data: {
    title: string;
    message: string;
    type: "action_required" | "alert" | "info";
    actionData?: any;
  }) {
    tenantLogger(this.clientCode).info(
      { title: data.title },
      "Creating notification",
    );
    return createNotification(this.clientCode, data);
  }

  /**
   * Marks a single notification as read/dismissed.
   *
   * @param {string} id - Notification identifier.
   * @returns {Promise<void>}
   */
  async dismiss(id: string) {
    tenantLogger(this.clientCode).info(
      { notificationId: id },
      "Dismissing notification",
    );
    return dismissNotification(this.clientCode, id);
  }

  /**
   * Mark all unread notifications as dismissed in a single operation.
   *
   * @returns {Promise<void>}
   */
  async dismissAll() {
    tenantLogger(this.clientCode).info("Dismissing all notifications");
    return dismissAllNotifications(this.clientCode);
  }

  /**
   * Retries the original action associated with a notification.
   *
   * **WORKING PROCESS:**
   * 1. Fetches the notification and verifies the `actionData`.
   * 2. Re-submits the action to the relevant service (CRM or Automation).
   * 3. On success, dismisses the notification automatically.
   *
   * @param {string} id - Notification identifier.
   * @returns {Promise<any>}
   */
  async retry(id: string) {
    tenantLogger(this.clientCode).info(
      { notificationId: id },
      "Retrying notification action",
    );
    return retryNotificationAction(this.clientCode, id);
  }

  /**
   * High-level helper for creating red-flag failure alerts with built-in retry context.
   *
   * **WORKING PROCESS:**
   * 1. Aggregates error details and the original action configuration.
   * 2. Captures a context snapshot for debugging.
   * 3. Wraps the payload into an `action_required` notification.
   *
   * @param {object} input - Failure metadata and context.
   * @returns {Promise<INotification>}
   */
  async createFailureAlert(input: {
    title: string;
    message: string;
    leadId: string;
    actionType: string;
    actionConfig: any;
    error: string;
    contextSnapshot?: any;
  }) {
    return this.create({
      title: input.title,
      message: input.message,
      type: "action_required",
      actionData: {
        leadId: input.leadId,
        actionType: input.actionType,
        actionConfig: input.actionConfig,
        error: input.error,
        contextSnapshot: input.contextSnapshot,
      },
    });
  }
}
