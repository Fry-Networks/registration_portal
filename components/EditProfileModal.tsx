import { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { XIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export default function EditProfileModal({ open, onClose }: EditProfileModalProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const [displayName, setDisplayName] = useState('');
  const [discordHandle, setDiscordHandle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [prefs, setPrefs] = useState({ rewards: true, events: true, system: true });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch('/api/profile')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        setDisplayName(data.display_name || '');
        setDiscordHandle(data.discord_handle || '');
        setAvatarUrl(data.avatar_url || '');
        setPrefs(data.notification_prefs || { rewards: true, events: true, system: true });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          discord_handle: discordHandle,
          avatar_url: avatarUrl,
          notification_prefs: prefs,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save profile');
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const modalStyles = {
    content: {
      top: '50%',
      left: '50%',
      right: 'auto',
      bottom: 'auto',
      transform: 'translate(-50%, -50%)',
      backgroundColor: isDark ? '#0d0d10' : '#ffffff',
      borderRadius: '24px',
      border: isDark ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(239, 68, 68, 0.2)',
      padding: '1.75rem',
      maxWidth: '28rem',
      width: '92vw',
      maxHeight: '85vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      color: isDark ? '#f5f5f5' : '#0f172a',
      boxShadow: isDark ? '0 20px 40px rgba(0, 0, 0, 0.45)' : '0 12px 30px rgba(15, 23, 42, 0.15)'
    },
    overlay: {
      backgroundColor: isDark ? 'rgba(5, 5, 8, 0.78)' : 'rgba(15, 23, 42, 0.35)',
      backdropFilter: 'blur(4px)',
      zIndex: 200
    }
  } as const;

  return (
    <Modal
      isOpen={open}
      onRequestClose={onClose}
      style={modalStyles}
      contentLabel="Edit Profile"
      shouldCloseOnOverlayClick={!saving}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>Edit Profile</h2>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Update your display name, Discord handle, and preferences.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit profile modal"
            className={`rounded-full border border-transparent p-1 ${isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'} hover:border-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
            disabled={saving}
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2">
            <div className="flex flex-col gap-4 pb-4">
              {error && (
                <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${isDark ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-300 bg-red-50 text-red-800'}`}>
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
                  className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm shadow-inner outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 ${isDark ? 'border-red-500/30 bg-black/40 text-white' : 'border-red-200 bg-white text-slate-900'}`}
                  placeholder="Your display name"
                />
              </div>

              <div>
                <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>Discord Handle</label>
                <input
                  type="text"
                  value={discordHandle}
                  onChange={(e) => setDiscordHandle(e.target.value.slice(0, 50))}
                  className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm shadow-inner outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 ${isDark ? 'border-red-500/30 bg-black/40 text-white' : 'border-red-200 bg-white text-slate-900'}`}
                  placeholder="username#0000"
                />
              </div>

              <div>
                <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>Avatar URL</label>
                <input
                  type="text"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value.slice(0, 500))}
                  className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm shadow-inner outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 ${isDark ? 'border-red-500/30 bg-black/40 text-white' : 'border-red-200 bg-white text-slate-900'}`}
                  placeholder="https://..."
                />
                {avatarUrl.startsWith('https://') && (
                  <img src={avatarUrl} alt="Avatar preview" className="mt-2 h-16 w-16 rounded-full object-cover border border-divider" />
                )}
              </div>

              <div>
                <label className={`text-sm font-medium mb-2 block ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>Notification Preferences</label>
                <div className="flex flex-col gap-2">
                  {[
                    { key: 'rewards', label: 'Rewards' },
                    { key: 'events', label: 'Events' },
                    { key: 'system', label: 'System' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prefs[key as keyof typeof prefs]}
                        onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={`flex-shrink-0 mt-3 flex flex-col gap-3 border-t pt-3 ${isDark ? 'border-red-500/20 bg-[#0d0d10]' : 'border-red-200 bg-white'}`}>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className={`rounded-lg border border-transparent px-4 py-2 text-sm font-medium ${isDark ? 'text-gray-300 hover:text-white hover:border-red-400' : 'text-slate-700 hover:text-slate-900 hover:border-red-400'}`}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg border border-red-500 bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:border-red-500/40 disabled:bg-red-500/40"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
