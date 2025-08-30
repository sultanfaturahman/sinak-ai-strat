// supabase/functions/ai_generate_plan/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const MODEL_ID = Deno.env.get("GEMINI_MODEL_ID") ?? "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

// Skema output strategi (JSON-mode)
const StrategyPlanSchema = {
  type: "object",
  properties: {
    umkmLevel: { type: "string", enum: ["mikro","kecil","menengah","besar"] },
    diagnosis: { type: "array", items: { type: "string" } },
    quickWins: { type: "array", items: {
      type: "object", properties: {
        title: { type: "string" },
        impact:{ type: "string", enum: ["rendah","sedang","tinggi"] },
        effort:{ type: "string", enum: ["rendah","sedang","tinggi"] },
        action:{ type: "string" }
      }, required: ["title","impact","effort","action"]
    }, minItems: 3, maxItems: 5 },
    initiatives: { type: "array", items: {
      type: "object", properties: {
        title: { type: "string" },
        description: { type: "string" },
        owner: { type: "string" },
        startMonth: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
        kpi: { type: "string" },
        target: { type: "string" }
      }, required: ["title","description","owner","startMonth","kpi","target"]
    }, minItems: 3, maxItems: 6 },
    risks: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } }
  },
  required: ["umkmLevel","diagnosis","quickWins","initiatives"]
};

type AnyObj = Record<string, any>;

const num = (v: unknown, d = 0): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : (v == null ? d : String(v)));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function sanitizeContext(raw: AnyObj) {
  const months = arr(raw?.months).map((m: AnyObj) => ({
    month: str(m?.month),
    salesRp: num(m?.salesRp, 0),
    cogsRp:  num(m?.cogsRp, 0),
    opexRp:  num(m?.opexRp, 0),
    grossMargin: num(m?.grossMargin, 0),
    netMargin:   num(m?.netMargin, 0),
    topExpenses: arr(m?.topExpenses).map((t: AnyObj) => ({
      category: str(t?.category, "other"),
      totalRp:  num(t?.totalRp, 0),
    })),
  }));
  return {
    company: { name: str(raw?.company?.name), city: str(raw?.company?.city) },
    umkmLevel: ["mikro","kecil","menengah","besar"].includes(raw?.umkmLevel) ? raw.umkmLevel : "mikro",
    window: str(raw?.window),
    months,
    last12mTurnoverRp: num(raw?.last12mTurnoverRp, months.reduce((s,m)=>s + num(m.salesRp,0), 0)),
    seasonalityHints: arr(raw?.seasonalityHints).map((x) => str(x)),
    notes: arr(raw?.notes).map((x) => str(x)),
  };
}

function extractFirstJson(text: string): string | null {
  const iObj = text.indexOf("{"), iArr = text.indexOf("[");
  let start = -1, open = "", close = "";
  if (iObj !== -1 && (iArr === -1 || iObj < iArr)) { start = iObj; open = "{"; close = "}"; }
  else if (iArr !== -1) { start = iArr; open = "["; close = "]"; }
  if (start === -1) return null;
  let depth = 0, inStr = false, prev = "";
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '"' && prev !== "\\") inStr = false; }
    else {
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) return text.slice(start, i+1); }
    }
    prev = ch;
  }
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Server missing GEMINI_API_KEY" }), {
        status: 500, headers: { ...corsHeaders(origin), "content-type": "application/json" }
      });
    }

    const body = await req.json().catch(() => null) as { context?: AnyObj } | null;
    if (!body?.context) {
      return new Response(JSON.stringify({ error: "Bad Request: context required" }), {
        status: 400, headers: { ...corsHeaders(origin), "content-type": "application/json" }
      });
    }

    // Sanitasi: TIDAK ADA toLocaleString di sini
    const ctx = sanitizeContext(body.context);

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: "# KONTEKS (JSON)\n" + JSON.stringify(ctx) },
          { text: "# TUGAS\n1) Diagnosa (3–7 poin)\n2) 3–5 quick wins\n3) 3–6 inisiatif (owner, startMonth YYYY-MM, KPI, target)\n4) Risiko & asumsi.\nWAJIB: hanya JSON valid sesuai schema." }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1536,
        response_mime_type: "application/json",
        response_schema: StrategyPlanSchema
      }
    };

    const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return new Response(JSON.stringify({
        error: "Gemini HTTP error",
        status: res.status,
        body: errBody.slice(0, 2000) // biar tidak kepanjangan
      }), { status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }});
    }

    const data = await res.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let json: unknown;
    try {
      if (!text) throw new Error("Empty model response");
      json = JSON.parse(text);
    } catch {
      const ex = text ? extractFirstJson(text) : null;
      if (!ex) {
        return new Response(JSON.stringify({ error: "Model returned non-JSON", raw: text || data }), {
          status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }
        });
      }
      json = JSON.parse(ex);
    }

    return new Response(JSON.stringify({ ok: true, json }), {
      status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });
  }
});