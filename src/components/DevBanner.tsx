import React from 'react';
import { getSupabase } from '@/lib/supabaseClient';

interface DevBannerProps {
  monthsUsed?: number;
  ctxHash?: string;
  source?: string;
}

const DevBanner: React.FC<DevBannerProps> = ({ monthsUsed, ctxHash, source }) => {
  const supabase = getSupabase();
  
  // Get current user info
  const [userId, setUserId] = React.useState<string>('');
  
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id?.slice(0, 8) || 'unknown');
    });
  }, [supabase]);

  if (import.meta.env.PROD) return null;

  const projectId = "kdfaaqzwzyhfcgjeeyvq";
  
  return (
    <div className="bg-muted/50 border-b border-border px-4 py-1">
      <p className="text-xs text-muted-foreground font-mono">
        <span className="font-semibold">DEV:</span>{" "}
        {import.meta.env.MODE} | {projectId} | {userId} | 
        {monthsUsed !== undefined && ` ${monthsUsed}m`} | 
        {ctxHash && ` ${ctxHash.slice(0, 8)}`} | 
        {source && ` ${source}`}
      </p>
    </div>
  );
};

export default DevBanner;