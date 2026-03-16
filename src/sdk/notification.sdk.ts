/**
 * NotificationSDK
 *
 * Facade for managing actionable notifications.
 * Supports failure highlights, dismissal, and automated retries.
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
   * List unread notifications for the tenant.
   */
  async listUnread() {
    return getUnreadNotifications(this.clientCode);
  }

  /**
   * Create a new notification (e.g. for a failure alert).
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
   * Dismiss a specific notification.
   */
  async dismiss(id: string) {
    tenantLogger(this.clientCode).info(
      { notificationId: id },
      "Dismissing notification",
    );
    return dismissNotification(this.clientCode, id);
  }

  /**
   * Dismiss all unread notifications for the tenant.
   */
  async dismissAll() {
    tenantLogger(this.clientCode).info("Dismissing all notifications");
    return dismissAllNotifications(this.clientCode);
  }

  /**
   * Retry an actionable notification.
   */
  /**
   * Retry an actionable notification.
   */
  async retry(id: string) {
    tenantLogger(this.clientCode).info(
      { notificationId: id },
      "Retrying notification action",
    );
    return retryNotificationAction(this.clientCode, id);
  }

  /**
   * Create an actionable failure alert.
   * Useful for automation failures where a human needs to intervene or retry.
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
