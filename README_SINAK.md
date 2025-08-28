# Sinak - UMKM Management System

Complete UMKM (Small & Medium Enterprise) financial management and strategic planning system with AI integration.

## 🚀 Quick Setup

### 1. Deploy Database Schema
Run this SQL in your Supabase SQL Editor:
```sql
-- Copy content from supabase/sql/sinak_supabase_init.sql
```

### 2. Deploy Edge Functions
```bash
supabase functions deploy ingest_csv
supabase functions deploy ai_generate_plan
```

### 3. Set Secrets
```bash
supabase secrets set SUPABASE_URL=your_url
supabase secrets set SUPABASE_ANON_KEY=your_anon_key  
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_key
supabase secrets set GEMINI_API_KEY=your_gemini_key
supabase secrets set GEMINI_MODEL_ID=gemini-2.5-flash
```

## 📊 Features

- **CSV Import**: Automatic transaction import with deduplication
- **Auto-Calculations**: Monthly metrics, UMKM classification, profit analysis
- **AI Strategy**: Gemini-powered business analysis and strategic planning
- **RLS Security**: User-scoped data access with Row Level Security

## 🔧 Usage

1. **Import Data**: Upload CSV with columns: date,type,category,amountRp,notes
2. **Auto Processing**: Triggers calculate monthly_metrics and UMKM level
3. **Generate Strategy**: AI analyzes financial data and creates actionable plans
4. **View Results**: Structured JSON output with diagnosis, quick wins, initiatives

## 📋 CSV Format Example
```csv
date,type,category,amountRp,notes
2024-01-15,income,Penjualan,1500000,Penjualan produk A
2024-01-16,expense,Marketing,200000,Iklan Facebook
2024-01-17,cogs,Bahan Baku,300000,Pembelian material
```

## 🛡️ Security Features
- JWT authentication required
- User-scoped RLS policies 
- Service role for admin operations
- No API keys exposed to frontend