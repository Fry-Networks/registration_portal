import { useEffect, useState, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';

interface DiscordLinkSectionProps {
  walletAddress: string;
}

export default function DiscordLinkSection({ walletAddress }: DiscordLinkSectionProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);
  const popupRef = useRef<Window | null>(null);

  // Fetch current link status
  const fetchLinkStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/user/profile');
      if (response.ok) {
        const data = await response.json();
        setDiscordUsername(data.discordUsername || null);
        setIsLinked(!!data.discordUsername);
      }
    } catch (error) {
      console.error('[DiscordLinkSection] Failed to fetch status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLinkStatus();
  }, [fetchLinkStatus]);

  // Listen for OAuth result
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://dashboard.frynetworks.com') return;
      
      const { type, status, reason } = event.data || {};
      if (type !== 'discord-oauth-result') return;

      setIsLinking(false);
      
      if (popupRef.current) {
        try { popupRef.current.close(); } catch {}
        popupRef.current = null;
      }

      if (status === 'linked') {
        fetchLinkStatus();
      } else if (status === 'error') {
        let message = 'Failed to link Discord';
        if (reason === 'already_linked') {
          message = 'This Discord account is already linked to another wallet';
        } else if (reason === 'invalid_state') {
          message = 'Link expired. Please try again.';
        }
        alert(message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchLinkStatus]);

  const handleLink = async () => {
    setIsLinking(true);

    // Open popup synchronously to preserve user gesture
    const popup = window.open('about:blank', 'discord-link', 'width=500,height=700');
    popupRef.current = popup;

    try {
      const response = await fetch('/api/discord/link');
      if (!response.ok) {
        throw new Error('Failed to get OAuth URL');
      }
      const { url } = await response.json();
      
      if (popup && !popup.closed) {
        popup.location.href = url;
      }
    } catch (error) {
      console.error('[DiscordLinkSection] Link error:', error);
      if (popup) popup.close();
      popupRef.current = null;
      setIsLinking(false);
      alert('Failed to start Discord linking. Please try again.');
    }
  };

  const handleUnlink = async () => {
    if (!confirm('Are you sure you want to unlink your Discord account?')) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/discord/unlink', { method: 'POST' });
      if (response.ok) {
        setDiscordUsername(null);
        setIsLinked(false);
      } else {
        alert('Failed to unlink Discord');
      }
    } catch (error) {
      console.error('[DiscordLinkSection] Unlink error:', error);
      alert('Failed to unlink Discord');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
        <DiscordIcon className="h-5 w-5" />
        <span>Loading...</span>
      </div>
    );
  }

  if (isLinked) {
    return (
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
          isDark 
            ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40' 
            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
        }`}>
          <DiscordIcon className="h-4 w-4" />
          <span className="font-medium">{discordUsername}</span>
        </div>
        <button
          onClick={handleUnlink}
          disabled={isLoading}
          className={`text-xs px-2 py-1 rounded ${
            isDark 
              ? 'text-gray-400 hover:text-red-300 hover:bg-red-500/10' 
              : 'text-slate-500 hover:text-red-600 hover:bg-red-50'
          }`}
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLink}
      disabled={isLinking}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        isDark
          ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/30'
          : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
      } disabled:opacity-50`}
    >
      <DiscordIcon className="h-4 w-4" />
      <span>{isLinking ? 'Linking...' : 'Link Discord'}</span>
    </button>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}
