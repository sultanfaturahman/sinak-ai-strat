import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Normal = { dateISO: string; kind: "income"|"cogs"|"expense"; category: string; amountRp: number; notes: string; };

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

function toIntRp(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") { const n = parseInt(v.replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : 0; }
  return 0;
}

// Parser CSV ringkas (menerima delimiter , atau ;)
function parseSimpleCsv(text: string): Normal[] {
  const out: Normal[] = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return out;
  lines[0] = lines[0].replace(/^\uFEFF/, "");
  const delim = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
  const cols = lines[0].split(delim).map(s => s.trim().toLowerCase());
  const idx = {
    date: cols.indexOf("date"),
    type: cols.indexOf("type"),
    category: cols.indexOf("category"),
    amountRp: cols.indexOf("amountrp"),
    notes: cols.indexOf("notes")
  };
  if (idx.date < 0 || idx.type < 0 || idx.category < 0 || idx.amountRp < 0) {
    throw new Error('CSV header wajib: "date,type,category,amountRp[,notes]"');
  }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim(); if (!raw) continue;
    const parts = raw.split(delim);
    const get = (j: number) => (j >= 0 && j < parts.length ? parts[j].trim() : "");
    const dateStr = get(idx.date);
    const kind = get(idx.type).toLowerCase() as "income"|"cogs"|"expense";
    const category = get(idx.category) || "other";
    const amountRp = toIntRp(get(idx.amountRp));
    const notes = get(idx.notes);

    const d = new Date(dateStr); if (isNaN(d.getTime())) continue;
    if (!["income","cogs","expense"].includes(kind)) continue;
    const dateISO = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0,10);
    out.push({ dateISO, kind, category, amountRp, notes });
  }
  return out;
}

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }

  const stage = { v: "init" };
  try {
    stage.v = "env";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(JSON.stringify({
        error: "Missing server secrets",
        missing: { SUPABASE_URL: !supabaseUrl, SUPABASE_ANON_KEY: !anonKey, SUPABASE_SERVICE_ROLE_KEY: !serviceKey }
      }), { status: 500, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }

    stage.v = "auth";
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", detail: userErr?.message }), { status: 401, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }

    stage.v = "body";
    const body = await req.json().catch(()=>null) as { bucket?: string; path?: string } | null;
    if (!body?.bucket || !body?.path) {
      return new Response(JSON.stringify({ error: "Bad Request", detail: "{bucket,path} required" }), { status: 400, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }
    if (!body.path.startsWith(`${user.id}/`)) {
      return new Response(JSON.stringify({ error: "Forbidden path", detail: "Path harus diawali <user_id>/" }), { status: 403, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }

    stage.v = "download";
    const admin = createClient(supabaseUrl, serviceKey);
    const dl = await admin.storage.from(body.bucket).download(body.path);
    if (dl.error) {
      return new Response(JSON.stringify({ error: "Download error", detail: dl.error.message }), { status: 400, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }
    const csvText = await dl.data.text();

    stage.v = "parse";
    const rows = parseSimpleCsv(csvText);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "CSV kosong / tidak valid", detail: "Tidak ada baris valid yang terdeteksi" }), { status: 400, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
    }

    stage.v = "upsert";
    const chunk = 500; let imported = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const payload = await Promise.all(part.map(async (x) => {
        const h = await sha1Hex(`${user.id}|${x.dateISO}|${x.kind}|${x.category}|${x.amountRp}|${x.notes}`);
        return { user_id: user.id, date_ts: x.dateISO, kind: x.kind, category: x.category, amount_rp: x.amountRp, notes: x.notes, uniq_hash: h };
      }));
      const { error: upErr } = await admin.from("transactions").upsert(payload, { onConflict: "user_id,uniq_hash" });
      if (upErr) {
        return new Response(JSON.stringify({ error: "Upsert error", detail: upErr.message }), { status: 500, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
      }
      imported += payload.length;
    }

    // Log import_runs (tidak menjatuhkan fungsi jika tabel belum ada)
    stage.v = "log";
    try {
      await admin.from("import_runs").insert({
        user_id: user.id,
        filename: body.path,
        status: "succeeded",
        total_rows: rows.length,
        total_imported: imported,
        finished_at: new Date().toISOString()
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ ok: true, imported }), { status: 200, headers: { ...corsHeaders(origin), "content-type":"application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e), stage: stage.v }), { status: 500, headers: { ...corsHeaders(origin), "content-type":"application/json" } });
  }
});