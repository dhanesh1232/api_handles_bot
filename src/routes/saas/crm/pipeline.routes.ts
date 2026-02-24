/**
 * pipeline.routes.ts
 *
 * Place at: src/routes/saas/crm/pipeline.routes.ts
 * Mount in server.ts: app.use("/api/crm", validateClientKey, pipelineRouter)
 *
 * All routes are protected by your existing validateClientKey middleware.
 * req.clientCode is set by that middleware.
 */

import { Router, type Request, type Response } from "express";
import * as pipelineService from "../../../services/saas/crm/pipeline.service.ts";

const router = Router();

// ─── Pipelines ────────────────────────────────────────────────────────────────

/**
 * GET /api/crm/pipelines
 * Returns all active pipelines for this client.
 */
router.get("/pipelines", async (req: Request, res: Response) => {
  try {
    const pipelines = await pipelineService.getPipelines(req.clientCode!);
    res.json({ success: true, data: pipelines });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/crm/pipelines/:pipelineId
 * Returns one pipeline + all its stages.
 */
router.get("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    const result = await pipelineService.getPipelineWithStages(
      req.clientCode!,
      req.params.pipelineId as string,
    );
    if (!result) {
      res.status(404).json({ success: false, message: "Pipeline not found" });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * POST /api/crm/pipelines
 * Create a pipeline with stages.
 *
 * Body:
 * {
 *   name: "Patient Journey",
 *   description?: "...",
 *   isDefault?: true,
 *   template?: "sales" | "support" | "recruitment",  // use a built-in template
 *   stages?: [                                         // OR pass custom stages
 *     { name: "Inquiry", color: "#6366f1", probability: 10 },
 *     { name: "Consulted", color: "#10b981", probability: 60, isWon: true }
 *   ]
 * }
 */
router.post("/pipelines", async (req: Request, res: Response) => {
  try {
    const { name, description, isDefault, template, stages = [] } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ success: false, message: "name is required" });
      return;
    }

    const result = await pipelineService.createPipeline(
      req.clientCode!,
      { name: name.trim(), description, isDefault, stages },
      template,
    );

    res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/pipelines/:pipelineId
 * Update pipeline name or description.
 */
router.patch("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    const { name, description, order } = req.body;
    const pipeline = await pipelineService.updatePipeline(
      req.clientCode!,
      req.params.pipelineId as string,
      { name, description, order },
    );
    if (!pipeline) {
      res.status(404).json({ success: false, message: "Pipeline not found" });
      return;
    }
    res.json({ success: true, data: pipeline });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/pipelines/:pipelineId/default
 * Make this the default pipeline. Unsets all others.
 */
router.patch(
  "/pipelines/:pipelineId/default",
  async (req: Request, res: Response) => {
    try {
      await pipelineService.setDefaultPipeline(
        req.clientCode!,
        req.params.pipelineId as string,
      );
      res.json({ success: true, message: "Default pipeline updated" });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * DELETE /api/crm/pipelines/:pipelineId
 * Soft-archives the pipeline (sets isActive: false).
 */
router.delete("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    await pipelineService.archivePipeline(
      req.clientCode!,
      req.params.pipelineId as string,
    );
    res.json({ success: true, message: "Pipeline archived" });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    const status = msg.includes("default") ? 400 : 500;
    res.status(status).json({ success: false, message: msg });
  }
});

/**
 * POST /api/crm/pipelines/:pipelineId/duplicate
 * Clone a pipeline with all stages (no leads copied).
 * Body: { name: "Copy of Patient Journey" }
 */
router.post(
  "/pipelines/:pipelineId/duplicate",
  async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) {
        res.status(400).json({ success: false, message: "name is required" });
        return;
      }
      const result = await pipelineService.duplicatePipeline(
        req.clientCode!,
        req.params.pipelineId as string,
        name.trim(),
      );
      res.status(201).json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

// ─── Stages ───────────────────────────────────────────────────────────────────

/**
 * POST /api/crm/pipelines/:pipelineId/stages
 * Add a new stage to an existing pipeline.
 *
 * Body: { name, color?, probability?, isWon?, isLost?, insertAfterOrder? }
 */
router.post(
  "/pipelines/:pipelineId/stages",
  async (req: Request, res: Response) => {
    try {
      const { name, color, probability, isWon, isLost, insertAfterOrder } =
        req.body;

      if (!name?.trim()) {
        res.status(400).json({ success: false, message: "name is required" });
        return;
      }

      const stage = await pipelineService.addStage(
        req.clientCode!,
        req.params.pipelineId as string,
        { name: name.trim(), color, probability, isWon, isLost, insertAfterOrder },
      );
      res.status(201).json({ success: true, data: stage });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * PATCH /api/crm/stages/:stageId
 * Update a stage's name, color, probability, or autoActions.
 */
router.patch("/stages/:stageId", async (req: Request, res: Response) => {
  try {
    const { name, color, probability, isWon, isLost, autoActions } = req.body;
    const stage = await pipelineService.updateStage(
      req.clientCode!,
      req.params.stageId as string,
      { name, color, probability, isWon, isLost, autoActions },
    );
    if (!stage) {
      res.status(404).json({ success: false, message: "Stage not found" });
      return;
    }
    res.json({ success: true, data: stage });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * PATCH /api/crm/pipelines/:pipelineId/stages/reorder
 * Save new stage order after drag-and-drop.
 *
 * Body: { order: [{ stageId: "abc", newOrder: 0 }, ...] }
 */
router.patch(
  "/pipelines/:pipelineId/stages/reorder",
  async (req: Request, res: Response) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order) || order.length === 0) {
        res
          .status(400)
          .json({ success: false, message: "order array is required" });
        return;
      }
      await pipelineService.reorderStages(
        req.clientCode!,
        req.params.pipelineId as string,
        order,
      );
      res.json({ success: true, message: "Stages reordered" });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * DELETE /api/crm/stages/:stageId
 * Delete a stage.
 * If leads exist in that stage, pass moveLeadsToStageId in body to migrate them.
 *
 * Body (optional): { moveLeadsToStageId: "xyz" }
 */
router.delete("/stages/:stageId", async (req: Request, res: Response) => {
  try {
    const { moveLeadsToStageId } = req.body;
    await pipelineService.deleteStage(
      req.clientCode!,
      req.params.stageId as string,
      moveLeadsToStageId,
    );
    res.json({ success: true, message: "Stage deleted" });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    const status = msg.includes("leads are in this stage") ? 409 : 500;
    res.status(status).json({ success: false, message: msg });
  }
});

// ─── Board & Analytics ────────────────────────────────────────────────────────

/**
 * GET /api/crm/pipelines/:pipelineId/board
 * Returns each stage with lead count + total deal value.
 * Fast — uses aggregation, not individual lead fetches.
 * The frontend fetches leads per stage separately for pagination.
 */
router.get(
  "/pipelines/:pipelineId/board",
  async (req: Request, res: Response) => {
    try {
      const board = await pipelineService.getBoardSummary(
        req.clientCode!,
        req.params.pipelineId as string,
      );
      res.json({ success: true, data: board });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

/**
 * GET /api/crm/pipelines/:pipelineId/forecast
 * Revenue forecast: each stage's total deal value × probability.
 * Returns expected revenue per stage + grand total.
 */
router.get(
  "/pipelines/:pipelineId/forecast",
  async (req: Request, res: Response) => {
    try {
      const rows = await pipelineService.getRevenueForecast(
        req.clientCode!,
        req.params.pipelineId as string,
      );

      const grandTotal = rows.reduce((sum, r) => sum + r.expectedRevenue, 0);
      const totalPipeline = rows.reduce((sum, r) => sum + r.totalValue, 0);

      res.json({
        success: true,
        data: {
          rows,
          grandTotal,         // weighted expected revenue
          totalPipeline,      // raw sum of all deals (unweighted)
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

export default router;