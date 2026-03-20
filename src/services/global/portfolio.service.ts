import { dbConnect } from "@lib/config";
import { getCrmModels } from "@lib/tenant/crm.models";
import { Client } from "@models/clients/client";

/**
 * @module Global/PortfolioService
 * @responsibility Actionable cross-tenant intelligence for Agency-level management.
 *
 * **WORKING PROCESS:**
 * 1. Discovery: Identifies all client databases belonging to a specific agency.
 * 2. Parallel Computing: Executes concurrent MongoDB aggregation pipelines across multiple tenant connections.
 * 3. Normalization: Standardizes counts (Leads), values (Pipeline), and conversion rates (Won%).
 * 4. Aggregation: Returns a unified "Portfolio Totals" view vs. individual client breakdowns.
 */
export const PortfolioService = {
  /**
   * Aggregate key metrics across all clients for an agency.
   *
   * **WORKING PROCESS:**
   * 1. Initialization: Connects to the global services database and fetches all clients belonging to the specified agency.
   * 2. Parallel Aggregation: Uses `Promise.all` to concurrently process each client, calculating key metrics such as total leads, total pipeline value, won deals count, and won deals value.
   * 3. Error Handling: Implements a `try-catch` block for each client to prevent a single client's data issues from affecting the entire aggregation.
   * 4. Portfolio Summary: Calculates the grand totals for the entire portfolio by summing the metrics from all individual clients.
   *
   * **EDGE CASES:**
   * - Empty Agency: If no clients are found for the given agency code, it returns an empty breakdown and zeroed-out portfolio totals.
   * - Data Corruption: If a specific client's database connection fails or aggregation errors occur, that client is skipped, and an error is logged, allowing the service to continue processing other clients.
   * - No Won Deals: If no deals are marked as "won" across all clients, the conversion rate correctly defaults to 0%.
   * @param {string} agencyCode - The agency code to aggregate stats for.
   * @returns {Promise<object>} An object containing the agency code, client count, portfolio totals, and a breakdown of metrics for each client.
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
