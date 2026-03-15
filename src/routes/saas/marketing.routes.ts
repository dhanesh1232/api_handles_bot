import express, { type Response } from "express";
import { Server } from "socket.io";
import { getCrmModels } from "@/lib/tenant/crm.models";
import { type AuthRequest, validateClientKey } from "@/middleware/saasAuth";
import { withSDK } from "@/middleware/withSDK";
import { Client } from "@/model/clients/client";
import { createEmailService } from "@/services/saas/mail/email.service";
import { normalizePhone } from "@/utils/phone";

/**
 * createMarketingRouter
 * Factory to create marketing routes with injected io and SDK.
 * Handles specialized marketing actions like email campaigns.
 * Core CRM and Meet actions are handled by their respective dedicated routers.
 */
export const createMarketingRouter = (io: Server) => {
  const router = express.Router();
  const emailService = createEmailService();

  // Primary middleware for all marketing routes
  router.use(validateClientKey);
  router.use(withSDK(io));

  /**
   * 1. Email Marketing - Send Campaign
   */
  router.post("/emails/campaign", async (req: AuthRequest, res: Response) => {
    try {
      const { recipients, subject, html } = req.body;

      if (!recipients || !Array.isArray(recipients)) {
        return res
          .status(400)
          .json({ success: false, message: "Recipients must be an array" });
      }

      const result = await emailService.sendCampaign(req.clientCode!, {
        recipients,
        subject,
        html,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * 2. Email Marketing - Send Test Email
   */
  router.post("/emails/test", async (req: AuthRequest, res: Response) => {
    try {
      const { to } = req.body;
      if (!to) {
        return res
          .status(400)
          .json({ success: false, message: "Recipient email is required" });
      }

      const client = await Client.findOne({ clientCode: req.clientCode });
      const businessName = client?.name || "Your Business";
      const website = client?.business?.website;

      const result = await emailService.sendEmail(req.clientCode!, {
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
                      <td style="padding: 8px 0; color: #111827; font-family: monospace; font-size: 12px; background: #fff; padding-left: 5px; border-radius: 3px;">${req.clientCode}</td>
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
                ${
                  website
                    ? `<div style="text-align: center; margin-top: 40px;">
                  <a href="${website}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Return to Dashboard</a>
                </div>`
                    : ""
                }
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
  });

  /**
   * 3. WhatsApp - Direct Template Send
   *
   * Sends a WhatsApp template message directly to a phone number.
   * Resolves template variable mapping from the tenant's db, then sends.
   * No automation queue — fires immediately.
   *
   * Body:
   *   phone        string — E.164 format (e.g. 919876543210)
   *   templateName string — exact template name in tenant db
   *   variables    Record<string, string> — flat KV of event/context data
   *                used to resolve the mapped variables (e.g. { pdfUrl, name })
   */
  router.post(
    "/whatsapp/send-template",
    async (req: AuthRequest, res: Response) => {
      try {
        const clientCode = req.clientCode!;
        const {
          phone: rawPhone,
          templateName,
          languageCode = "en",
          variables = {},
          resolvedVariables: providedResolvedVariables,
        } = req.body;

        if (!rawPhone || !templateName) {
          return res.status(400).json({
            success: false,
            message: "phone and templateName are required",
          });
        }

        const phone = normalizePhone(rawPhone);
        if (!phone || phone.length < 10) {
          return res.status(400).json({
            success: false,
            message: "Invalid phone number",
          });
        }

        const { Conversation, conn: tenantConn } =
          await getCrmModels(clientCode);

        let finalResolvedVariables = providedResolvedVariables;
        let finalLanguageCode = languageCode;

        // Only resolve if not already provided
        if (!finalResolvedVariables) {
          const { resolveUnifiedWhatsAppTemplate } = await import(
            "../../services/saas/whatsapp/template.service"
          );
          const resolution = await resolveUnifiedWhatsAppTemplate(
            tenantConn,
            templateName,
            {}, // No lead context needed
            variables,
          );

          if (!resolution.isReady) {
            return res.status(422).json({
              success: false,
              message: "Template variables could not be resolved",
              details: resolution.contextSnapshot,
            });
          }
          finalResolvedVariables = resolution.resolvedVariables;
          finalLanguageCode = resolution.languageCode || languageCode;
        }

        // Find or create conversation
        let conv = await Conversation.findOne({ phone }).lean();
        if (!conv) {
          const newConv = await Conversation.create({
            phone,
            userName: variables.name || phone,
            status: "open",
            channel: "whatsapp",
          });
          conv = newConv.toObject();
        }

        // Send directly
        const { createWhatsappService } = await import(
          "../../services/saas/whatsapp/whatsapp.service"
        );
        const svc = createWhatsappService(io);
        const message = await svc.sendOutboundMessage(
          clientCode,
          conv._id.toString(),
          undefined, // text
          undefined, // mediaUrl
          undefined, // mediaType
          "system", // userId
          templateName,
          finalLanguageCode,
          finalResolvedVariables,
        );

        return res.json({
          success: true,
          messageId: message._id,
          templateName,
          resolvedVariables: finalResolvedVariables,
        });
      } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
      }
    },
  );

  return router;
};
