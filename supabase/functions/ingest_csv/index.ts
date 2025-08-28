import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CsvRow {
  date: string;
  type: string;
  category: string;
  amountRp: string;
  notes?: string;
}

interface ImportRequest {
  bucket: string;
  path: string;
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

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Client for user operations (with user JWT)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Client for admin operations (with service role)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user authentication
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing CSV import for user:', user.id);

    // Parse request body
    const { bucket, path }: ImportRequest = await req.json();
    
    if (!bucket || !path) {
      throw new Error('Missing bucket or path in request body');
    }

    const filename = path.split('/').pop() || 'unknown.csv';

    // Create import run record
    const { data: importRun, error: runError } = await supabaseUser
      .from('import_runs')
      .insert({
        user_id: user.id,
        filename,
        status: 'running',
        total_rows: 0,
        total_imported: 0
      })
      .select()
      .single();

    if (runError) {
      console.error('Failed to create import run:', runError);
      throw new Error('Failed to create import run');
    }

    console.log('Created import run:', importRun.id);

    try {
      // Download CSV file from storage using admin client
      const { data: fileData, error: downloadError } = await supabaseAdmin
        .storage
        .from(bucket)
        .download(path);

      if (downloadError) {
        console.error('Failed to download file:', downloadError);
        throw new Error(`Failed to download file: ${downloadError.message}`);
      }

      // Convert blob to text
      const csvText = await fileData.text();
      console.log('Downloaded CSV, size:', csvText.length);

      // Parse CSV
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('CSV file must have at least a header and one data row');
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      console.log('CSV headers:', headers);

      // Validate required headers
      const requiredHeaders = ['date', 'type', 'category', 'amountrp'];
      for (const required of requiredHeaders) {
        if (!headers.includes(required)) {
          throw new Error(`Missing required column: ${required}`);
        }
      }

      const dataRows = lines.slice(1);
      const totalRows = dataRows.length;

      console.log('Processing', totalRows, 'rows');

      // Update total rows
      await supabaseUser
        .from('import_runs')
        .update({ total_rows: totalRows })
        .eq('id', importRun.id);

      const transactions = [];
      
      for (const line of dataRows) {
        const values = line.split(',').map(v => v.trim());
        const row: any = {};
        
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        // Parse and validate data
        const dateStr = row.date;
        const typeStr = row.type?.toLowerCase();
        const category = row.category;
        const amountRpStr = row.amountrp;
        const notes = row.notes || '';

        // Validate date
        const dateTs = new Date(dateStr);
        if (isNaN(dateTs.getTime())) {
          console.warn('Invalid date:', dateStr, 'skipping row');
          continue;
        }

        // Validate transaction type
        const validTypes = ['income', 'cogs', 'expense'];
        if (!validTypes.includes(typeStr)) {
          console.warn('Invalid type:', typeStr, 'skipping row');
          continue;
        }

        // Parse amount (remove non-digits, convert to integer)
        const amountRp = parseInt(amountRpStr.replace(/[^\d]/g, ''), 10);
        if (isNaN(amountRp) || amountRp < 0) {
          console.warn('Invalid amount:', amountRpStr, 'skipping row');
          continue;
        }

        if (!category || category.trim() === '') {
          console.warn('Empty category, skipping row');
          continue;
        }

        transactions.push({
          user_id: user.id,
          date_ts: dateTs.toISOString(),
          kind: typeStr as 'income' | 'cogs' | 'expense',
          category: category.trim(),
          amount_rp: amountRp,
          notes: notes.trim() || null
        });
      }

      console.log('Parsed', transactions.length, 'valid transactions');

      if (transactions.length === 0) {
        throw new Error('No valid transactions found in CSV');
      }

      // Insert transactions in chunks to avoid timeout
      const chunkSize = 500;
      let totalImported = 0;

      for (let i = 0; i < transactions.length; i += chunkSize) {
        const chunk = transactions.slice(i, i + chunkSize);
        
        console.log(`Importing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(transactions.length/chunkSize)}`);
        
        const { data, error } = await supabaseUser
          .from('transactions')
          .upsert(chunk, {
            onConflict: 'user_id,uniq_hash',
            ignoreDuplicates: false
          });

        if (error) {
          console.error('Failed to insert chunk:', error);
          throw new Error(`Database insert failed: ${error.message}`);
        }

        totalImported += chunk.length;
        
        // Update progress
        await supabaseUser
          .from('import_runs')
          .update({ total_imported: totalImported })
          .eq('id', importRun.id);
      }

      console.log('Successfully imported', totalImported, 'transactions');

      // Mark import as completed
      await supabaseUser
        .from('import_runs')
        .update({ 
          status: 'succeeded',
          total_imported: totalImported,
          finished_at: new Date().toISOString()
        })
        .eq('id', importRun.id);

      return new Response(JSON.stringify({
        success: true,
        importRunId: importRun.id,
        totalRows,
        totalImported,
        message: `Successfully imported ${totalImported} transactions`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (processingError) {
      console.error('Processing error:', processingError);
      
      // Mark import as failed
      await supabaseUser
        .from('import_runs')
        .update({ 
          status: 'failed',
          error: processingError.message,
          finished_at: new Date().toISOString()
        })
        .eq('id', importRun.id);

      throw processingError;
    }

  } catch (error) {
    console.error('Error in ingest_csv function:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});