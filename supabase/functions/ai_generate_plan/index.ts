// supabase/functions/ai_generate_plan/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Using Hugging Face Inference API (free)
const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY"); // Optional, can work without key but with rate limits
const MODEL_ID = "microsoft/DialoGPT-medium"; // Free model, or use "gpt2" for simpler responses
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

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
  // Clean the text first - remove markdown code blocks if present
  let cleaned = text.trim();
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  
  // Try to find JSON boundaries
  const iObj = cleaned.indexOf("{");
  const iArr = cleaned.indexOf("[");
  let start = -1, open = "", close = "";
  
  if (iObj !== -1 && (iArr === -1 || iObj < iArr)) { 
    start = iObj; open = "{"; close = "}"; 
  } else if (iArr !== -1) { 
    start = iArr; open = "["; close = "]"; 
  }
  
  if (start === -1) return null;
  
  let depth = 0, inStr = false, prev = "";
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) { 
      if (ch === '"' && prev !== "\\") inStr = false; 
    } else {
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { 
        depth--; 
        if (depth === 0) return cleaned.slice(start, i+1); 
      }
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
    const body = await req.json().catch(() => null) as { context?: AnyObj } | null;
    if (!body?.context) {
      return new Response(JSON.stringify({ error: "Bad Request: context required" }), {
        status: 400, headers: { ...corsHeaders(origin), "content-type": "application/json" }
      });
    }

    // Sanitasi: TIDAK ADA toLocaleString di sini
    const ctx = sanitizeContext(body.context);

    // Create prompt for Hugging Face model
    const prompt = `Berdasarkan data bisnis berikut, buatlah analisis strategis dalam format JSON:

KONTEKS:
${JSON.stringify(ctx, null, 2)}

TUGAS: Buat analisis strategi dengan format JSON yang berisi:
1. diagnosis: array berisi 3-7 poin analisis kondisi bisnis
2. quickWins: array berisi 3-5 tindakan cepat (title, impact: rendah/sedang/tinggi, effort: rendah/sedang/tinggi, action)
3. initiatives: array berisi 3-6 inisiatif strategis (title, description, owner, startMonth: YYYY-MM, kpi, target)
4. risks: array berisi risiko-risiko potensial
5. assumptions: array berisi asumsi yang digunakan
6. dataGaps: array berisi gap data yang teridentifikasi
7. umkmLevel: mikro/kecil/menengah/besar

Berikan HANYA JSON valid tanpa penjelasan tambahan:`;

    // Prepare headers for Hugging Face API
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (HF_API_KEY) {
      headers["Authorization"] = `Bearer ${HF_API_KEY}`;
    }

    const payload = {
      inputs: prompt,
      parameters: {
        max_new_tokens: 1000,
        temperature: 0.2,
        return_full_text: false
      }
    };

    const res = await fetch(HF_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return new Response(JSON.stringify({
        error: "Hugging Face API error",
        status: res.status,
        body: errBody.slice(0, 2000)
      }), { status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }});
    }

    const data = await res.json().catch(() => ({}));
    // Hugging Face returns either array with generated_text or direct text
    let text = "";
    if (Array.isArray(data) && data.length > 0) {
      text = data[0]?.generated_text || data[0] || "";
    } else if (typeof data === "string") {
      text = data;
    } else if (data?.generated_text) {
      text = data.generated_text;
    }

    console.log("Hugging Face response status:", res.status);
    console.log("Raw text from Hugging Face:", text);
    console.log("Full data structure:", JSON.stringify(data, null, 2));

    let json: unknown;
    try {
      if (!text) throw new Error("Empty model response");
      json = JSON.parse(text);
      console.log("Successfully parsed JSON:", json);
    } catch (parseError) {
      console.log("JSON parse failed, trying extraction...");
      const ex = text ? extractFirstJson(text) : null;
      console.log("Extracted JSON:", ex);
      if (!ex) {
        console.error("Failed to extract JSON from text:", text);
        return new Response(JSON.stringify({ 
          error: "Model returned non-JSON", 
          raw: text || "no text", 
          data: data,
          parseError: (parseError as Error).message 
        }), {
          status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }
        });
      }
      try {
        json = JSON.parse(ex);
        console.log("Successfully parsed extracted JSON:", json);
      } catch (extractError) {
        console.error("Failed to parse extracted JSON:", ex, extractError);
        return new Response(JSON.stringify({ 
          error: "Failed to parse extracted JSON", 
          extracted: ex, 
          parseError: (extractError as Error).message 
        }), {
          status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }
        });
      }
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