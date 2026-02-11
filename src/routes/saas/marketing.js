import express from "express";
import { validateClientKey } from "../../middleware/saasAuth.js";
import { createGoogleMeetService } from "../../services/saas/googleMeetService.js";
import { createEmailService } from "../../services/saas/mail/emailService.js";
import { GetURI, tenantDBConnect } from "../../lib/tenant/connection.js";
import { schemas } from "../../model/saas/tenantSchemas.js";

const router = express.Router();
const meetService = createGoogleMeetService();
const emailService = createEmailService();

/**
 * 1. CRM - Get Leads
 */
router.get("/crm/leads", validateClientKey, async (req, res) => {
  try {
    const { clientCode } = req;
    const uri = await GetURI(clientCode);
    const conn = await tenantDBConnect(uri);
    const Lead = conn.models["Lead"] || conn.model("Lead", schemas.leads);

    const leads = await Lead.find({}).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 2. CRM - Update Lead Status
 */
router.patch("/crm/leads/:id/status", validateClientKey, async (req, res) => {
  try {
    const { clientCode } = req;
    const { id } = req.params;
    const { status } = req.body;

    const uri = await GetURI(clientCode);
    const conn = await tenantDBConnect(uri);
    const Lead = conn.models["Lead"] || conn.model("Lead", schemas.leads);

    const lead = await Lead.findByIdAndUpdate(id, { status }, { new: true });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 3. Google Meet - Create Meeting
 */
router.post("/meetings/create", validateClientKey, async (req, res) => {
  try {
    const { clientCode } = req;
    const result = await meetService.createMeeting(clientCode, req.body);
    res.status(result.success ? 201 : 400).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4. Email Marketing - Send Campaign
 */
router.post("/emails/campaign", validateClientKey, async (req, res) => {
  try {
    const { clientCode } = req;
    const { recipients, subject, html } = req.body;

    if (!recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ error: "Recipients must be an array" });
    }

    const result = await emailService.sendCampaign(clientCode, {
      recipients,
      subject,
      html,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
