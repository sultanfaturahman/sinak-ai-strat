import { supabase } from '@/lib/supabaseClient';
import { buildStrategyContextSupabase, StrategyContext } from './contextBuilder.supabase';

export interface StrategyPlan {
  umkmLevel: 'mikro' | 'kecil' | 'menengah' | 'besar';
  diagnosis: string[];
  quickWins: Array<{
    title: string;
    impact: 'rendah' | 'sedang' | 'tinggi';
    effort: 'rendah' | 'sedang' | 'tinggi';
    action: string;
  }>;
  initiatives: Array<{
    title: string;
    description: string;
    owner: string;
    startMonth: string; // YYYY-MM format
    kpi: string;
    target: string;
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
}

/**
 * Generate strategy plan using AI via Supabase Edge Function
 */
export async function runStrategyAnalysis(monthsBack: number = 12): Promise<StrategyResult> {
  try {
    console.log('Starting strategy analysis...');
    
    // Build context from Supabase data
    const context = await buildStrategyContextSupabase(monthsBack);
    console.log('Built context:', context);

    if (context.months.length < 2) {
      return {
        success: false,
        error: 'Minimal 2 bulan data diperlukan untuk analisis strategis. Silakan import lebih banyak data transaksi.'
      };
    }

    // Get current user session for authentication
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      return {
        success: false,
        error: 'Sesi tidak valid. Silakan login ulang.'
      };
    }

    console.log('Calling ai_generate_plan edge function...');

    // Call AI strategy generation via Edge Function
    const { data: response, error: functionError } = await supabase.functions
      .invoke('ai_generate_plan', {
        body: { context },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

    if (functionError) {
      console.error('Edge function error:', functionError);
      return {
        success: false,
        error: `AI service error: ${functionError.message}`,
        context
      };
    }

    if (!response.success) {
      console.error('AI generation failed:', response.error);
      return {
        success: false,
        error: response.error || 'AI analysis failed',
        context
      };
    }

    console.log('Strategy plan generated successfully');

    // Validate the response structure
    const plan = response.json as StrategyPlan;
    
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

    // Validate quick wins structure
    for (const qw of plan.quickWins) {
      if (!qw.title || !qw.impact || !qw.effort || !qw.action) {
        console.error('Invalid quick win structure:', qw);
        return {
          success: false,
          error: 'Invalid quick wins data structure',
          context
        };
      }
    }

    // Validate initiatives structure
    for (const initiative of plan.initiatives) {
      if (!initiative.title || !initiative.description || !initiative.owner || 
          !initiative.startMonth || !initiative.kpi || !initiative.target) {
        console.error('Invalid initiative structure:', initiative);
        return {
          success: false,
          error: 'Invalid initiatives data structure',
          context
        };
      }
      
      // Validate startMonth format (YYYY-MM)
      if (!/^\d{4}-\d{2}$/.test(initiative.startMonth)) {
        console.error('Invalid startMonth format:', initiative.startMonth);
        return {
          success: false,
          error: `Invalid month format: ${initiative.startMonth}. Expected YYYY-MM`,
          context
        };
      }
    }

    return {
      success: true,
      plan,
      savedSummaryId: response.savedSummaryId,
      context
    };

  } catch (error) {
    console.error('Strategy analysis error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Get previously saved strategy plans for the current user
 */
export async function getSavedStrategyPlans(limit: number = 10) {
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