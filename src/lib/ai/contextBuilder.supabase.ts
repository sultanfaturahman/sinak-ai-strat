import { supabase } from '@/integrations/supabase/client';

// Types for our database schema
export type MonthlyMetric = {
  user_id: string;
  month_start: string;
  sales_rp: number;
  cogs_rp: number;
  opex_rp: number;
  gross_profit_rp: number;
  net_profit_rp: number;
  gross_margin: number;
  net_margin: number;
  mom_sales_pct: number;
  top_expenses: Array<{category: string; amount_rp: number}>;
  updated_at: string;
};

export type Profile = {
  user_id: string;
  display_name?: string;
  city?: string;
  umkm_level?: 'mikro' | 'kecil' | 'menengah' | 'besar';
  last12m_turnover_rp: number;
  last_recomputed_at: string;
  created_at: string;
  updated_at: string;
};

export interface StrategyContext {
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
}

/**
 * Build strategy context from Supabase data for AI analysis
 */
export async function buildStrategyContextSupabase(monthsBack: number = 12): Promise<StrategyContext> {
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('User not authenticated');
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
    }

    // First, get all available months to determine the actual data range
    const { data: allMetrics, error: allMetricsError } = await supabase
      .from('monthly_metrics')
      .select('month_start')
      .eq('user_id', user.id)
      .order('month_start', { ascending: false });

    if (allMetricsError) {
      throw new Error(`Failed to fetch monthly metrics: ${allMetricsError.message}`);
    }

    if (!allMetrics || allMetrics.length === 0) {
      throw new Error('No monthly metrics found. Please import transaction data first.');
    }

    // Use the smaller of: requested months or available months
    const actualMonthsToFetch = Math.min(monthsBack, allMetrics.length);
    
    console.log(`Fetching ${actualMonthsToFetch} months of data (available: ${allMetrics.length}, requested: ${monthsBack})`);

    // Fetch the actual monthly metrics with the corrected limit
    const { data: monthlyMetrics, error: metricsError } = await supabase
      .from('monthly_metrics')
      .select('*')
      .eq('user_id', user.id)
      .order('month_start', { ascending: false })
      .limit(actualMonthsToFetch);

    if (metricsError) {
      throw new Error(`Failed to fetch monthly metrics: ${metricsError.message}`);
    }

    // Reverse to get chronological order (oldest to newest)
    const sortedMetrics = monthlyMetrics.reverse();

    const months = sortedMetrics.map((metric: MonthlyMetric) => ({
      monthStart: metric.month_start,
      salesRp: metric.sales_rp,
      cogsRp: metric.cogs_rp,
      opexRp: metric.opex_rp,
      grossProfitRp: metric.gross_profit_rp,
      netProfitRp: metric.net_profit_rp,
      grossMargin: metric.gross_margin,
      netMargin: metric.net_margin,
      momSalesPct: metric.mom_sales_pct,
      topExpenses: metric.top_expenses || []
    }));

    const startMonth = sortedMetrics[0].month_start;
    const endMonth = sortedMetrics[sortedMetrics.length - 1].month_start;

    // Generate seasonality hints based on sales patterns
    const seasonalityHints = generateSeasonalityHints(months);

    // Generate business notes based on data analysis
    const notes = generateBusinessNotes(months, profile);

    const context: StrategyContext = {
      company: {
        displayName: profile?.display_name || 'UMKM',
        city: profile?.city || 'Indonesia',
        umkmLevel: profile?.umkm_level || 'mikro'
      },
      window: {
        monthsCount: months.length,
        startMonth,
        endMonth
      },
      months,
      last12mTurnoverRp: profile?.last12m_turnover_rp || 0,
      seasonalityHints,
      notes
    };

    return context;

  } catch (error) {
    console.error('Error building strategy context:', error);
    throw error;
  }
}

/**
 * Generate seasonality insights from sales data
 */
