/**
 * customEvent.routes.ts
 * CRUD for CustomEventDef and manual EventBus emission.
 * Place at: src/routes/saas/crm/customEvent.routes.ts
 */

import { Router, type Request, type Response } from "express";
import { getCrmModels } from "@lib/tenant/crm.models";
import { EventBus } from "@/services/saas/event/eventBus.service";

const router = Router();

/**
 * GET /api/crm/custom-events
 * List all custom event definitions.
 */
router.get("/custom-events", async (req: Request, res: Response) => {
  try {
    const { CustomEventDef } = await getCrmModels(req.clientCode!);
    const events = await CustomEventDef.find({
      clientCode: req.clientCode,
    })
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, data: events });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/crm/custom-events
 * Create or update a custom event definition.
 */
router.post("/custom-events", async (req: Request, res: Response) => {
  try {
    const { CustomEventDef } = await getCrmModels(req.clientCode!);
    const { name, displayName, payloadSchema, isSystem } = req.body;

    if (!name || !displayName) {
      return res
        .status(400)
        .json({ success: false, message: "name and displayName are required" });
    }

    const eventDef = await CustomEventDef.findOneAndUpdate(
      { clientCode: req.clientCode, name },
      {
        $set: {
          displayName,
          payloadSchema: payloadSchema || {},
          isSystem: !!isSystem,
          updatedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    res.json({ success: true, data: eventDef });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/crm/custom-events/:id
 */
router.delete("/custom-events/:id", async (req: Request, res: Response) => {
  try {
    const { CustomEventDef } = await getCrmModels(req.clientCode!);
    await CustomEventDef.deleteOne({
      _id: req.params.id,
      clientCode: req.clientCode,
    });
    res.json({ success: true, message: "Event definition deleted" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/crm/events/emit
 * Manually trigger an event.
 */
router.post("/events/emit", async (req: Request, res: Response) => {
  try {
    const { trigger, payload, idempotencyKey } = req.body;

    if (!trigger || !payload) {
      return res
        .status(400)
        .json({ success: false, message: "trigger and payload are required" });
    }

    // Emit via EventBus
    await EventBus.emit(req.clientCode!, trigger, payload, { idempotencyKey });

    res.json({
      success: true,
      message: `Event ${trigger} emitted successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
