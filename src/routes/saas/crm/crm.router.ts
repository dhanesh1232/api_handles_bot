/**
 * @module Routes/CRM
 * @responsibility Orchestrator for all Customer Relationship Management (CRM) sub-routers.
 *
 * **GOAL:** Centralize the injection of the bound SDK and Socket.io for all lead, pipeline, and automation related endpoints.
 *
 * **DETAILED EXECUTION:**
 * 1. **Middleware Injection**: Mounts `withSDK(io)` globally for all sub-routers. This ensures that every handler within `leads`, `pipelines`, etc., has access to `req.sdk` without manual instantiation.
 * 2. **Sub-Router Mounting**: Maps specific business domains (leads, sequences, scoring) to their respective route implementations.
 */

import { Router } from "express";
import type { Server } from "socket.io";
import { withSDK } from "@/middleware/withSDK";
import activityRouter from "./activity.routes.ts";
import analyticsRouter from "./analytics.routes.ts";
import automationRouter from "./automation.routes.ts";
import automationDashboardRouter from "./automationDashboard.routes.ts";
import customEventRouter from "./customEvent.routes.ts";
import leadRoutes from "./lead.routes.ts";
import notificationRoutes from "./notification.routes.ts";
import paymentRouter from "./payment.routes.ts";
import pipelineRoutes from "./pipeline.routes.ts";
import scoringRouter from "./scoring.routes.ts";
import sequenceRouter from "./sequence.routes.ts";

export function createCrmRouter(io: Server) {
  const router = Router();

  // Inject SDK with Socket.io for all CRM routes
  // This satisfies the user's request for real-time tracking
  router.use(withSDK(io));

  router.use(leadRoutes);
  router.use(pipelineRoutes);
  router.use(paymentRouter);
  router.use(activityRouter);
  router.use(automationRouter);
  router.use(analyticsRouter);
  router.use(scoringRouter);
  router.use(notificationRoutes);
  router.use(customEventRouter);
  router.use(automationDashboardRouter);
  router.use("/sequences", sequenceRouter);

  return router;
}
