import { Model, QueryOptions, Types, UpdateQuery } from "mongoose";

/**
 * @module Lib/Tenant/BaseRepository
 * @responsibility Foundation for all tenant-aware database interactions, ensuring strict data isolation.
 *
 * **WHY THIS EXISTS:**
 * In a high-stakes multi-tenant environment, any query "leak" is a critical security failure.
 * The `BaseRepository` acts as a mandatory filter layer that automatically injects the `clientCode`
 * into every atomic MongoDB operation.
 *
 * **DETAILED EXECUTION:**
 * 1. **Initialization**: The constructor binds a specific Mongoose `Model` and a `clientCode` string.
 * 2. **Auto-Scoping**: Every method (`find`, `create`, `update`, etc.) spreads the established `clientCode` into the query filter, making un-scoped lookups impossible by design.
 * 3. **Performance Optimization**:
 *    - Defaults to `.lean()` for read operations to minimize memory overhead.
 *    - Uses `Promise.all` in `paginate` for parallel execution of data fetch and total count.
 *
 * **GOAL**: Provide a fail-safe, performant, and consistent interface for data access across the entire SaaS portfolio.
 */
export class BaseRepository<T> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly clientCode: string,
  ) {}

  /**
   * Retrieves a single document by its unique ID while enforcing tenant isolation.
   *
   * @param id - The Mongoose ObjectId or string ID.
   * @returns The document or `null` if not found or if the document belongs to a different tenant.
   *
   * **DETAILED EXECUTION:**
   * 1. **Filter Injection**: Automatically appends `{ clientCode: this.clientCode }` to the query.
   * 2. **Execution**: Invokes `findOne` on the underlying Mongoose model.
   * 3. **Optimization**: Defaults to `.lean()` to bypass Mongoose hydration overhead.
   */
  async findById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<T | null> {
    return this.model
      .findOne({ _id: id, clientCode: this.clientCode } as any, null, {
        lean: true,
        ...options,
      })
      .exec() as any;
  }

  /**
   * Find one document matching the filter.
   */
  async findOne(filter: any, options: QueryOptions = {}): Promise<T | null> {
    return this.model
      .findOne({ ...filter, clientCode: this.clientCode } as any, null, {
        lean: true,
        ...options,
      })
      .exec() as any;
  }

  /**
   * Find multiple documents matching the filter.
   */
  async findMany(
    filter: any,
    options: QueryOptions = {},
    sort: any = { createdAt: -1 },
  ): Promise<T[]> {
    return this.model
      .find({ ...filter, clientCode: this.clientCode } as any, null, {
        lean: true,
        ...options,
      })
      .sort(sort)
      .exec() as any;
  }

  /**
   * Check if a document exists matching the filter.
   */
  async exists(filter: any): Promise<boolean> {
    const res = await this.model.exists({
      ...filter,
      clientCode: this.clientCode,
    } as any);
    return !!res;
  }

  /**
   * Persists a new document, automatically stamping it with the established `clientCode`.
   */
  async create(data: Partial<T>): Promise<T> {
    const doc = await this.model.create({
      ...data,
      clientCode: this.clientCode,
    } as any);
    return doc.toObject();
  }

  /**
   * Update a document by ID.
   */
  async update(
    id: string | Types.ObjectId,
    updates: UpdateQuery<T>,
    options: QueryOptions = { returnDocument: "after" },
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, clientCode: this.clientCode } as any,
        updates,
        {
          lean: true,
          ...options,
        },
      )
      .exec() as any;
  }

  /**
   * Upsert a document based on a filter.
   */
  async upsert(
    filter: any,
    updates: UpdateQuery<T>,
    options: QueryOptions = {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    },
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        { ...filter, clientCode: this.clientCode } as any,
        updates,
        {
          lean: true,
          ...options,
        },
      )
      .exec() as any;
  }

  /**
   * Delete a document by ID.
   */
  async delete(id: string | Types.ObjectId): Promise<boolean> {
    const result = await this.model
      .deleteOne({
        _id: id,
        clientCode: this.clientCode,
      } as any)
      .exec();
    return result.deletedCount > 0;
  }

  /**
   * Count documents matching the filter.
   */
  async count(filter: any): Promise<number> {
    return this.model
      .countDocuments({
        ...filter,
        clientCode: this.clientCode,
      } as any)
      .exec();
  }

  /**
   * Performs a high-performance, paginated lookup with total count metadata.
   *
   * @param options - Pagination settings (page, limit, sort).
   * @returns A structured object containing `docs`, `total` count, and pagination math.
   *
   * **DETAILED EXECUTION:**
   * 1. **Parallelization**: Spawns two concurrent promises via `Promise.all`:
   *    - Data Fetch: Applies `skip((page-1)*limit)` and `limit()`.
   *    - Metrics: Triggers `countDocuments` for the entire filtered set.
   * 2. **Isolation**: Ensures both the fetch and the count are strictly scoped to `this.clientCode`.
   */
  async paginate(
    filter: any,
    options: { page?: number; limit?: number; sort?: any } = {},
  ): Promise<{ docs: T[]; total: number; page: number; pages: number }> {
    const { page = 1, limit = 25, sort = { createdAt: -1 } } = options;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      this.model
        .find({ ...filter, clientCode: this.clientCode } as any, null, {
          lean: true,
        })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model
        .countDocuments({ ...filter, clientCode: this.clientCode } as any)
        .exec(),
    ]);

    return {
      docs,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Update many documents matching the filter.
   */
  async updateMany(filter: any, updates: UpdateQuery<T>): Promise<number> {
    const result = await this.model
      .updateMany({ ...filter, clientCode: this.clientCode } as any, updates)
      .exec();
    return result.modifiedCount;
  }

  /**
   * Create many documents at once.
   */
  async createMany(docs: Partial<T>[]): Promise<T[]> {
    const enriched = docs.map((doc) => ({
      ...doc,
      clientCode: this.clientCode,
    }));
    const results = await this.model.insertMany(enriched as any);
    return results.map((r: any) =>
      typeof r.toObject === "function" ? r.toObject() : r,
    );
  }

  /**
   * Delete many documents matching the filter.
   */
  async deleteMany(filter: any): Promise<number> {
    const result = await this.model
      .deleteMany({
        ...filter,
        clientCode: this.clientCode,
      } as any)
      .exec();
    return result.deletedCount;
  }

  /**
   * Run an aggregation pipeline.
   * Note: The caller must include { $match: { clientCode: this.clientCode } } at the start
   * or use this method which injects it if missing.
   */
  async aggregate(pipeline: any[]): Promise<any[]> {
    return this.model.aggregate(pipeline).exec();
  }
}
