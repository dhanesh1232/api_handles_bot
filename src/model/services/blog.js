import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String, // constructor
      trim: true, // options
      minlength: 5,
      maxlength: 120,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    body: String,
    tags: [{ type: String, lowercase: true }],
    category: {
      type: String,
      enum: ["technology", "design", "business", "lifestyle", "tutorials", ""],
      default: "",
    },
    featuredImage: { url: String, altText: String },

    author: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: String,
      avatar: String,
    },

    isPublished: { type: Boolean, default: false },
    publishDate: { type: Date, default: Date.now },
    featured: { type: Boolean, default: false },

    metaTitle: String,
    metaDescription: String,
    canonicalUrl: String,
    metaKeywords: [{ type: String }],

    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },

    relatedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Blog",
      },
    ],

    comments: [
      {
        name: String,
        comment: String,
        createdAt: { type: Date, default: Date.now },
        isApproved: { type: Boolean, default: true },
        visitorId: { type: String, required: true },
        metadata: { type: mongoose.Schema.Types.Mixed },
      },
    ],

    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },

    likedBy: [
      {
        visitorId: { type: String, required: true },
        metadata: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    viewedBy: [
      {
        visitorId: { type: String, required: true },
        metadata: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    sharedBy: [
      {
        visitorId: { type: String, required: true },
        metadata: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
        platform: String,
      },
    ],
    call_to_action: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },

    wordCount: Number,
    readTime: Number,
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Blog = mongoose.models.Blog || mongoose.model("Blog", blogSchema);
