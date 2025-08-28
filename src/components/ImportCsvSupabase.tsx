import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { supabase, ImportRun } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';

interface ImportCsvSupabaseProps {
  onImportComplete?: (result: ImportRun) => void;
}

const ImportCsvSupabase: React.FC<ImportCsvSupabaseProps> = ({ onImportComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setResult(null);
    }
  };

  const handleUploadAndImport = async () => {
    if (!file) {
      setError('Please select a CSV file');
      return;
    }

    try {
      setUploading(true);
      setImporting(false);
      setProgress(10);
      setError(null);

      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Please log in to import CSV files');
      }

      const fileName = `${Date.now()}_${file.name}`;
      const filePath = `${user.id}/${fileName}`;

      setProgress(30);

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('imports')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      toast({
        title: 'File uploaded',
        description: 'Starting CSV processing...',
      });

      setProgress(50);
      setUploading(false);
      setImporting(true);

      // Get JWT token for the edge function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No valid session found');
      }

      setProgress(70);

      // Call ingest_csv edge function
      const { data: importResult, error: importError } = await supabase.functions
        .invoke('ingest_csv', {
          body: {
            bucket: 'imports',
            path: filePath
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

      if (importError) {
        console.error('Import error:', importError);
        throw new Error(`Import failed: ${importError.message}`);
      }

      if (!importResult.success) {
        throw new Error(importResult.error || 'Import failed');
      }

      setProgress(100);

      // Fetch the complete import run details
      const { data: importRun, error: fetchError } = await supabase
        .from('import_runs')
        .select('*')
        .eq('id', importResult.importRunId)
        .single();

      if (fetchError) {
        console.warn('Could not fetch import run details:', fetchError);
      }

      const finalResult = importRun || {
        id: importResult.importRunId,
        filename: fileName,
        status: 'succeeded' as const,
        total_rows: importResult.totalRows,
        total_imported: importResult.totalImported,
        created_at: new Date().toISOString(),
        finished_at: new Date().toISOString()
      };

      setResult(finalResult);
      onImportComplete?.(finalResult);

      toast({
        title: 'Import completed',
        description: `Successfully imported ${importResult.totalImported} transactions`,
      });

      // Clean up uploaded file after successful import
      await supabase.storage
        .from('imports')
        .remove([filePath]);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Import process error:', err);
      setError(errorMessage);
      
      toast({
        title: 'Import failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setImporting(false);
      setProgress(0);
    }
  };

  const resetImport = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(0);
  };

  const isProcessing = uploading || importing;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Transaksi CSV
        </CardTitle>
        <CardDescription>
          Upload file CSV dengan kolom: date, type, category, amountRp, notes (opsional)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result && (
          <>
            <div className="space-y-2">
              <label htmlFor="csv-file" className="text-sm font-medium">
                Pilih File CSV
              </label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                disabled={isProcessing}
                className="cursor-pointer"
              />
            </div>

            {file && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded">
                <FileText className="h-4 w-4" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({Math.round(file.size / 1024)} KB)
                </span>
              </div>
            )}

            <Button
              onClick={handleUploadAndImport}
              disabled={!file || isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                uploading ? 'Uploading...' : 'Processing...'
              ) : (
                'Upload dan Import'
              )}
            </Button>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} className="w-full" />
                <p className="text-sm text-muted-foreground text-center">
                  {uploading ? 'Mengupload file...' : 'Memproses transaksi...'}
                </p>
              </div>
            )}
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p><strong>Import berhasil!</strong></p>
                <p>File: {result.filename}</p>
                <p>Total baris: {result.total_rows}</p>
                <p>Berhasil diimport: {result.total_imported}</p>
                <p>Status: {result.status}</p>
                {result.finished_at && (
                  <p>Selesai: {new Date(result.finished_at).toLocaleString('id-ID')}</p>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <Button onClick={resetImport} variant="outline" className="w-full">
            Import File Lain
          </Button>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Format CSV yang diharapkan:</strong></p>
          <p>date,type,category,amountRp,notes</p>
          <p>2024-01-15,income,Penjualan,1500000,Penjualan produk A</p>
          <p>2024-01-16,expense,Marketing,200000,Iklan Facebook</p>
          
          <p className="pt-2"><strong>Catatan:</strong></p>
          <ul className="list-disc list-inside space-y-1">
            <li>type: income, cogs, expense</li>
            <li>amountRp: angka dalam rupiah (tanpa titik/koma)</li>
            <li>date: format YYYY-MM-DD</li>
            <li>Duplikasi akan diabaikan berdasarkan hash unik</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default ImportCsvSupabase;