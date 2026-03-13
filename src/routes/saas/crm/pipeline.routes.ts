/**
 * pipeline.routes.ts — uses withSDK middleware, no per-handler createSDK() calls
 */

import { Router, type Request, type Response } from "express";
import { withSDK } from "@/middleware/withSDK";

const router = Router();
router.use(withSDK()); // stamps req.sdk once for every route below

// ─── Pipelines ────────────────────────────────────────────────────────────────

router.get("/pipelines", async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await req.sdk.pipeline.list() });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.get("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    const result = await req.sdk.pipeline.getWithStages(
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

router.post("/pipelines", async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      isDefault,
      template,
      stages = [],
      customStages,
    } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ success: false, message: "name is required" });
      return;
    }
    const resolvedStages = stages.length > 0 ? stages : (customStages ?? []);
    const result = await req.sdk.pipeline.create(
      { name: name.trim(), description, isDefault, stages: resolvedStages },
      template,
    );
    res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

router.patch("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    const { name, description, order } = req.body;
    const pipeline = await req.sdk.pipeline.update(
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

router.patch(
  "/pipelines/:pipelineId/default",
  async (req: Request, res: Response) => {
    try {
      await req.sdk.pipeline.setDefault(req.params.pipelineId as string);
      res.json({ success: true, message: "Default pipeline updated" });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.get(
  "/pipelines/:pipelineId/in-use",
  async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await req.sdk.pipeline.checkInUse(
          req.params.pipelineId as string,
        ),
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.patch(
  "/pipelines/:pipelineId/archive",
  async (req: Request, res: Response) => {
    try {
      await req.sdk.pipeline.archive(req.params.pipelineId as string);
      res.json({ success: true, message: "Pipeline archived" });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      res
        .status(
          msg.includes("default") || msg.includes("Cannot archive") ? 400 : 500,
        )
        .json({ success: false, message: msg });
    }
  },
);

router.delete("/pipelines/:pipelineId", async (req: Request, res: Response) => {
  try {
    await req.sdk.pipeline.hardDelete(req.params.pipelineId as string);
    res.json({ success: true, message: "Pipeline deleted" });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res
      .status(
        msg.includes("default") || msg.includes("Cannot delete") ? 400 : 500,
      )
      .json({ success: false, message: msg });
  }
});

router.post(
  "/pipelines/:pipelineId/duplicate",
  async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) {
        res.status(400).json({ success: false, message: "name is required" });
        return;
      }
      const result = await req.sdk.pipeline.duplicate(
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
      const stage = await req.sdk.pipeline.addStage(
        req.params.pipelineId as string,
        {
          name: name.trim(),
          color,
          probability,
          isWon,
          isLost,
          insertAfterOrder,
        },
      );
      res.status(201).json({ success: true, data: stage });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.patch("/stages/:stageId", async (req: Request, res: Response) => {
  try {
    const { name, color, probability, isWon, isLost, autoActions } = req.body;
    const stage = await req.sdk.pipeline.updateStage(
      req.params.stageId as string,
      {
        name,
        color,
        probability,
        isWon,
        isLost,
        autoActions,
      },
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
      await req.sdk.pipeline.reorderStages(
        req.params.pipelineId as string,
        order,
      );
      res.json({ success: true, message: "Stages reordered" });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.delete("/stages/:stageId", async (req: Request, res: Response) => {
  try {
    const { moveLeadsToStageId } = req.body;
    await req.sdk.pipeline.deleteStage(
      req.params.stageId as string,
      moveLeadsToStageId,
    );
    res.json({ success: true, message: "Stage deleted" });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res
      .status(msg.includes("leads are in this stage") ? 409 : 500)
      .json({ success: false, message: msg });
  }
});

// ─── Board & Analytics ────────────────────────────────────────────────────────

router.get(
  "/pipelines/:pipelineId/board",
  async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await req.sdk.pipeline.board(req.params.pipelineId as string),
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

router.get(
  "/pipelines/:pipelineId/forecast",
  async (req: Request, res: Response) => {
    try {
      const rows = await req.sdk.pipeline.forecast(
        req.params.pipelineId as string,
      );
      res.json({
        success: true,
        data: {
          rows,
          grandTotal: rows.reduce(
            (sum: number, r: any) => sum + r.expectedRevenue,
            0,
          ),
          totalPipeline: rows.reduce(
            (sum: number, r: any) => sum + r.totalValue,
            0,
          ),
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message });
    }
  },
);

export default router;
