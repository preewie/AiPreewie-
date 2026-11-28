
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase server environment variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Security headers
app.use(helmet());

// Allow only the AiPreewie website
app.use(cors({
  origin: "https://aipreewie.onrender.com"
}));

// Limit JSON request size
app.use(express.json({ limit: "1mb" }));

// API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later."
  }
});

app.use("/api", apiLimiter);

// Home
app.get("/", (req, res) => {
  res.json({
    message: "AiPreewie server is running"
  });
});

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Database check
app.get("/db-check", async (req, res) => {
  const { error } = await supabase
    .from("stories")
    .select("id")
    .limit(1);

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }

  res.json({
    status: "connected",
    message: "Supabase database connected"
  });
});
// Admin file upload
app.post(
  "/api/admin/upload",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    console.log("UPLOAD ROUTE REACHED");

    try {
      if (!req.file) {
        return res.status(400).json({
          status: "error",
          message: "No file uploaded"
        });
      }

      const bucket = req.body.bucket;

      if (!["story-covers", "story-videos"].includes(bucket)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid bucket"
        });
      }

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4"
      ];

      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: "error",
          message: "Unsupported file type"
        });
      }

      const fileExt = req.file.originalname.split(".").pop();

      const filePath =
        `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      console.log("START SUPABASE UPLOAD:", bucket);

      const uploadPromise = supabase.storage
        .from(bucket)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("Supabase upload timeout"));
        }, 30000);
      });

      const { data, error } = await Promise.race([
        uploadPromise,
        timeoutPromise
      ]);

      if (error) {
        console.error("SUPABASE UPLOAD ERROR:", error);

        return res.status(500).json({
          status: "error",
          message: error.message || "Upload failed"
        });
      }

      console.log("UPLOAD SUCCESS:", data.path);

      return res.json({
        status: "success",
        bucket,
        path: data.path
      });

    } catch (error) {
      console.error("UPLOAD ROUTE ERROR:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Server upload error"
      });
    }
  }
);
// Public stories
app.get("/api/stories", async (req, res) => {
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not load stories"
    });
  }

  res.json({
    status: "success",
    stories: data
  });
});

// Verify logged-in user and Admin permission
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required"
      });
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired login"
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({
        status: "error",
        message: "Admin permission required"
      });
    }

    req.user = userData.user;
    next();

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Authentication check failed"
    });
  }
}

// Admin permission test
app.get("/api/admin/check", requireAdmin, (req, res) => {
  res.json({
    status: "success",
    message: "Admin access verified"
  });
});

// Admin: Get all stories
app.get("/api/admin/stories", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not load stories"
    });
  }

  res.json({ status: "success", stories: data });
});

// Admin: Create story
app.post("/api/admin/stories", requireAdmin, async (req, res) => {
  const {
    title,
    description = "",
    cover_url = null,
    price_usd = 0,
    published = false,
    watch_price_usd = 0,
    download_price_usd = 0,
    watch_price_khr = 0,
    download_price_khr = 0
  } = req.body || {};

  const fields = [
    price_usd,
    watch_price_usd,
    download_price_usd,
    watch_price_khr,
    download_price_khr
  ];

  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 200 ||
    typeof description !== "string" ||
    typeof published !== "boolean" ||
    fields.some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0)
  ) {
    return res.status(400).json({
      status: "error",
      message: "Invalid story information"
    });
  }

  const { data, error } = await supabase
    .from("stories")
    .insert({
      title: title.trim(),
      description,
      cover_url,
      price_usd,
      published,
      watch_price_usd,
      download_price_usd,
      watch_price_khr,
      download_price_khr
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not create story"
    });
  }

  res.status(201).json({
    status: "success",
    story: data
  });
});

// Admin: Update story
app.patch("/api/admin/stories/:id", requireAdmin, async (req, res) => {
  const allowed = [
    "title",
    "description",
    "cover_url",
    "price_usd",
    "published",
    "watch_price_usd",
    "download_price_usd",
    "watch_price_khr",
    "download_price_khr",
    "highlight_video_path",
    "watch_video_path",
    "download_video_path"
  ];

  const updates = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      updates[key] = req.body[key];
    }
  }

  if (
    Object.keys(updates).length === 0 ||
    (updates.title !== undefined &&
      (typeof updates.title !== "string" || !updates.title.trim())) ||
    (updates.description !== undefined &&
      typeof updates.description !== "string") ||
    (updates.published !== undefined &&
      typeof updates.published !== "boolean") ||
    ["price_usd", "watch_price_usd", "download_price_usd",
      "watch_price_khr", "download_price_khr"].some(key =>
        updates[key] !== undefined &&
        (typeof updates[key] !== "number" ||
         !Number.isFinite(updates[key]) || updates[key] < 0)
      )
  ) {
    return res.status(400).json({
      status: "error",
      message: "Invalid story update"
    });
  }

  if (updates.title !== undefined) {
    updates.title = updates.title.trim();
  }

  const { data, error } = await supabase
    .from("stories")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not update story"
    });
  }

  if (!data) {
    return res.status(404).json({
      status: "error",
      message: "Story not found"
    });
  }

  res.json({ status: "success", story: data });
});
// Admin delete story video
app.delete("/api/admin/story-video", requireAdmin, async (req, res) => {
  try {
    const { story_id, video_type } = req.body || {};

    const fields = {
      highlight: "highlight_video_path",
      watch: "watch_video_path",
      download: "download_video_path"
    };

    const field = fields[video_type];

    if (!story_id || !field) {
      return res.status(400).json({
        status: "error",
        message: "Invalid story or video type"
      });
    }

    const { data: story, error: fetchError } = await supabase
      .from("stories")
      .select("id, highlight_video_path, watch_video_path, download_video_path")
      .eq("id", story_id)
      .maybeSingle();

    if (fetchError || !story) {
      return res.status(404).json({
        status: "error",
        message: "Story not found"
      });
    }

    const filePath = story[field];

    if (!filePath) {
      return res.status(404).json({
        status: "error",
        message: "Video not found"
      });
    }

    const { error: deleteError } = await supabase.storage
      .from("story-videos")
      .remove([filePath]);

    if (deleteError) {
      return res.status(500).json({
        status: "error",
        message: "Could not delete video"
      });
    }

    const { error: updateError } = await supabase
      .from("stories")
      .update({ [field]: null })
      .eq("id", story_id);

    if (updateError) {
      return res.status(500).json({
        status: "error",
        message: "Video deleted but story update failed"
      });
    }

    return res.json({
      status: "success",
      message: "Video deleted successfully"
    });

  } catch (error) {
    console.error("DELETE VIDEO ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Server delete error"
    });
  }
});
// Admin: Archive story instead of permanently deleting it
app.delete("/api/admin/stories/:id", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("stories")
    .update({ published: false })
    .eq("id", req.params.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return res.status(500).json({
      status: "error",
      message: "Could not archive story"
    });
  }

  if (!data) {
    return res.status(404).json({
      status: "error",
      message: "Story not found"
    });
  }

  res.json({
    status: "success",
    message: "Story archived"
  });
});
// User: Buy story with wallet
app.post("/api/purchase/wallet", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "Please login first"
      });
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid login"
      });
    }

    const { story_id, purchase_type } = req.body || {};

    if (
      !story_id ||
      !["watch", "download"].includes(purchase_type)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid purchase information"
      });
    }

    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_ANON_KEY) {
      return res.status(500).json({
        status: "error",
        message: "Server configuration error"
      });
    }

    const userSupabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { data, error } = await userSupabase.rpc(
      "buy_story_with_wallet",
      {
        p_story_id: story_id,
        p_purchase_type: purchase_type
      }
    );

    if (error) {
      return res.status(400).json({
        status: "error",
        message: error.message
      });
    }

    return res.json({
      status: "success",
      purchase: data
    });

  } catch (error) {
    console.error("WALLET PURCHASE ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Wallet purchase failed"
    });
  }
});
app.get("/api/wallet/balance", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "Please login first"
      });
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid login"
      });
    }

    const { data, error } = await supabase
      .from("wallets")
      .select("balance_usd")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        status: "error",
        message: error.message
      });
    }

    return res.json({
      status: "success",
      balance_usd: data?.balance_usd ?? 0
    });

  } catch (error) {
    console.error("WALLET BALANCE ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to load wallet"
    });
  }
});
app.listen(PORT, () => {
  console.log(`AiPreewie server running on port ${PORT}`);
});
