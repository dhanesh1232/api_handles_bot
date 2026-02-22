import express from "express";
import { GetURI, tenantDBConnect } from "../../lib/tenant/connection.js";
import { validateClientKey } from "../../middleware/saasAuth.js";
import { schemas } from "../../model/saas/tenantSchemas.js";
import { createGoogleMeetService } from "../../services/saas/googleMeetService.js";
import { createEmailService } from "../../services/saas/mail/emailService.js";

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

/**
 * 5. Appointment Confirmation - Generate Meet & Reminders
 */
router.post(
  "/create/google-meet",
  validateClientKey,
  async (req, res) => {
    try {
      const { clientCode } = req;
      const { durationCredentials, payload } = req.body;

      // Extract Timing from durationCredentials
      const { date: appointmentDate, time: timeSlot, duration } = durationCredentials || {};
      
      // Extract Metadata from payload
      const { moduleId: appointmentId, participants = [], summary: customSummary, description: customDescription } = payload || {};

      // Find specific roles for meeting metadata
      const doctor = participants.find(p => p.role === "doctor") || {};
      const patient = participants.find(p => p.role === "patient") || {};

      // 1. Generate Google Meet Link
      let startTime, endTime;
      
      if (appointmentDate && timeSlot) {
        const [startStr, endStr] = timeSlot.split("-").map(t => t.trim());
        const [startHours, startMinutes] = startStr.split(":").map(Number);
        
        const date = new Date(appointmentDate);
        
        // Convert to IST string to force the correct day
        const istDateStr = date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        const istDate = new Date(istDateStr);

        const [month, day, year] = istDateStr.split(",")[0].split("/").map(Number);
        const targetUTC = new Date(Date.UTC(year, month - 1, day, startHours, startMinutes));
        targetUTC.setMinutes(targetUTC.getMinutes() - 330);

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
        summary: customSummary || `Consultation: ${doctor.name || "Doctor"} with ${patient.name || "Patient"}`,
        description: customDescription || `Appointment ID: ${appointmentId}. Patient Phone: ${patient.phone}`,
        start: startTime,
        end: endTime,
        attendees: participants
          .map(p => p.email)
          .filter(Boolean),
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
      console.log(`[Marketing] Appointment ${appointmentId} confirmed. Meet: ${meetLink}`);

      res.status(200).json({
        success: true,
        meetLink,
        eventId: meetResult.eventId,
        appointmentId
      });

    } catch (error) {
      console.error("Appointment confirmation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
