import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const BUCKET = "agent-files";
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();
    let totalDeleted = 0;

    // List top-level folders in the bucket
    const { data: folders, error: foldersErr } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 1000 });

    if (foldersErr) {
      console.error("Error listing folders:", foldersErr);
      return new Response(JSON.stringify({ error: foldersErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const folder of folders || []) {
      if (!folder.name) continue;

      // List files in this folder
      const { data: files, error: filesErr } = await supabase.storage
        .from(BUCKET)
        .list(folder.name, { limit: 1000 });

      if (filesErr || !files) continue;

      const expiredPaths: string[] = [];

      for (const file of files) {
        if (!file.name) continue;
        // Extract timestamp from filename pattern: {timestamp}_{safeName}
        const tsMatch = file.name.match(/^(\d+)_/);
        if (tsMatch) {
          const fileTs = parseInt(tsMatch[1], 10);
          if (now - fileTs > MAX_AGE_MS) {
            expiredPaths.push(`${folder.name}/${file.name}`);
          }
        } else if (file.created_at) {
          // Fallback: use created_at metadata
          const createdTs = new Date(file.created_at).getTime();
          if (now - createdTs > MAX_AGE_MS) {
            expiredPaths.push(`${folder.name}/${file.name}`);
          }
        }
      }

      if (expiredPaths.length > 0) {
        const { error: delErr } = await supabase.storage
          .from(BUCKET)
          .remove(expiredPaths);

        if (delErr) {
          console.error(`Error deleting files in ${folder.name}:`, delErr);
        } else {
          totalDeleted += expiredPaths.length;
        }
      }
    }

    console.log(`Cleanup complete: ${totalDeleted} expired files deleted`);

    return new Response(
      JSON.stringify({ deleted: totalDeleted, timestamp: new Date().toISOString() }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Cleanup error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
