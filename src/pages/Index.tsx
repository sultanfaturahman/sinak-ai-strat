import ImportCsvSupabase from '@/components/ImportCsvSupabase';
import StrategyPanel from '@/components/StrategyPanel';
import AuthWrapper from '@/components/AuthWrapper';

const Index = () => {
  return (
    <AuthWrapper>
      <div className="container mx-auto py-8 space-y-8">
        <header className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Sinak - UMKM Management System</h1>
          <p className="text-xl text-muted-foreground">
            Sistem manajemen keuangan dan strategi bisnis untuk UMKM Indonesia
          </p>
        </header>

        <div className="grid gap-8 max-w-6xl mx-auto">
          <ImportCsvSupabase onImportComplete={() => window.location.reload()} />
          <StrategyPanel monthsBack={12} />
        </div>
      </div>
    </AuthWrapper>
  );
};

export default Index;
