import React, { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";

interface ImportCsvSupabaseProps {
  onImportComplete?: () => void;
}

export default function ImportCsvSupabase({ onImportComplete }: ImportCsvSupabaseProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setMessage("Pilih file CSV yang valid");
        setStatus("error");
        return;
      }
      setFile(selectedFile);
      setStatus("idle");
      setMessage("");
    }
  };

  const handleUploadAndImport = async () => {
    if (!file) return;

    try {
      setStatus("uploading");
      setProgress(10);
      setMessage("Memverifikasi autentikasi...");

      // Get authenticated user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error("Harus login terlebih dahulu");
      }

      setProgress(20);
      setMessage("Mengunggah file ke storage...");

      // Upload file to Supabase Storage
      const bucket = "imports";
      const timestamp = Date.now();
      const path = `${user.id}/${timestamp}_${file.name}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false });

      if (uploadError) {
        throw new Error(`Upload gagal: ${uploadError.message}`);
      }

      setProgress(50);
      setStatus("processing");
      setMessage("Memproses data CSV...");

      // Call ingest_csv edge function
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("Token autentikasi tidak ditemukan");
      }

      const { data: processData, error: processError } = await supabase.functions.invoke("ingest_csv", {
        body: { bucket, path },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (processError) {
        console.error("Processing error:", processError);
        throw new Error(`Pemrosesan gagal: ${processError.message || "Edge Function error"}`);
      }

      setProgress(90);
      setMessage("Membersihkan file sementara...");

      // Clean up uploaded file
      await supabase.storage.from(bucket).remove([path]);

      setProgress(100);
      setStatus("success");
      setMessage(`Berhasil mengimpor ${processData.imported} transaksi`);

      // Call completion callback
      if (onImportComplete) {
        onImportComplete();
      }

    } catch (error: any) {
      console.error("Import process error:", error);
      setStatus("error");
      setMessage(error.message || "Terjadi kesalahan tidak terduga");
      setProgress(0);
    }
  };

  const resetImport = () => {
    setFile(null);
    setStatus("idle");
    setMessage("");
    setProgress(0);
  };

  const getStatusIcon = () => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Upload className="h-5 w-5" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "uploading":
      case "processing":
        return "text-blue-600";
      default:
        return "text-gray-600";
    }
  };

  const renderContent = () => {
    if (status === "uploading" || status === "processing") {
      return (
        <div className="space-y-4">
          <Progress value={progress} className="w-full" />
          <p className={`text-sm ${getStatusColor()}`}>{message}</p>
        </div>
      );
    }

    if (status === "success") {
      return (
        <div className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              {message}
            </AlertDescription>
          </Alert>
          <Button onClick={resetImport} variant="outline" className="w-full">
            Import File Lain
          </Button>
        </div>
      );
    }

    // status === "idle" or "error"
    return (
      <>
        <div>
          <label htmlFor="csv-file" className="block text-sm font-medium mb-2">
            Pilih File CSV
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {file && (
          <div className="bg-gray-50 p-3 rounded-md">
            <p className="text-sm"><strong>File:</strong> {file.name}</p>
            <p className="text-sm"><strong>Ukuran:</strong> {(file.size / 1024).toFixed(1)} KB</p>
          </div>
        )}

        <Button 
          onClick={handleUploadAndImport}
          disabled={!file}
          className="w-full"
        >
          Upload & Proses
        </Button>

        {status === "error" && (
          <Button onClick={resetImport} variant="outline" className="w-full">
            Pilih File Lain
          </Button>
        )}
      </>
    );
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {getStatusIcon()}
          Import Data CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderContent()}

        {status === "error" && message && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {message}
            </AlertDescription>
          </Alert>
        )}

        <div className="text-xs text-gray-500 space-y-1">
          <p><strong>Format CSV yang diharapkan:</strong></p>
          <p>Header: date,type,category,amountRp,notes</p>
          <p>Contoh: 2024-01-15,income,Penjualan,1500000,Penjualan produk A</p>
          <p>Type: income, cogs, expense</p>
        </div>
      </CardContent>
    </Card>
  );
}