function generateSeasonalityHints(months: StrategyContext['months']): string[] {
  const hints: string[] = [];
  
  if (months.length < 3) {
    hints.push('Data terbatas untuk analisis seasonality');
    return hints;
  }

  // Analyze growth trends
  const recentGrowth = months.slice(-3).map(m => m.momSalesPct);
  const avgRecentGrowth = recentGrowth.reduce((sum, g) => sum + g, 0) / recentGrowth.length;

  if (avgRecentGrowth > 10) {
    hints.push('Tren pertumbuhan positif dalam 3 bulan terakhir');
  } else if (avgRecentGrowth < -10) {
    hints.push('Tren penurunan dalam 3 bulan terakhir');
  } else {
    hints.push('Pertumbuhan relatif stabil');
  }

  // Analyze seasonal patterns by month
  const monthlyAvgs: { [key: string]: number[] } = {};
  months.forEach(month => {
    const monthNum = new Date(month.monthStart + '-01').getMonth();
    const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 
                      'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][monthNum];
    
    if (!monthlyAvgs[monthName]) {
      monthlyAvgs[monthName] = [];
    }
    monthlyAvgs[monthName].push(month.salesRp);
  });

  // Find peak months
  const monthAvgs = Object.entries(monthlyAvgs)
    .map(([month, sales]) => ({
      month,
      avgSales: sales.reduce((sum, s) => sum + s, 0) / sales.length,
      count: sales.length
    }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.avgSales - a.avgSales);

  if (monthAvgs.length >= 2) {
    hints.push(`Penjualan tertinggi: ${monthAvgs[0].month}, terendah: ${monthAvgs[monthAvgs.length - 1].month}`);
  }

  // Analyze margin trends
  const margins = months.map(m => m.grossMargin);
  const avgMargin = margins.reduce((sum, m) => sum + m, 0) / margins.length;
  
  if (avgMargin > 30) {
    hints.push('Margin kotor cukup sehat (>30%)');
  } else if (avgMargin > 15) {
    hints.push('Margin kotor moderat (15-30%)');
  } else {
    hints.push('Margin kotor perlu diperbaiki (<15%)');
  }

  return hints;
}

/**
 * Generate business insight notes
 */
function generateBusinessNotes(months: StrategyContext['months'], profile: Profile | null): string[] {
  const notes: string[] = [];
  
  if (months.length === 0) return notes;

  const latestMonth = months[months.length - 1];
  const avgSales = months.reduce((sum, m) => sum + m.salesRp, 0) / months.length;

  // Revenue analysis
  if (latestMonth.salesRp > avgSales * 1.2) {
    notes.push('Penjualan bulan terakhir di atas rata-rata');
  } else if (latestMonth.salesRp < avgSales * 0.8) {
    notes.push('Penjualan bulan terakhir di bawah rata-rata');
  }

  // Profitability analysis
  const profitableMonths = months.filter(m => m.netProfitRp > 0).length;
  const profitabilityRate = profitableMonths / months.length;

  if (profitabilityRate >= 0.8) {
    notes.push('Konsisten menguntungkan');
  } else if (profitabilityRate >= 0.5) {
    notes.push('Profitabilitas tidak konsisten');
  } else {
    notes.push('Sering mengalami kerugian');
  }

  // Expense analysis
  const avgOpexRatio = months.reduce((sum, m) => {
    return sum + (m.salesRp > 0 ? m.opexRp / m.salesRp : 0);
  }, 0) / months.length;

  if (avgOpexRatio > 0.5) {
    notes.push('Biaya operasional tinggi (>50% dari penjualan)');
  } else if (avgOpexRatio > 0.3) {
    notes.push('Biaya operasional moderat (30-50%)');
  } else {
    notes.push('Biaya operasional terkendali (<30%)');
  }

  // Growth analysis
  if (months.length >= 6) {
    const firstHalf = months.slice(0, Math.floor(months.length / 2));
    const secondHalf = months.slice(Math.floor(months.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, m) => sum + m.salesRp, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, m) => sum + m.salesRp, 0) / secondHalf.length;
    
    const growthRate = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (growthRate > 20) {
      notes.push('Pertumbuhan signifikan periode ini');
    } else if (growthRate < -20) {
      notes.push('Penurunan signifikan periode ini');
    }
  }

  // UMKM level context
  if (profile?.umkm_level) {
    switch (profile.umkm_level) {
      case 'mikro':
        notes.push('Fokus efisiensi dan struktur dasar bisnis');
        break;
      case 'kecil':
        notes.push('Siap untuk ekspansi dan diversifikasi');
        break;
      case 'menengah':
        notes.push('Optimalisasi operasional dan market expansion');
        break;
      case 'besar':
        notes.push('Fokus inovasi dan competitive advantage');
        break;
    }
  }

  return notes;
}