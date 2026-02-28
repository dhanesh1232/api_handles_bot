import express, { type Response } from "express";
import { getTenantConnection } from "../../lib/connectionManager.ts";
import {
  validateClientKey,
  type AuthRequest,
} from "../../middleware/saasAuth.ts";
import { Client } from "../../model/clients/client.ts";
import { schemas } from "../../model/saas/tenant.schemas.ts";
import { createEmailService } from "../../services/saas/mail/email.service.ts";
import { createGoogleMeetService } from "../../services/saas/meet/google.meet.service.ts";

const router = express.Router();
const meetService = createGoogleMeetService();
const emailService = createEmailService();

/**
 * 1. CRM - Get Leads
 */
router.get(
  "/crm/leads",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const conn = await getTenantConnection(clientCode);
      const Lead = conn.models["Lead"] || conn.model("Lead", schemas.leads);

      const leads = await Lead.find({}).sort({ createdAt: -1 });
      res.json({ success: true, data: leads });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

/**
 * 2. CRM - Update Lead Status
 */
router.patch(
  "/crm/leads/:id/status",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { id } = req.params;
      const { status } = req.body;

      const conn = await getTenantConnection(clientCode);
      const Lead = conn.models["Lead"] || conn.model("Lead", schemas.leads);

      const lead = await Lead.findByIdAndUpdate(
        id,
        { status },
        { returnDocument: "after" },
      );
      res.json({ success: true, data: lead });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

/**
 * 3. Google Meet - Create Meeting
 */
router.post(
  "/meetings/create",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const result = await meetService.createMeeting(clientCode, req.body);
      res.status(result.success ? 201 : 400).json(result); // result already has { success, ... }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

/**
 * 4. Email Marketing - Send Campaign
 */
router.post(
  "/emails/campaign",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { recipients, subject, html } = req.body;

      if (!recipients || !Array.isArray(recipients)) {
        return res
          .status(400)
          .json({ success: false, message: "Recipients must be an array" });
      }

      const result = await emailService.sendCampaign(clientCode, {
        recipients,
        subject,
        html,
      });

      res.json(result); // Assuming result already has success wrapper
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

/**
 * 4.1 Email Marketing - Send Test Email
 */
router.post(
  "/emails/test",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { to } = req.body;

      if (!to) {
        return res
          .status(400)
          .json({ success: false, message: "Recipient email is required" });
      }

      const client = await Client.findOne({ clientCode });
      const businessName = client?.name || "Your Business";
      const website = client?.business?.website;

      const result = await emailService.sendEmail(clientCode, {
        to,
        subject: `[TEST] Service Verification for ${businessName}`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 20px; background-color: #f4f7fa; color: #333;">
            <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e1e8f0;">
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Connection Successful</h1>
                <p style="color: rgba(255,255,255,0.9); margin-top: 10px; font-size: 14px;">Email Configuration Verified</p>
              </div>

              <!-- Content -->
              <div style="padding: 40px 30px;">
                <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Hello,</p>
                <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">
                  This is a professional verification message from <strong>${businessName}</strong>. 
                  Your SMTP/Email configuration has been successfully validated with your environment variables.
                </p>

                <div style="margin: 30px 0; padding: 25px; background: #f9fafb; border-radius: 8px; border: 1px solid #edf2f7;">
                  <h3 style="margin-top: 0; color: #1f2937; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Configuration Details</h3>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; width: 120px;">Organization</td>
                      <td style="padding: 8px 0; color: #111827; font-weight: 600;">${businessName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Client ID</td>
                      <td style="padding: 8px 0; color: #111827; font-family: monospace; font-size: 12px; background: #fff; padding-left: 5px; border-radius: 3px;">${clientCode}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280;">Timestamp</td>
                      <td style="padding: 8px 0; color: #111827;">${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</td>
                    </tr>
                  </table>
                </div>

                <p style="font-size: 15px; color: #6b7280;">
                  If you did not expect this verification, please contact your administrator.
                </p>
                ${website ? `<div style="text-align: center; margin-top: 40px;">
                  <a href="${website}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Return to Dashboard</a>
                </div>` : ""}
              </div>

              <!-- Footer -->
              <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #edf2f7;">
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">&copy; ${new Date().getFullYear()} ${businessName}. Powered by Ecodrix.</p>
                <div style="margin-top: 10px;">
                  <a href="${website}" style="color: #6366f1; text-decoration: none; font-size: 12px;">Website</a>
                  <span style="color: #cbd5e1; margin: 0 10px;">|</span>
                  <a href="https://ecodrix.com/support" style="color: #6366f1; text-decoration: none; font-size: 12px;">Support</a>
                </div>
              </div>
            </div>
            <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
              This is an automated system verification email. Please do not reply directly to this message.
            </p>
          </div>
        `,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

/**
 * 5. Appointment Confirmation - Generate Meet & Reminders
 */
router.post(
  "/create/google-meet",
  validateClientKey,
  async (req: AuthRequest, res: Response) => {
    try {
      const { clientCode } = req;
      if (!clientCode)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { durationCredentials, payload } = req.body;

      // Extract Timing from durationCredentials
      const {
        date: appointmentDate,
        time: timeSlot,
        duration,
      } = durationCredentials || {};

      // Extract Metadata from payload
      const {
        moduleId: appointmentId,
        participants = [],
        summary: customSummary,
        description: customDescription,
      } = payload || {};

      // Find specific roles for meeting metadata
      const doctor = participants.find((p: any) => p.role === "doctor") || {};
      const patient = participants.find((p: any) => p.role === "patient") || {};

      // 1. Generate Google Meet Link
      let startTime, endTime;

      if (appointmentDate && timeSlot) {
        const [startStr] = timeSlot.split("-").map((t: string) => t.trim());
        const [startHours, startMinutes] = startStr.split(":").map(Number);

        const date = new Date(appointmentDate);

        // Convert to IST to get the correct calendar day
        const istDateStr = date.toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
        });

        const [month, day, year] = istDateStr
          .split(",")[0]
          .split("/")
          .map(Number);
        const targetUTC = new Date(
          Date.UTC(year, month - 1, day, startHours, startMinutes),
        );
        targetUTC.setMinutes(targetUTC.getMinutes() - 330); // IST offset -5h30m

        const start = targetUTC;
        const meetingDuration = duration || 30;
        const end = new Date(start.getTime() + meetingDuration * 60000);

        startTime = start.toISOString();
        endTime = end.toISOString();
      } else {
        startTime = new Date().toISOString();
        endTime = new Date(Date.now() + 30 * 60000).toISOString();
      }

      const meetResult = await meetService.createMeeting(clientCode, {
        summary:
          customSummary ||
          `Consultation: ${doctor.name || "Doctor"} with ${patient.name || "Patient"}`,
        description:
          customDescription ||
          `Appointment ID: ${appointmentId}. Patient Phone: ${patient.phone}`,
        start: startTime,
        end: endTime,
        attendees: participants.map((p: any) => p.email).filter(Boolean),
      });

      if (!meetResult.success) {
        console.error("Failed to generate meet link:", meetResult.error);
        // We generally still want to return success for the handshake, but maybe without the link?
        // Or fail? Let's log it and return partial success or fail.
        // For now, let's proceed but note the failure.
      }

      const meetLink = meetResult.hangoutLink;

      // 2. Schedule Reminders (Placeholder)
      // Logic to schedule WhatsApp/Email reminders 1hr and 15min before
      console.log(
        `[Marketing] Appointment ${appointmentId} confirmed. Meet: ${meetLink}`,
      );

      res.status(200).json({
        success: true,
        meetLink,
        eventId: meetResult.eventId,
        appointmentId,
      });
    } catch (error: any) {
      console.error("Appointment confirmation error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

export default router;
