import { dbConnect } from "@lib/config";
import { Client } from "@models/clients/client";
import { getCrmModels } from "@lib/tenant/crm.models";
import mongoose from "mongoose";

/**
 * Portfolio Service
 * Aggregates ROI and KPIs across multiple tenant databases.
 * The "God View" for agencies.
 */
export const PortfolioService = {
  /**
   * Aggregate key metrics across all clients for an agency.
   */
  getAgencyStats: async (agencyCode: string) => {
    await dbConnect("services");
    const clients = await Client.find({ agencyCode }).lean();

    const results = await Promise.all(
      clients.map(async (client) => {
        try {
          const { Lead } = await getCrmModels(client.clientCode);

          const stats = await Lead.aggregate([
            { $match: { clientCode: client.clientCode, isArchived: false } },
            {
              $group: {
                _id: null,
                totalLeads: { $sum: 1 },
                totalValue: { $sum: { $ifNull: ["$dealValue", 0] } },
                wonCount: {
                  $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] },
                },
                wonValue: {
                  $sum: {
                    $cond: [
                      { $eq: ["$status", "won"] },
                      { $ifNull: ["$dealValue", 0] },
                      0,
                    ],
                  },
                },
              },
            },
          ]);

          const s = stats[0] || {
            totalLeads: 0,
            totalValue: 0,
            wonCount: 0,
            wonValue: 0,
          };
          return {
            clientCode: client.clientCode,
            clientName: client.name,
            metrics: {
              leads: s.totalLeads,
              pipelineValue: s.totalValue,
              wonCount: s.wonCount,
              wonValue: s.wonValue,
              conversionRate:
                s.totalLeads > 0 ? (s.wonCount / s.totalLeads) * 100 : 0,
            },
          };
        } catch (err) {
          console.error(
            `Error aggregating stats for ${client.clientCode}:`,
            err,
          );
          return null;
        }
      }),
    );

    const validResults = results.filter(Boolean);

    // Total Portfolio Stats
    const totals = validResults.reduce(
      (acc: any, curr: any) => {
        acc.totalLeads += curr.metrics.leads;
        acc.totalPipelineValue += curr.metrics.pipelineValue;
        acc.totalWonCount += curr.metrics.wonCount;
        acc.totalWonValue += curr.metrics.wonValue;
        return acc;
      },
      {
        totalLeads: 0,
        totalPipelineValue: 0,
        totalWonCount: 0,
        totalWonValue: 0,
      },
    );

    return {
      agencyCode,
      clientCount: clients.length,
      portfolio: totals,
      breakdown: validResults,
    };
  },
};
