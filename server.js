
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();

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
    "download_price_khr"
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

app.listen(PORT, () => {
  console.log(`AiPreewie server running on port ${PORT}`);
});
