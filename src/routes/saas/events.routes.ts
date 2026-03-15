import { EventDefService } from "@services/saas/event/eventDef.service";
import type { Request, Response } from "express";
import { Router } from "express";

const eventRouter = Router();

/**
 * GET /api/saas/events
 * List all available triggers (System + Custom Registered)
 */
eventRouter.get("/", async (req: Request, res: Response) => {
  const clientCode = req.clientCode;
  if (!clientCode)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const events = await EventDefService.getAllEvents(clientCode);
    res.json({ success: true, data: events });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/saas/events/assign
 * Register/Assign a new custom event trigger
 */
eventRouter.post("/assign", async (req: any, res: any) => {
  const clientCode = req.clientCode;
  if (!clientCode)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  const { name, displayName, description, pipelineId, stageId } = req.body;
  if (!name || !displayName) {
    return res
      .status(400)
      .json({ success: false, message: "name and displayName are required" });
  }

  try {
    const event = await EventDefService.registerEvent(clientCode, {
      name,
      displayName,
      description,
      pipelineId,
      stageId,
    });
    res.json({ success: true, data: event });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/saas/events/unassign
 * Deactivate a custom event assignment
 */
eventRouter.post("/unassign", async (req: any, res: any) => {
  const clientCode = req.clientCode;
  if (!clientCode)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  const { name } = req.body;
  if (!name)
    return res
      .status(400)
      .json({ success: false, message: "event name is required" });

  try {
    const result = await EventDefService.unassignEvent(clientCode, name);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default eventRouter;
