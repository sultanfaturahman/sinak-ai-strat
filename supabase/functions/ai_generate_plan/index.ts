// supabase/functions/ai_generate_plan/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Using Hugging Face Inference API (free)
const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY"); // Optional, can work without key but with rate limits
const MODEL_ID = "gpt2"; // Very reliable base model
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

    console.log("Attempting to call Hugging Face API...");
    console.log("Model:", MODEL_ID);
    console.log("URL:", HF_URL);
    console.log("Has API Key:", !!HF_API_KEY);

    // Try Hugging Face API first
    try {
      const prompt = `Generate a strategic business analysis in JSON format based on the following data: ${JSON.stringify(ctx, null, 2)}`;
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (HF_API_KEY) {
        headers["Authorization"] = `Bearer ${HF_API_KEY}`;
      }

      const payload = {
        inputs: prompt,
        parameters: {
          max_new_tokens: 800,
          temperature: 0.3,
          return_full_text: false
        }
      };

      const res = await fetch(HF_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      console.log("Hugging Face API response status:", res.status);
      
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        let text = "";
        if (Array.isArray(data) && data.length > 0) {
          text = data[0]?.generated_text || data[0] || "";
        } else if (typeof data === "string") {
          text = data;
        } else if (data?.generated_text) {
          text = data.generated_text;
        }

        if (text) {
          let json: unknown;
          try {
            json = JSON.parse(text);
            return new Response(JSON.stringify({ ok: true, json }), {
              status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
            });
          } catch (parseError) {
            const ex = extractFirstJson(text);
            if (ex) {
              try {
                json = JSON.parse(ex);
                return new Response(JSON.stringify({ ok: true, json }), {
                  status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
                });
              } catch (extractError) {
                console.error("Failed to parse extracted JSON:", ex);
              }
            }
          }
        }
      }
    } catch (hfError) {
      console.error("Hugging Face API failed:", hfError);
    }

    // Fallback: Generate structured analysis based on the data
    console.log("Using fallback strategic analysis generation...");
    
    const totalSales = ctx.months.reduce((sum: number, m: any) => sum + num(m.salesRp, 0), 0);
    const avgMonthlySales = totalSales / Math.max(ctx.months.length, 1);
    const lastMonthSales = ctx.months[ctx.months.length - 1]?.salesRp || 0;
    const trend = lastMonthSales > avgMonthlySales ? "meningkat" : "menurun";
    
    const fallbackPlan = {
      umkmLevel: ctx.umkmLevel || "mikro",
      diagnosis: [
        `Penjualan rata-rata bulanan: Rp ${avgMonthlySales.toLocaleString('id-ID')}`,
        `Tren penjualan periode ini: ${trend}`,
        `Total omzet ${ctx.months.length} bulan terakhir: Rp ${totalSales.toLocaleString('id-ID')}`,
        "Perlu analisis margin kotor dan operasional yang lebih detail",
        "Struktur biaya perlu dioptimalkan untuk meningkatkan profitabilitas"
      ],
      quickWins: [
        {
          title: "Optimalisasi Biaya Operasional",
          impact: "tinggi",
          effort: "sedang", 
          action: "Review dan negosiasi ulang kontrak supplier utama untuk menurunkan COGS"
        },
        {
          title: "Peningkatan Margin Produk",
          impact: "tinggi",
          effort: "rendah",
          action: "Analisis pricing strategy untuk produk dengan margin tertinggi"
        },
        {
          title: "Efisiensi Inventori",
          impact: "sedang",
          effort: "rendah",
          action: "Implementasi sistem tracking inventori untuk mengurangi waste"
        }
      ],
      initiatives: [
        {
          title: "Program Digitalisasi Penjualan",
          description: "Mengembangkan channel digital untuk meningkatkan jangkauan pasar",
          owner: "Tim Marketing & IT",
          startMonth: "2025-09",
          kpi: "Peningkatan penjualan online",
          target: "25% dari total penjualan dalam 6 bulan"
        },
        {
          title: "Sistem Manajemen Keuangan",
          description: "Implementasi sistem akuntansi terintegrasi untuk tracking real-time",
          owner: "Tim Finance",
          startMonth: "2025-10",
          kpi: "Akurasi laporan keuangan",
          target: "Laporan real-time mingguan"
        },
        {
          title: "Program Efisiensi Operasional", 
          description: "Optimalisasi proses bisnis untuk mengurangi biaya operasional",
          owner: "Tim Operations",
          startMonth: "2025-09",
          kpi: "Rasio OPEX terhadap Revenue",
          target: "Turun 15% dalam 4 bulan"
        }
      ],
      risks: [
        "Fluktuasi harga bahan baku dapat mempengaruhi margin",
        "Persaingan ketat di pasar dapat menurunkan market share", 
        "Ketergantungan pada supplier tunggal menciptakan supply risk",
        "Cash flow yang tidak stabil dapat mengganggu operasional"
      ],
      assumptions: [
        "Kondisi pasar tetap stabil dalam 6 bulan ke depan",
        "Tidak ada perubahan regulasi yang signifikan",
        "Tim internal memiliki kapasitas untuk implementasi inisiatif",
        "Akses funding tersedia untuk investasi yang diperlukan"
      ],
      dataGaps: [
        "Data detail customer segmentation belum tersedia",
        "Analisis kompetitor belum komprehensif",
        "Tracking customer acquisition cost perlu diperbaiki",
        "Data seasonal pattern perlu analisis lebih mendalam"
      ]
    };

    return new Response(JSON.stringify({ ok: true, json: fallbackPlan, source: "fallback" }), {
      status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });

  } catch (e: any) {
    console.error("Function error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });
  }
});