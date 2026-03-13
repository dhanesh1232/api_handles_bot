import { getCrmModels } from "@/lib/tenant/get.crm.model";
import { getSegmentRepo } from "./segment.repository";
import { ConditionEvaluator } from "../automation/conditionEvaluator.service";
import { crmQueue } from "@/jobs/saas/crmWorker";
import { ISegment } from "@/model/saas/crm/segment.model";

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
    });
    const matches = allLeads.filter((lead) => {
      const context = lead.toJSON();
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

  async getSegmentMembers(id: string, options: any = {}) {
    const repo = await getSegmentRepo(this.clientCode);
    const segment = await repo.findById(id);
    if (!segment) throw new Error("Segment not found");

    const { Lead } = await getCrmModels(this.clientCode);
    const allLeads = await Lead.find({
      clientCode: this.clientCode,
      isArchived: false,
    });

    const matches = allLeads.filter((lead) =>
      ConditionEvaluator.evaluate(segment.logic, segment.rules, lead.toJSON()),
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
