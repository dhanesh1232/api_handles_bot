import express, { type Request, type Response } from "express";
import { dbConnect } from "../../lib/config.ts";
import { Lead } from "../../model/services/leads.ts";

const router = express.Router();

// Simple scoring logic
function calculateScore(service: string, timeline: string): number {
  let score = 0;

  if (service !== "Basic Website") score += 20;
  if (timeline.includes("Urgent")) score += 30;
  if (timeline.includes("Within")) score += 10;

  return score;
}

router.post("/add-lead", async (req: Request, res: Response) => {
  await dbConnect("services");
  try {
    const {
      name,
      phone,
      email,
      title,
      categoryName,
      city,
      state,
      street,
      serviceSelected,
      timeline,
      purpose,
    } = req.body;

    // ----------- VALIDATION ----------
    if (!name || !phone || !title) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, and business name are required.",
      });
    }

    // Check for existing lead (same phone or business name)
    const existingLead = await Lead.findOne({
      $or: [{ phone }, { title: new RegExp("^" + title + "$", "i") }],
    });

    if (existingLead) {
      return res.status(200).json({
        success: false,
        exists: true,
        message: "Lead already exists.",
      });
    }

    // --------- CREATE LEAD ----------
    const leadScore = calculateScore(serviceSelected || "", timeline || "");

    const newLead = await Lead.create({
      name,
      title,
      phone,
      email: email || null,
      categoryName,
      city,
      state,
      street,
      purpose,
      timeline,
      serviceSelected,
      status: "new",
      source: "website",
      leadScore,
      rating: 0,
      reviewsCount: 0,
      activity: [
        {
          type: "created",
          message: `Lead submitted via website (${serviceSelected})`,
        },
      ],
      tags: ["Website Offer", categoryName, "Created"].filter(Boolean),
    });

    return res.status(201).json({
      success: true,
      message: "Lead created successfully.",
      data: newLead,
    });
  } catch (err: any) {
    console.error("❌ Lead error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
