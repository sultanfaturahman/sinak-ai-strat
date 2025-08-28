-- Create storage bucket for CSV imports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  10485760, -- 10MB limit
  ARRAY['text/csv', 'application/csv', 'text/plain']
);

-- Create storage policies for the imports bucket
CREATE POLICY "Users can upload their own CSV files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'imports' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own CSV files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'imports' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own CSV files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'imports' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Service role can access all import files"
ON storage.objects FOR ALL
USING (bucket_id = 'imports')
WITH CHECK (bucket_id = 'imports');