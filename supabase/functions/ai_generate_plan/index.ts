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
        action:{ type: "string" },
        notes: { type: "string" }
      }, required: ["title","impact","effort","action","notes"]
    }, minItems: 3, maxItems: 5 },
    initiatives: { type: "array", items: {
      type: "object", properties: {
        title: { type: "string" },
        description: { type: "string" },
        owner: { type: "string" },
        startMonth: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
        kpi: { type: "string" },
        target: { type: "string" },
        notes: { type: "string" }
      }, required: ["title","description","owner","startMonth","kpi","target","notes"]
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

function generateRuleSeeds(ctx: any): string {
  if (!ctx.months || ctx.months.length === 0) return "No rule seeds available - insufficient data.";
  
  const features = ctx.features || {};
  const lastMonth = ctx.months[ctx.months.length - 1];
  const nextMonth = getNextMonth(lastMonth?.monthStart || '2025-01');
  const seeds = [];
  
  // High OPEX seed
  if (features.opexShare > 0.3) {
    seeds.push(`Quick Win: "Kontrol OPEX Darurat" - OPEX/sales ${(features.opexShare * 100).toFixed(1)}% terlalu tinggi, target turun ke ${((features.opexShare - 0.05) * 100).toFixed(1)}%`);
  }
  
  // Margin trend seed
  if (features.nmTrend < -3) {
    seeds.push(`Initiative: "Program Pemulihan Profitabilitas" - Net margin trend turun ${Math.abs(features.nmTrend).toFixed(1)} p.p, target naik dari ${features.nmAvg.toFixed(1)}% ke ${(features.nmAvg + 5).toFixed(1)}%`);
  }
  
  // Volatility seed
  if (features.volatilityIdx > 15) {
    seeds.push(`Initiative: "Stabilisasi Penjualan" - Volatilitas ${features.volatilityIdx.toFixed(1)}% terlalu tinggi, target <12%`);
  }
  
  // Seasonal seed
  if (features.peakMonth && features.lowMonth && features.peakMonth !== features.lowMonth) {
    seeds.push(`Initiative: "Optimalisasi ${features.lowMonth}" - Peak: ${features.peakMonth}, Low: ${features.lowMonth}, target naik 20% di bulan lemah`);
  }
  
  return seeds.length > 0 ? seeds.join('\n') : "Standard business optimization recommendations.";
}

function getNextMonth(monthStart: string): string {
  try {
    const date = new Date(monthStart + '-01');
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 7);
  } catch {
    return '2025-09';
  }
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
    const body = await req.json().catch(() => null) as { 
      context?: AnyObj; 
      ctxHash?: string; 
      forceProvider?: "hf" | "local"; 
      allowFallback?: boolean 
    } | null;
    
    if (!body?.context) {
      return new Response(JSON.stringify({ error: "Bad Request: context required" }), {
        status: 400, headers: { ...corsHeaders(origin), "content-type": "application/json" }
      });
    }

    // Sanitasi: TIDAK ADA toLocaleString di sini
    const ctx = sanitizeContext(body.context);
    const ctxHash = body.ctxHash || "";
    const forceProvider = body.forceProvider;
    const allowFallback = body.allowFallback !== false; // default true

    // If forceProvider is "local", skip to fallback
    if (forceProvider === "local") {
      console.log("Forced to use local fallback...");
    } else {
      console.log("Attempting to call Hugging Face API...");
      console.log("Model:", MODEL_ID);
      console.log("URL:", HF_URL);
      console.log("Has API Key:", !!HF_API_KEY);

      // Try Hugging Face API first
      try {
        // Generate rule-based seeds for more deterministic variation
        const ruleSeeds = generateRuleSeeds(ctx);
        
        const prompt = `Generate a strategic business analysis in JSON format based on the following context data. 

CRITICAL REQUIREMENTS:
- Every diagnosis MUST reference specific months and numbers from the context (e.g., "penjualan turun 12% MoM pada ${ctx.months[ctx.months.length-1]?.monthStart}")
- Every quick win MUST include numerical justification with exact figures (e.g., "OPEX/sales ${(ctx.features.opexShare * 100).toFixed(1)}% pada ${ctx.months[ctx.months.length-1]?.monthStart}")  
- Every initiative MUST have measurable KPI and target with specific percentages or amounts from the data
- Use startMonth as the next month after the latest data month: ${getNextMonth(ctx.months[ctx.months.length-1]?.monthStart || '2025-01')}
- MANDATORY: Include notes field with specific data references for each quick win and initiative
- Focus on the specific business metrics: GM avg ${ctx.features.gmAvg.toFixed(1)}%, NM avg ${ctx.features.nmAvg.toFixed(1)}%, OPEX share ${(ctx.features.opexShare * 100).toFixed(1)}%

SUGGESTED CANDIDATES (you can modify or add to these):
${ruleSeeds}

Context Data: ${JSON.stringify(ctx, null, 2)}

Return valid JSON matching the schema exactly. Every recommendation must cite specific months and numerical data from the context.`;
      
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Wait-For-Model": "true",
          "X-Use-Cache": "false"
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
            
            return new Response(JSON.stringify({ 
              ok: true, 
              json,
              meta: {
                provider: "huggingface",
                model: MODEL_ID,
                source: "hf",
                monthsUsed: ctx.months.length,
                ctxHash: ctxHash
              }
            }), {
              status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
            });
          } catch (parseError) {
            const ex = extractFirstJson(text);
            if (ex) {
              try {
                json = JSON.parse(ex);
                
                return new Response(JSON.stringify({ 
                  ok: true, 
                  json,
                  meta: {
                    provider: "huggingface",
                    model: MODEL_ID,
                    source: "hf",
                    monthsUsed: ctx.months.length,
                    ctxHash: ctxHash
                  }
                }), {
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
    }

    // Check if fallback is allowed
    if (!allowFallback) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: "AI generation failed and fallback disabled",
        canClientFallback: true
      }), {
        status: 502, headers: { ...corsHeaders(origin), "content-type": "application/json" }
      });
    }

    // Fallback: Generate structured analysis based on the data
    console.log("Using fallback strategic analysis generation...");
    
    const totalSales = ctx.months.reduce((sum: number, m: any) => sum + num(m.salesRp, 0), 0);
    const avgMonthlySales = totalSales / Math.max(ctx.months.length, 1);
    const lastMonth = ctx.months[ctx.months.length - 1] || {};
    const lastMonthSales = lastMonth.salesRp || 0;
    const lastMonthStr = lastMonth.monthStart || '2025-08';
    const nextMonth = getNextMonth(lastMonthStr);
    const trend = lastMonthSales > avgMonthlySales ? "meningkat" : "menurun";
    const features = ctx.features || {};
    
    const fallbackPlan = {
      umkmLevel: ctx.umkmLevel || "mikro",
      diagnosis: [
        `Penjualan rata-rata bulanan: Rp ${Math.round(avgMonthlySales).toLocaleString()} (data ${ctx.months.length} bulan terakhir)`,
        `Penjualan ${lastMonthStr}: Rp ${lastMonthSales.toLocaleString()}, tren ${trend} vs rata-rata`,
        `Gross margin rata-rata: ${(features.gmAvg || 0).toFixed(1)}%, Net margin: ${(features.nmAvg || 0).toFixed(1)}%`,
        `OPEX share: ${((features.opexShare || 0) * 100).toFixed(1)}% dari sales pada ${lastMonthStr}`,
        `Volatilitas penjualan: ${(features.volatilityIdx || 0).toFixed(1)}% menunjukkan ${features.volatilityIdx > 15 ? 'fluktuasi tinggi' : 'relatif stabil'}`
      ],
      quickWins: [
        {
          title: "Optimalisasi Biaya Operasional",
          impact: "tinggi",
          effort: "sedang", 
          action: "Review dan negosiasi ulang kontrak supplier utama untuk menurunkan COGS",
          notes: `OPEX/sales saat ini ${((features.opexShare || 0) * 100).toFixed(1)}% pada ${lastMonthStr}`
        },
        {
          title: "Peningkatan Margin Produk",
          impact: "tinggi",
          effort: "rendah",
          action: "Analisis pricing strategy untuk produk dengan margin tertinggi",
          notes: `Gross margin rata-rata ${(features.gmAvg || 0).toFixed(1)}% masih bisa dioptimalkan`
        },
        {
          title: "Efisiensi Inventori",
          impact: "sedang",
          effort: "rendah",
          action: "Implementasi sistem tracking inventori untuk mengurangi waste",
          notes: `Fokus pada bulan ${features.lowMonth || lastMonthStr} yang menunjukkan penjualan terendah`
        }
      ],
      initiatives: [
        {
          title: "Program Digitalisasi Penjualan",
          description: "Mengembangkan channel digital untuk meningkatkan jangkauan pasar",
          owner: "Tim Marketing & IT",
          startMonth: nextMonth,
          kpi: "Peningkatan penjualan online",
          target: "25% dari total penjualan dalam 6 bulan",
          notes: `Dimulai ${nextMonth} setelah data terakhir ${lastMonthStr}`
        },
        {
          title: "Sistem Manajemen Keuangan",
          description: "Implementasi sistem akuntangi terintegrasi untuk tracking real-time",
          owner: "Tim Finance", 
          startMonth: nextMonth,
          kpi: "Akurasi laporan keuangan",
          target: "Laporan real-time mingguan",
          notes: `Net margin ${(features.nmAvg || 0).toFixed(1)}% perlu monitoring ketat`
        },
        {
          title: "Program Efisiensi Operasional", 
          description: "Optimalisasi proses bisnis untuk mengurangi biaya operasional",
          owner: "Tim Operations",
          startMonth: nextMonth,
          kpi: "Rasio OPEX terhadap Revenue", 
          target: `Turun dari ${((features.opexShare || 0) * 100).toFixed(1)}% ke ${(((features.opexShare || 0) - 0.05) * 100).toFixed(1)}% dalam 4 bulan`,
          notes: `OPEX share ${((features.opexShare || 0) * 100).toFixed(1)}% pada ${lastMonthStr} terlalu tinggi`
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

    return new Response(JSON.stringify({ 
      ok: true, 
      json: fallbackPlan,
      meta: {
        provider: "local",
        model: "edge-fallback",
        source: "local-fallback",
        monthsUsed: ctx.months.length,
        ctxHash: ctxHash
      }
    }), {
      status: 200, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });

  } catch (e: any) {
    console.error("Function error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders(origin), "content-type": "application/json" }
    });
  }
});