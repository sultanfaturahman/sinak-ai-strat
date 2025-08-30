import { getSupabase } from '@/lib/supabaseClient';
import { buildStrategyContextSupabase, StrategyContext } from './contextBuilder.supabase';

export interface StrategyPlan {
  umkmLevel: 'mikro' | 'kecil' | 'menengah' | 'besar';
  diagnosis: string[];
  quickWins: Array<{
    title: string;
    impact: 'rendah' | 'sedang' | 'tinggi';
    effort: 'rendah' | 'sedang' | 'tinggi';
    action: string;
    notes?: string;
  }>;
  initiatives: Array<{
    title: string;
    description: string;
    owner: string;
    startMonth: string; // YYYY-MM format
    kpi: string;
    target: string;
    notes?: string;
  }>;
  risks?: string[];
  assumptions?: string[];
  dataGaps?: string[];
}

export interface StrategyResult {
  success: boolean;
  plan?: StrategyPlan;
  savedSummaryId?: string;
  context?: StrategyContext;
  error?: string;
  source?: 'cache' | 'ai' | 'fallback';
  meta?: {
    provider?: string;
    model?: string;
    source?: string;
    monthsUsed?: number;
    ctxHash?: string;
  };
}

/**
 * Generate strategy plan using AI via Supabase Edge Function
 */
export async function runStrategyAnalysis(monthsBack: number = 12): Promise<StrategyResult> {
  try {
    console.log('Starting strategy analysis...');
    
    const supabase = getSupabase();
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return {
        success: false,
        error: 'User not authenticated',
      };
    }

    // Build context from Supabase data
    const context = await buildStrategyContextSupabase(monthsBack);
    console.log('Context built:', { 
      monthsCount: context.months.length,
      features: context.features  
    });

    if (context.months.length < 2) {
      return {
        success: false,
        error: 'Minimal 2 bulan data diperlukan untuk analisis strategis. Silakan import lebih banyak data transaksi.'
      };
    }

    // Calculate context hash for caching
    const ctxHash = await hashContext(context);
    console.log('Context hash:', ctxHash.slice(0, 16));

    // Check for cached result with matching context hash
    const { data: cached, error: cacheError } = await supabase
      .from('ai_summaries')
      .select('result_json, context_snapshot')
      .eq('user_id', user.id)
      .eq('type', 'strategy_plan')
      .eq('context_hash', ctxHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cacheError) {
      console.warn('Cache check failed:', cacheError.message);
    }

    if (cached?.result_json) {
      console.log('Using cached strategy plan with matching context');
      return {
        success: true,
        plan: cached.result_json as unknown as StrategyPlan,
        context: context,
        source: 'cache'
      };
    }

    console.log('No matching cache found, generating new strategy...');

    // Get auth token for Edge Function
    const session = await supabase.auth.getSession();
    if (!session.data.session?.access_token) {
      return {
        success: false,
        error: 'No authentication token available',
      };
    }

    // Call Edge Function with enhanced parameters
    const { data: response, error: functionError } = await supabase.functions.invoke('ai_generate_plan', {
      body: { 
        context, 
        ctxHash,
        forceProvider: undefined, 
        allowFallback: true 
      },
      headers: {
        Authorization: `Bearer ${session.data.session.access_token}`,
      },
    });

    if (functionError) {
      console.error('Edge function error:', functionError);
      return {
        success: false,
        error: functionError.message || 'Failed to generate strategy plan',
        context
      };
    }

    if (!response?.ok) {
      console.error('Edge function returned error:', response);
      return {
        success: false,
        error: response?.error || 'Unknown error occurred',
        context
      };
    }

    const plan = response.json || response.plan;
    const meta = response.meta || {};

    if (!plan) {
      return {
        success: false,
        error: 'No plan data received from AI service',
        context
      };
    }

    // Validate the response structure
    if (!plan.umkmLevel || !plan.diagnosis || !plan.quickWins || !plan.initiatives) {
      console.error('Invalid plan structure:', plan);
      return {
        success: false,
        error: 'Invalid strategy plan format received from AI',
        context
      };
    }

    // Validate required arrays
    if (!Array.isArray(plan.diagnosis) || !Array.isArray(plan.quickWins) || !Array.isArray(plan.initiatives)) {
      console.error('Plan arrays validation failed:', plan);
      return {
        success: false,
        error: 'Invalid strategy plan structure',
        context
      };
    }

    console.log('Strategy plan generated successfully');
    console.log('Metadata:', meta);

    // Save to database with comprehensive metadata
    const { data: savedSummary, error: saveError } = await supabase
      .from('ai_summaries')
      .insert({
        user_id: user.id,
        type: 'strategy_plan' as const,
        model: meta.model || 'unknown',
        version: 1,
        result_json: plan as any,
        context_snapshot: context as any,
        context_hash: ctxHash,
      })
      .select('id')
      .single();

    if (saveError) {
      console.warn('Failed to save summary:', saveError.message);
      // Don't fail the whole operation if saving fails
    }

    return {
      success: true,
      plan: plan as StrategyPlan,
      savedSummaryId: savedSummary?.id,
      context: context,
      meta: meta,
      source: meta.source === 'local-fallback' ? 'fallback' : 'ai'
    };

  } catch (error) {
    console.error('Strategy analysis error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    };
  }
}

/**
 * Hash context for caching
 */
async function hashContext(ctx: any): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ctx)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get previously saved strategy plans for the current user
 */
export async function getSavedStrategyPlans(limit: number = 10) {
  const supabase = getSupabase();
  
  try {
    const { data: summaries, error } = await supabase
      .from('ai_summaries')
      .select('*')
      .eq('type', 'strategy_plan')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching saved strategies:', error);
      return { success: false, error: error.message };
    }

    return { success: true, summaries: summaries || [] };
  } catch (error) {
    console.error('Error in getSavedStrategyPlans:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Format strategy plan for display
 */
export function formatStrategyDisplay(plan: StrategyPlan) {
  return {
    ...plan,
    quickWins: plan.quickWins.map(qw => ({
      ...qw,
      priority: calculatePriority(qw.impact, qw.effort),
      impactIcon: getImpactIcon(qw.impact),
      effortIcon: getEffortIcon(qw.effort)
    })),
    initiatives: plan.initiatives.map(init => ({
      ...init,
      startDate: new Date(init.startMonth + '-01'),
      formattedMonth: formatMonth(init.startMonth)
    }))
  };
}

function calculatePriority(impact: string, effort: string): 'high' | 'medium' | 'low' {
  const impactScore = impact === 'tinggi' ? 3 : impact === 'sedang' ? 2 : 1;
  const effortScore = effort === 'rendah' ? 3 : effort === 'sedang' ? 2 : 1;
  const priority = impactScore + effortScore;
  
  if (priority >= 5) return 'high';
  if (priority >= 3) return 'medium';
  return 'low';
}

function getImpactIcon(impact: string): string {
  switch (impact) {
    case 'tinggi': return '🔥';
    case 'sedang': return '⚡';
    case 'rendah': return '💡';
    default: return '❓';
  }
}

function getEffortIcon(effort: string): string {
  switch (effort) {
    case 'rendah': return '⚡';
    case 'sedang': return '⚖️';
    case 'tinggi': return '🏋️';
    default: return '❓';
  }
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                     'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}