/**
 * crm.router.ts
 * Central CRM router — mounts all sub-routers.
 * Place at: src/routes/saas/crm/crm.router.ts
 *
 * In server.ts add ONE line:
 *   import crmRouter from "./src/routes/saas/crm/crm.router.ts"
 *   app.use("/api/crm", validateClientKey, crmRouter)
 *
 * That's it. All CRM routes are live.
 */

import { Router } from "express";
import activityRouter from "./activity.routes.ts";
import analyticsRouter from "./analytics.routes.ts";
import automationRouter from "./automation.routes.ts";
import leadRouter from "./lead.routes.ts";
import pipelineRouter from "./pipeline.routes.ts";
import scoringRouter from "./scoring.routes.ts";

const router = Router();

router.use(leadRouter);
router.use(pipelineRouter);
router.use(activityRouter);
router.use(automationRouter);
router.use(analyticsRouter);
router.use(scoringRouter);

export default router;
