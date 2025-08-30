import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Brain, 
  Target, 
  Zap, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Lightbulb,
  Flag,
  Users,
  Calendar,
  BarChart3,
  Loader2
} from 'lucide-react';
import { runStrategyAnalysis, formatStrategyDisplay, StrategyPlan } from '@/lib/ai/runStrategy.supabase';
import { useToast } from '@/hooks/use-toast';

interface StrategyPanelProps {
  monthsBack?: number;
}

const StrategyPanel: React.FC<StrategyPanelProps> = ({ monthsBack = 12 }) => {
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<StrategyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMonths, setContextMonths] = useState(0);
  const [metadata, setMetadata] = useState<any>(null);
  const { toast } = useToast();

  const handleGenerateStrategy = async () => {
    try {
      setGenerating(true);
      setError(null);
      
      console.log('Generating strategy plan...');
      const result = await runStrategyAnalysis(monthsBack);
      
      if (result.success && result.plan) {
        setPlan(result.plan);
        setContextMonths(result.context?.months.length || 0);
        setMetadata(result.meta || null);
        
        toast({
          title: 'Strategy Generated',
          description: 'Rencana strategis berhasil dibuat!',
        });
      } else {
        const errorMsg = result.error || 'Failed to generate strategy';
        setError(errorMsg);
        
        toast({
          title: 'Generation Failed',
          description: errorMsg,
          variant: 'destructive',
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Strategy generation error:', err);
      setError(errorMessage);
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const resetStrategy = () => {
    setPlan(null);
    setError(null);
    setContextMonths(0);
    setMetadata(null);
  };

  const isDisabled = generating;
  const showGenerateButton = !plan && !error;
  const formattedPlan = plan ? formatStrategyDisplay(plan) : null;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Strategy Generator
          </CardTitle>
          <CardDescription>
            Analisis strategis otomatis berdasarkan data finansial UMKM Anda
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {showGenerateButton && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>Generator ini akan menganalisis data transaksi Anda dan memberikan:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Diagnosis kondisi bisnis saat ini</li>
                  <li>Quick wins yang dapat diimplementasikan segera</li>
                  <li>Inisiatif strategis jangka menengah</li>
                  <li>Identifikasi risiko dan asumsi</li>
                </ul>
                <p className="mt-2 text-xs">
                  <strong>Catatan:</strong> Minimal 2 bulan data transaksi diperlukan untuk analisis.
                </p>
              </div>
              
              <Button
                onClick={handleGenerateStrategy}
                disabled={isDisabled}
                className="w-full"
                size="lg"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Strategy...
                  </>
                ) : (
                  <>
                    <Target className="mr-2 h-4 w-4" />
                    Generate Strategic Plan
                  </>
                )}
              </Button>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p><strong>Error:</strong> {error}</p>
                  <Button onClick={resetStrategy} variant="outline" size="sm">
                    Try Again
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {plan && formattedPlan && (
            <div className="space-y-4">
              {/* Summary */}
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p><strong>Analisis berhasil dibuat!</strong></p>
                    <p>UMKM Level: <Badge variant="secondary">{plan.umkmLevel}</Badge></p>
                    <p>Data periode: {contextMonths} bulan</p>
                    <p>Generated: {new Date().toLocaleString('id-ID')}</p>
                    
                    {/* Debug metadata - dev only */}
                    {metadata && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">
                            {metadata.provider || 'unknown'}/{metadata.model || 'unknown'}/{metadata.source || 'unknown'}/
                            {metadata.monthsUsed || 0}m/{metadata.ctxHash?.slice(0, 8) || 'no-hash'}
                          </span>
                          {metadata.source === 'local-fallback' && (
                            <Badge variant="destructive" className="ml-2 text-xs">
                              FALLBACK
                            </Badge>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>

              <Button onClick={resetStrategy} variant="outline" size="sm">
                Generate New Strategy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strategy Plan Display */}
      {formattedPlan && (
        <Tabs defaultValue="diagnosis" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
            <TabsTrigger value="quickwins">Quick Wins</TabsTrigger>
            <TabsTrigger value="initiatives">Initiatives</TabsTrigger>
            <TabsTrigger value="risks">Risk & Gaps</TabsTrigger>
          </TabsList>

          {/* Business Diagnosis */}
          <TabsContent value="diagnosis">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Business Diagnosis
                </CardTitle>
                <CardDescription>
                  Analisis kondisi bisnis berdasarkan data finansial
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {plan.diagnosis.map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-muted">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                        {index + 1}
                      </div>
                      <p className="text-sm">{item}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quick Wins */}
          <TabsContent value="quickwins">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Quick Wins
                </CardTitle>
                <CardDescription>
                  Tindakan cepat yang dapat diimplementasikan segera
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {formattedPlan.quickWins.map((qw, index) => (
                    <Card key={index} className="border-l-4 border-l-primary">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base">{qw.title}</CardTitle>
                          <Badge 
                            variant={qw.priority === 'high' ? 'default' : 
                                    qw.priority === 'medium' ? 'secondary' : 'outline'}
                          >
                            {qw.priority === 'high' ? 'High Priority' :
                             qw.priority === 'medium' ? 'Medium' : 'Low'}
                          </Badge>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            Impact: {qw.impact} {qw.impactIcon}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Effort: {qw.effort} {qw.effortIcon}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm">{qw.action}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Strategic Initiatives */}
          <TabsContent value="initiatives">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flag className="h-5 w-5" />
                  Strategic Initiatives
                </CardTitle>
                <CardDescription>
                  Inisiatif strategis jangka menengah untuk pertumbuhan bisnis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {formattedPlan.initiatives.map((init, index) => (
                    <Card key={index} className="border">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base">{init.title}</CardTitle>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {init.formattedMonth}
                          </div>
                        </div>
                        <CardDescription>{init.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="flex items-center gap-1 font-medium text-muted-foreground">
                              <Users className="h-3 w-3" />
                              Owner
                            </div>
                            <p>{init.owner}</p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 font-medium text-muted-foreground">
                              <BarChart3 className="h-3 w-3" />
                              KPI
                            </div>
                            <p>{init.kpi}</p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 font-medium text-muted-foreground">
                              <Target className="h-3 w-3" />
                              Target
                            </div>
                            <p>{init.target}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Risks and Assumptions */}
          <TabsContent value="risks">
            <div className="grid gap-6">
              {/* Risks */}
              {plan.risks && plan.risks.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Potential Risks
                    </CardTitle>
                    <CardDescription>
                      Risiko yang perlu diperhatikan dalam implementasi
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {plan.risks.map((risk, index) => (
                        <div key={index} className="flex items-start gap-2 p-2 rounded bg-destructive/10">
                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                          <p className="text-sm">{risk}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Assumptions */}
              {plan.assumptions && plan.assumptions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5" />
                      Key Assumptions
                    </CardTitle>
                    <CardDescription>
                      Asumsi yang digunakan dalam analisis ini
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {plan.assumptions.map((assumption, index) => (
                        <div key={index} className="flex items-start gap-2 p-2 rounded bg-muted">
                          <Lightbulb className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <p className="text-sm">{assumption}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Data Gaps */}
              {plan.dataGaps && plan.dataGaps.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Data Gaps
                    </CardTitle>
                    <CardDescription>
                      Data yang perlu dilengkapi untuk analisis lebih akurat
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {plan.dataGaps.map((gap, index) => (
                        <div key={index} className="flex items-start gap-2 p-2 rounded bg-muted">
                          <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <p className="text-sm">{gap}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default StrategyPanel;