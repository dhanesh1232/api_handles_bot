import { dbConnect } from "@lib/config";
import { Blueprint } from "@models/global/blueprint.model";
import { Staff } from "@models/global/staff.model";
import { HealthService } from "@services/global/health.service";
import { OrchestratorService } from "@services/global/orchestrator.service";
import { PortfolioService } from "@services/global/portfolio.service";
import { UsageService } from "@services/global/usage.service";
import express, { type Request, type Response } from "express";
import { verifyCoreToken } from "../../middleware/auth";

const router = express.Router();

/**
 * --- BLUEPRINTS (The Armory) ---
 */

// List all blueprints
router.get(
  "/blueprints",
  verifyCoreToken,
  async (_req: Request, res: Response) => {
    try {
      await dbConnect("services");
      const blueprints = await Blueprint.find().sort({ createdAt: -1 });
      res.json({ success: true, data: blueprints });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// Create a new blueprint (Save a "Gold Standard")
router.post(
  "/blueprints",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      await dbConnect("services");
      const blueprint = await Blueprint.create(req.body);
      res.status(201).json({ success: true, data: blueprint });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// Deploy blueprint to a tenant
router.post(
  "/blueprints/deploy",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      const { clientCode, blueprintId } = req.body;
      const result = await OrchestratorService.deployBlueprint(
        clientCode,
        blueprintId,
        "agency_admin",
      );
      res.json({ ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

/**
 * --- PORTFOLIO INTELLIGENCE ---
 */

// Get aggregate stats for an agency
router.get(
  "/portfolio/:agencyCode/stats",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      const stats = await PortfolioService.getAgencyStats(
        req.params.agencyCode as string,
      );
      res.json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// Proactive Health Report
router.get(
  "/portfolio/:agencyCode/health",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      const report = await HealthService.checkPortfolioHealth(
        req.params.agencyCode as string,
      );
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

/**
 * --- WEALTH (Usage & Billing) ---
 */

router.get(
  "/usage/:clientCode",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      const usage = await UsageService.getUsage(
        req.params.clientCode as string,
      );
      res.json({ success: true, data: usage });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

/**
 * --- COMMAND (Staff Management) ---
 */

router.get(
  "/staff/:agencyCode",
  verifyCoreToken,
  async (req: Request, res: Response) => {
    try {
      await dbConnect("services");
      const staff = await Staff.find({ agencyCode: req.params.agencyCode });
      res.json({ success: true, data: staff });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

router.post("/staff", verifyCoreToken, async (req: Request, res: Response) => {
  try {
    await dbConnect("services");
    const staff = await Staff.create(req.body);
    res.status(201).json({ success: true, data: staff });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
