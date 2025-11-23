import express from "express";
import { dbConnect } from "../../lib/config.js";
import { Blog } from "../../model/services/blog.js";
const router = express.Router();

// Get All Blogs
router.get("/services/blogs", async (req, res) => {
  await dbConnect("services");

  try {
    const blogs = await Blog.find({});

    res.status(200).json({
      message: "Blogs fetched successfully",
      data: blogs,
      count: blogs.length,
      success: true,
    });
  } catch (er) {
    console.log(er.message);
  }
});

export default router;
