import { getCrmModels } from "@lib/tenant/crm.models";
import { ConditionEvaluator } from "../automation/conditionEvaluator.service";
import { getSegmentRepo } from "./segment.repository";

export class SegmentService {
  constructor(private readonly clientCode: string) {}

  async createSegment(data: Partial<ISegment>): Promise<ISegment> {
    const repo = await getSegmentRepo(this.clientCode);
    const segment = await repo.create(data);

    // Trigger initial calculation
    await this.refreshSegment(segment._id.toString());
    return segment;
  }

  async updateSegment(
    id: string,
    updates: Partial<ISegment>,
  ): Promise<ISegment | null> {
    const repo = await getSegmentRepo(this.clientCode);
    const segment = await repo.update(id, updates);
    if (segment) {
      await this.refreshSegment(id);
    }
    return segment;
  }

  /**
   * Recalculates the membership for a specific dynamic segment.
   *
   * **WORKING PROCESS:**
   * 1. Rule Resolution: Fetches the segment definition (logic and rules).
   * 2. Bulk Filter: Scans all active leads for the tenant.
   * 3. Rule Evaluation: Applies the `ConditionEvaluator` to each lead to determine membership eligibility.
   * 4. Metadata Update: Updates the `memberCount` and `lastCalculatedAt` in the repository.
   *
   * **EDGE CASES:**
   * - Performance: Currently performs an in-memory filter. For extremely large datasets (>100k leads), this should transition to a MongoDB native query builder.
   */
  async refreshSegment(id: string): Promise<number> {
    const repo = await getSegmentRepo(this.clientCode);
    const segment = await repo.findById(id);
    if (!segment) throw new Error("Segment not found");

    const { Lead } = await getCrmModels(this.clientCode);

    // For large datasets, we should use a more efficient approach (MongoDB query builder)
    // But for now, we follow the Automation pattern using ConditionEvaluator
    // to support complex dynamic rules easily.

    const allLeads = await Lead.find({
      clientCode: this.clientCode,
      isArchived: false,
    }).lean();
    const matches = allLeads.filter((lead) => {
      const context = lead;
      return ConditionEvaluator.evaluate(segment.logic, segment.rules, context);
    });

    const matchIds = matches.map((m) => m._id.toString());

    // Update segment metadata
    await repo.update(id, {
      memberCount: matchIds.length,
      lastCalculatedAt: new Date(),
    });

    return matchIds.length;
  }

  async listSegments() {
    const repo = await getSegmentRepo(this.clientCode);
    return repo.findMany({});
  }

  /**
   * Retrieves the list of leads that currently match a segment's criteria.
   *
   * **WORKING PROCESS:**
   * 1. Definition Lookup: Retrieves the segment rules.
   * 2. Membership Calculation: Dynamically filters the lead database using `ConditionEvaluator`.
   * 3. Memory Pagination: Performs offset/limit slicing on the resulting filtered array.
   *
   * **EDGE CASES:**
   * - Stale Data: Results are calculated in real-time, meaning members may change between calls if lead data is updated.
   */
  async getSegmentMembers(id: string, options: any = {}) {
    const repo = await getSegmentRepo(this.clientCode);
    const segment = await repo.findById(id);
    if (!segment) throw new Error("Segment not found");

    const { Lead } = await getCrmModels(this.clientCode);
    const allLeads = await Lead.find({
      clientCode: this.clientCode,
      isArchived: false,
    }).lean();

    const matches = allLeads.filter((lead) =>
      ConditionEvaluator.evaluate(segment.logic, segment.rules, lead),
    );

    // Manual pagination since we filtered in memory
    const page = options.page || 1;
    const limit = options.limit || 25;
    const start = (page - 1) * limit;
    const paginated = matches.slice(start, start + limit);

    return {
      docs: paginated,
      total: matches.length,
      page,
      pages: Math.ceil(matches.length / limit),
    };
  }
}

export async function getSegmentService(
  clientCode: string,
): Promise<SegmentService> {
  return new SegmentService(clientCode);
}
