import { JobHandler } from "./base.handler";
import { AutomationActionJobHandler } from "./handlers/automationAction.handler";
import { AutomationEventJobHandler } from "./handlers/automationEvent.handler";
import { EmailJobHandler } from "./handlers/email.handler";
import { EmailMarketingJobHandler } from "./handlers/emailMarketing.handler";
import { MeetingJobHandler } from "./handlers/meeting.handler";
import { ReminderJobHandler } from "./handlers/reminder.handler";
import { ScoreRefreshJobHandler } from "./handlers/scoreRefresh.handler";
import { SegmentRefreshJobHandler } from "./handlers/segmentRefresh.handler";
import { SequenceStepJobHandler } from "./handlers/sequenceStep.handler";
import { WebhookNotifyJobHandler } from "./handlers/webhookNotify.handler";
import { WhatsAppBroadcastJobHandler } from "./handlers/whatsappBroadcast.handler";

export class JobRegistry {
  private static readonly handlers: Record<string, JobHandler> = {
    "crm.email": new EmailJobHandler(),
    "crm.meeting": new MeetingJobHandler(),
    "crm.reminder": new ReminderJobHandler(),
    "crm.sequence_step": new SequenceStepJobHandler(),
    "crm.automation_action": new AutomationActionJobHandler(),
    "crm.automation_event": new AutomationEventJobHandler(),
    "crm.score_refresh": new ScoreRefreshJobHandler(),
    "crm.segment_refresh": new SegmentRefreshJobHandler(),
    "crm.webhook_notify": new WebhookNotifyJobHandler(),
    "crm.whatsapp_broadcast": new WhatsAppBroadcastJobHandler(),
    "crm.email_marketing": new EmailMarketingJobHandler(),
  };

  static getHandler(type: string): JobHandler | undefined {
    return JobRegistry.handlers[type];
  }
}
