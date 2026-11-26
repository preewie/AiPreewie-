
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase server environment variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (req, res) => {
  res.json({ message: "AiPreewie server is running" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
app.get("/db-check", async (req, res) => {
  const { data, error } = await supabase
    .from("stories")
    .select("id")
    .limit(1);

  if (error) {
    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }

  res.json({
    status: "connected",
    message: "Supabase database connected"
  });
});
app.listen(PORT, () => {
  console.log(`AiPreewie server running on port ${PORT}`);
});
