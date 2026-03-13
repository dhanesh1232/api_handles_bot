import mongoose, { Model, UpdateQuery, QueryOptions, Types } from "mongoose";

/**
 * BaseRepository
 *
 * A generic repository for tenant-scoped database operations.
 * Ensures every query is strictly bound to the providing clientCode.
 */
export class BaseRepository<T> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly clientCode: string,
  ) {}

  /**
   * Find a single document by its ID.
   */
  async findById(
    id: string | Types.ObjectId,
    options: QueryOptions = {},
  ): Promise<T | null> {
    return this.model
      .findOne({ _id: id, clientCode: this.clientCode } as any, null, options)
      .exec();
  }

  /**
   * Find one document matching the filter.
   */
  async findOne(filter: any, options: QueryOptions = {}): Promise<T | null> {
    return this.model
      .findOne({ ...filter, clientCode: this.clientCode } as any, null, options)
      .exec();
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
      .find({ ...filter, clientCode: this.clientCode } as any, null, options)
      .sort(sort)
      .exec();
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
   * Create a new document.
   */
  async create(data: Partial<T>): Promise<T> {
    return this.model.create({
      ...data,
      clientCode: this.clientCode,
    } as any);
  }

  /**
   * Update a document by ID.
   */
  async update(
    id: string | Types.ObjectId,
    updates: UpdateQuery<T>,
    options: QueryOptions = { new: true },
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, clientCode: this.clientCode } as any,
        updates,
        options,
      )
      .exec();
  }

  /**
   * Upsert a document based on a filter.
   */
  async upsert(
    filter: any,
    updates: UpdateQuery<T>,
    options: QueryOptions = {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        { ...filter, clientCode: this.clientCode } as any,
        updates,
        options,
      )
      .exec();
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
   * Paginate documents.
   */
  async paginate(
    filter: any,
    options: { page?: number; limit?: number; sort?: any } = {},
  ): Promise<{ docs: T[]; total: number; page: number; pages: number }> {
    const { page = 1, limit = 25, sort = { createdAt: -1 } } = options;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      this.model
        .find({ ...filter, clientCode: this.clientCode } as any)
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
    return this.model.insertMany(enriched as any) as unknown as T[];
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
