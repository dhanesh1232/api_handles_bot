import express, { type Request, type Response } from "express";
import { dbConnect } from "../../lib/config.ts";
import { Blog } from "../../model/services/blog.ts";

const router = express.Router();

// Get All Blogs
router.get("/services/blogs", async (req: Request, res: Response) => {
  await dbConnect("services");

  try {
    const blogs = await Blog.find({});
    res.status(200).json({
      message: "Blogs fetched successfully",
      data: blogs,
      count: blogs.length,
      success: true,
    });
  } catch (er: any) {
    console.log(er.message);
    res.status(500).json({
      message: "Internal server error",
      data: [],
      count: 0,
      success: false,
    });
  }
});

export default router;
