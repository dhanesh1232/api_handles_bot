import { dbConnect } from "../../lib/config.js";
import { ClientServiceConfig } from "../../model/clients/config.js";
import { ClientSecrets } from "../../model/clients/secrets.js";
import { ClientDataSource } from "../../model/clients/dataSource.js";
import { getTenantConnection } from "../../lib/tenantDb.js";
import { sendWhatsAppTemplate } from "../../lib/whatsapp.js";

/**
 * Multi-tenant Reminder Job
 * Polling at high frequency to catch exact reminder windows.
 */
export const tenantRemindersJob = async () => {
  try {
    // 1. Ensure connected to central services DB
    await dbConnect("services");

    // 2. Fetch all clients where reminders are enabled
    const enabledConfigs = await ClientServiceConfig.find({
      "cron.reminders.enabled": true,
      "services.whatsapp.enabled": true,
    });

    if (enabledConfigs.length === 0) return;

    const now = new Date();

    for (const config of enabledConfigs) {
      const { clientCode } = config;

      try {
        // 3. Get Secrets and Data Source
        const [secrets, dataSource] = await Promise.all([
          ClientSecrets.findOne({ clientCode }),
          ClientDataSource.findOne({ clientCode, isActive: true }),
        ]);

        if (!secrets || !dataSource) continue;

        const whatsappToken = secrets.getDecrypted("whatsappToken");
        const phoneId = secrets.getDecrypted("whatsappPhoneNumberId");

        if (!whatsappToken || !phoneId) continue;

        // 4. Connect to Tenant DB
        const conn = await getTenantConnection(clientCode, dataSource.getUri());
        const db = conn.db;

        // We assume a collection named 'appointments' or check config for custom collection
        const appointmentsCollection = db.collection("appointments");

        // 5. Find upcoming appointments based on dynamic timing rules
        const reminderRules = config?.cron?.reminders?.timingRules || [
          {
            minutesPrior: 60,
            tag: "1h_reminder",
            channel: "whatsapp",
            whatsappTemplateName: "appointment_reminder",
          },
          {
            minutesPrior: 15,
            tag: "15m_reminder",
            channel: "whatsapp",
            whatsappTemplateName: "consultation_ready",
          },
          {
            minutesPrior: 0,
            tag: "start_reminder",
            channel: "whatsapp",
            whatsappTemplateName: "meeting_started",
          },
        ];

        for (const rule of reminderRules) {
          const targetTimeStart = new Date(
            now.getTime() + rule.minutesPrior * 60000,
          );
          const targetTimeEnd = new Date(targetTimeStart.getTime() + 60000); // 1 minute window

          const query = {
            appointmentDate: { $gte: targetTimeStart, $lt: targetTimeEnd },
            [`remindersSent.${rule.tag}`]: { $ne: true },
            status: { $ne: "cancelled" },
          };

          const pendingReminders = await appointmentsCollection
            .find(query)
            .toArray();

          for (const appt of pendingReminders) {
            let waSent = false;
            let emailSent = false;

            // WhatsApp Dispatch
            if (
              (rule.channel === "whatsapp" || rule.channel === "both") &&
              appt.patientPhone
            ) {
              const components = [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: appt.patientName || "Patient" },
                    {
                      type: "text",
                      text: appt.appointmentDate.toLocaleTimeString(),
                    },
                    { type: "text", text: appt.location || "Nirvisham Clinic" },
                  ],
                },
              ];

              const res = await sendWhatsAppTemplate(
                phoneId,
                whatsappToken,
                appt.patientPhone,
                rule.whatsappTemplateName,
                components,
              );

              if (res.success) {
                waSent = true;
                console.log(
                  `✅ [${clientCode}] Sent WA Template ${rule.whatsappTemplateName} to ${appt.patientPhone}`,
                );
              }
            }

            // Email Dispatch
            if (
              (rule.channel === "email" || rule.channel === "both") &&
              appt.patientEmail
            ) {
              console.log(
                `📧 [${clientCode}] Dispatching Email Template ${rule.emailTemplateId} to ${appt.patientEmail}`,
              );
              // Mocking successful email dispatch for now
              emailSent = true;
            }

            // Update status if any configured channel sent successfully
            if (waSent || emailSent) {
              await appointmentsCollection.updateOne(
                { _id: appt._id },
                { $set: { [`remindersSent.${rule.tag}`]: true } },
              );
            }
          }
        }
      } catch (tenantErr) {
        console.error(
          `❌ Error processing tenant ${clientCode}:`,
          tenantErr.message,
        );
      }
    }
  } catch (err) {
    console.error("❌ Global Reminders Job Error:", err.message);
  }
};
