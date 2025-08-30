-- Add context_hash column to ai_summaries table for better caching
ALTER TABLE public.ai_summaries 
ADD COLUMN IF NOT EXISTS context_hash TEXT;

-- Add index for faster lookups by context hash
CREATE INDEX IF NOT EXISTS idx_ai_summaries_context_hash 
ON public.ai_summaries (user_id, type, context_hash);