import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Strategy Plan JSON Schema for Gemini
const StrategyPlanSchema = {
  type: "object",
  properties: {
    umkmLevel: {
      type: "string",
      enum: ["mikro", "kecil", "menengah", "besar"]
    },
    diagnosis: {
      type: "array",
      items: { type: "string" },
      description: "Array of key business diagnosis points"
    },
    quickWins: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          impact: {
            type: "string",
            enum: ["rendah", "sedang", "tinggi"]
          },
          effort: {
            type: "string", 
            enum: ["rendah", "sedang", "tinggi"]
          },
          action: { type: "string" }
        },
        required: ["title", "impact", "effort", "action"]
      }
    },
    initiatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          owner: { type: "string" },
          startMonth: { 
            type: "string",
            pattern: "^\\d{4}-\\d{2}$"
          },
          kpi: { type: "string" },
          target: { type: "string" }
        },
        required: ["title", "description", "owner", "startMonth", "kpi", "target"]
      }
    },
    risks: {
      type: "array",
      items: { type: "string" }
    },
    assumptions: {
      type: "array", 
      items: { type: "string" }
    },
    dataGaps: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["umkmLevel", "diagnosis", "quickWins", "initiatives"]
};

interface GeneratePlanRequest {
  context: {
    company: {
      displayName?: string;
      city?: string;
      umkmLevel?: string;
    };
    window: {
      monthsCount: number;
      startMonth: string;
      endMonth: string;
    };
    months: Array<{
      monthStart: string;
      salesRp: number;
      cogsRp: number;
      opexRp: number;
      grossProfitRp: number;
      netProfitRp: number;
      grossMargin: number;
      netMargin: number;
      momSalesPct: number;
      topExpenses: Array<{category: string; amount_rp: number}>;
    }>;
    last12mTurnoverRp: number;
    seasonalityHints: string[];
    notes: string[];
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Generating strategy plan for user:', user.id);

    // Parse request body
    const { context }: GeneratePlanRequest = await req.json();
    
    if (!context) {
      throw new Error('Missing context in request body');
    }

    // Get Gemini API configuration
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiModel = Deno.env.get('GEMINI_MODEL_ID') || 'gemini-2.5-flash';

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    console.log('Using Gemini model:', geminiModel);

    // Prepare context for AI
    const contextStr = `
UMKM Business Context:
- Company: ${context.company.displayName || 'Unknown'} di ${context.company.city || 'Unknown'}
- UMKM Level: ${context.company.umkmLevel || 'Unknown'}
- Analysis Period: ${context.window.startMonth} to ${context.window.endMonth} (${context.window.monthsCount} months)
- Last 12M Turnover: Rp ${context.last12mTurnoverRp.toLocaleString()}

Financial Performance:
${context.months.map(month => `
- ${month.monthStart}: Sales Rp${month.salesRp.toLocaleString()}, Gross Profit Rp${month.grossProfitRp.toLocaleString()} (${month.grossMargin}%), Net Profit Rp${month.netProfitRp.toLocaleString()} (${month.netMargin}%), MoM Growth ${month.momSalesPct}%
  Top Expenses: ${month.topExpenses.slice(0,3).map(exp => `${exp.category} Rp${exp.amount_rp.toLocaleString()}`).join(', ')}
`).join('')}

Seasonality: ${context.seasonalityHints.join(', ')}
Additional Notes: ${context.notes.join(', ')}

Berikan analisis strategis UMKM ini dalam bahasa Indonesia dengan diagnosis bisnis, quick wins prioritas tinggi, dan inisiatif strategis yang konkret dan dapat diimplementasikan.
`;

    const requestBody = {
      contents: [{
        parts: [{
          text: `Sebagai konsultan bisnis UMKM Indonesia, analisis data finansial berikut dan berikan rencana strategis yang terstruktur:

${contextStr}

Berikan analisis dalam format JSON dengan:
1. diagnosis: array string insight utama tentang kondisi bisnis
2. quickWins: array objek dengan title, impact (rendah/sedang/tinggi), effort (rendah/sedang/tinggi), action
3. initiatives: array objek dengan title, description, owner, startMonth (YYYY-MM), kpi, target
4. risks: array string potensi risiko 
5. assumptions: array string asumsi yang digunakan
6. dataGaps: array string gap data yang perlu dilengkapi

Focus pada actionable recommendations yang sesuai dengan karakteristik UMKM Indonesia.`
        }]
      }],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: StrategyPlanSchema
      }
    };

    console.log('Calling Gemini API...');

    // Call Gemini API
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', geminiResponse.status, errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status} ${errorText}`);
    }

    const geminiResult = await geminiResponse.json();
    console.log('Gemini response received');

    // Extract JSON from response
    const candidateText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('No content in Gemini response');
    }

    let resultJson;
    try {
      // Try to parse as pure JSON first
      resultJson = JSON.parse(candidateText);
    } catch {
      // If that fails, extract JSON from text
      const jsonMatch = candidateText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        resultJson = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in Gemini response');
      }
    }

    console.log('Successfully parsed strategy plan JSON');

    // Save to ai_summaries table
    const { data: savedSummary, error: saveError } = await supabase
      .from('ai_summaries')
      .insert({
        user_id: user.id,
        type: 'strategy_plan',
        model: geminiModel,
        context_snapshot: context,
        result_json: resultJson,
        version: 1
      })
      .select()
      .single();

    if (saveError) {
      console.error('Failed to save AI summary:', saveError);
      // Continue anyway, return the result
    } else {
      console.log('Saved strategy plan to database:', savedSummary.id);
    }

    return new Response(JSON.stringify({
      success: true,
      json: resultJson,
      savedSummaryId: savedSummary?.id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai_generate_plan function:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});