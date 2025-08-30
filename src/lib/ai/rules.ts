import { StrategyContext } from './contextBuilder.supabase';

interface RuleBasedInitiative {
  title: string;
  description: string;
  owner: string;
  startMonth: string;
  kpi: string;
  target: string;
  notes?: string;
}

interface RuleBasedQuickWin {
  title: string;
  impact: "rendah" | "sedang" | "tinggi";
  effort: "rendah" | "sedang" | "tinggi";
  action: string;
  notes?: string;
}

/**
 * Generate rule-based initiatives and quick wins based on data patterns
 */
export function proposeFromRules(ctx: StrategyContext): {
  initiatives: RuleBasedInitiative[];
  quickWins: RuleBasedQuickWin[];
} {
  const initiatives: RuleBasedInitiative[] = [];
  const quickWins: RuleBasedQuickWin[] = [];
  
  if (ctx.months.length === 0) return { initiatives, quickWins };
  
  const lastMonth = ctx.months[ctx.months.length - 1];
  const nextMonth = getNextMonth(lastMonth.monthStart);
  const features = ctx.features;
  
  // Rule 1: High OPEX ratio (>30%) with decent GM (>20%)
  if (features.opexShare > 0.3 && features.gmAvg > 0.2) {
    initiatives.push({
      title: "Program Kontrol OPEX Terstruktur",
      description: "Audit mendalam biaya operasional dan renegosiasi kontrak supplier",
      owner: "Manajer Keuangan",
      startMonth: nextMonth,
      kpi: "Rasio OPEX/Sales",
      target: `Turun dari ${(features.opexShare * 100).toFixed(1)}% ke ${((features.opexShare - 0.05) * 100).toFixed(1)}% dalam 3 bulan`,
      notes: `OPEX share saat ini ${(features.opexShare * 100).toFixed(1)}% dari sales`
    });
    
    quickWins.push({
      title: "Review Biaya Tertinggi",
      impact: "tinggi",
      effort: "rendah",
      action: "Audit 3 kategori expense terbesar dan negosiasi ulang kontrak",
      notes: `Top expenses: ${features.topExpensesLast.slice(0, 3).map(e => e.category).join(', ')}`
    });
  }
  
  // Rule 2: Negative net margin trend
  if (features.nmTrend < -5) {
    initiatives.push({
      title: "Program Pemulihan Profitabilitas",
      description: "Fokus pada peningkatan efisiensi operasional dan pricing strategy",
      owner: "Tim Operasional",
      startMonth: nextMonth,
      kpi: "Net Margin",
      target: `Naik dari ${features.nmAvg.toFixed(1)}% ke ${(features.nmAvg + 5).toFixed(1)}% dalam 4 bulan`,
      notes: `Net margin trend turun ${Math.abs(features.nmTrend).toFixed(1)} p.p`
    });
  }
  
  // Rule 3: High volatility (>20%)
  if (features.volatilityIdx > 20) {
    initiatives.push({
      title: "Stabilisasi Penjualan",
      description: "Diversifikasi produk dan customer base untuk mengurangi volatilitas",
      owner: "Tim Marketing",
      startMonth: nextMonth,
      kpi: "Volatilitas MoM Sales",
      target: `Turun dari ${features.volatilityIdx.toFixed(1)}% ke <15% dalam 6 bulan`,
      notes: `Volatilitas penjualan saat ini ${features.volatilityIdx.toFixed(1)}%`
    });
    
    quickWins.push({
      title: "Analisis Pola Penjualan",
      impact: "sedang",
      effort: "rendah",
      action: "Identifikasi faktor penyebab fluktuasi dan buat contingency plan",
      notes: `Peak month: ${features.peakMonth}, Low month: ${features.lowMonth}`
    });
  }
  
  // Rule 4: Seasonal patterns
  if (features.peakMonth && features.lowMonth && features.peakMonth !== features.lowMonth) {
    initiatives.push({
      title: `Optimalisasi Musiman ${features.lowMonth}`,
      description: "Program khusus untuk meningkatkan penjualan di bulan-bulan lemah",
      owner: "Tim Marketing",
      startMonth: features.lowMonth,
      kpi: `Penjualan bulan ${features.lowMonth}`,
      target: "Naik minimal 20% vs periode yang sama tahun sebelumnya",
      notes: `${features.lowMonth} adalah bulan terlemah, ${features.peakMonth} adalah peak`
    });
    
    quickWins.push({
      title: "Promo Seasonal Targeting",
      impact: "sedang",
      effort: "sedang",
      action: `Siapkan kampanye khusus untuk ${features.lowMonth} dengan bundling produk`,
      notes: `Leverage pola seasonal: peak di ${features.peakMonth}, low di ${features.lowMonth}`
    });
  }
  
  // Rule 5: Recent negative growth
  const recentMomSales = features.momSales.slice(-3).filter(m => m !== null) as number[];
  const avgRecentGrowth = recentMomSales.length > 0 
    ? recentMomSales.reduce((sum, g) => sum + g, 0) / recentMomSales.length 
    : 0;
    
  if (avgRecentGrowth < -5) {
    quickWins.push({
      title: "Recovery Plan Immediate",
      impact: "tinggi",
      effort: "sedang",
      action: "Fokus pada customer retention dan reaktivasi dormant customers",
      notes: `Rata-rata pertumbuhan 3 bulan terakhir: ${avgRecentGrowth.toFixed(1)}%`
    });
  }
  
  return { initiatives, quickWins };
}

function getNextMonth(monthStart: string): string {
  const date = new Date(monthStart + '-01');
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 7); // YYYY-MM format
}