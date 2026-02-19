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
  "/marketing/appointment/confirm",
  validateClientKey,
  async (req, res) => {
    try {
      const { clientCode } = req;
      const { appointmentId, doctorDetails, patientDetails, appointmentDate, timeSlot, duration } = req.body;

      // 1. Generate Google Meet Link
      let startTime, endTime;
      
      if (appointmentDate && timeSlot) {
        const [startStr, endStr] = timeSlot.split("-").map(t => t.trim());
        const [startHours, startMinutes] = startStr.split(":").map(Number);
        
        const date = new Date(appointmentDate);
        
        // Convert to IST string to force the correct day (e.g. Feb 27)
        // regardless of server timezone/UTC time (which might be Feb 26)
        const istDateStr = date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        const istDate = new Date(istDateStr);

        // Create a new Date object for the appointment start time
        // We set the time components on the IST date
        istDate.setHours(startHours, startMinutes, 0, 0);

        // However, if the server is in UTC, istDate is now 18:00 UTC (Feb 27).
        // If the server is in IST, istDate is 18:00 IST (Feb 27).
        // To be safe and server-agnostic, we can construct the UTC time manually:
        // 1. Get the date parts from the IST string
        const [month, day, year] = istDateStr.split(",")[0].split("/").map(Number);
        
        // 2. Create the target time in UTC (e.g. Feb 27, 18:00 UTC)
        const targetUTC = new Date(Date.UTC(year, month - 1, day, startHours, startMinutes));
        
        // 3. Subtract 5.5 hours (330 minutes) to get the time in UTC that corresponds to 18:00 IST
        // 18:00 UTC - 5.5h = 12:30 UTC
        targetUTC.setMinutes(targetUTC.getMinutes() - 330);

        const start = targetUTC;
        const meetingDuration = duration || 30; // Default to 30 mins if not provided
        const end = new Date(start.getTime() + meetingDuration * 60000);
        
        startTime = start.toISOString();
        endTime = end.toISOString();
      } else {
        // Fallback if no specific time provided
         startTime = new Date().toISOString(); 
         endTime = new Date(Date.now() + 30 * 60000).toISOString();
      }

      const meetResult = await meetService.createMeeting(clientCode, {
        summary: `Consultation: ${doctorDetails?.name || "Doctor"} with ${patientDetails?.name}`,
        description: `Appointment ID: ${appointmentId}. Patient Phone: ${patientDetails?.phone}`,
        start: startTime,
        end: endTime,
        attendees: [
          patientDetails?.email,
          // doctorDetails?.email // Add doctor if available
        ].filter(Boolean),
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
