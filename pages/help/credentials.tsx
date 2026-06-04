import Head from 'next/head';
import Link from 'next/link';
import PageShell from '../../components/PageShell';
import { useTheme } from 'next-themes';
import {
  ChevronLeftIcon,
  SearchIcon,
  ClipboardCopyIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  MinusIcon
} from '@heroicons/react/outline';
import { useState, useMemo, useCallback } from 'react';

interface GuideSection {
  id: string;
  title: string;
  fields: string;
  steps: string[];
}

const SECTIONS: GuideSection[] = [
  {
    id: 'awair',
    title: 'Awair (Element, Omni)',
    fields: 'token, deviceId',
    steps: [
      'Go to the Awair Developer Portal at developer.getawair.com',
      'Sign in and generate an API Token (OAuth bearer token)',
      "Find your device's Device ID in the Awair app under device settings",
      'Enter both in your Fry dashboard device settings',
    ],
  },
  {
    id: 'sensecap',
    title: 'SenseCAP (S2101, S2102, S2103)',
    fields: 'username, password, device_eui',
    steps: [
      'Log in to the SenseCAP Portal at sensecap.seeed.cc',
      'Go to API Access or Account Settings',
      'Copy your Username (API ID) and Password (API key)',
      "Find your sensor's Device EUI in the device list (format: 2CF7F1XXXXXXXXXX)",
      'Enter all three in your Fry dashboard device settings',
    ],
  },
  {
    id: 'atmotube',
    title: 'Atmotube',
    fields: 'token, deviceId',
    steps: [
      'Open the Atmotube app or website',
      'Find your API Token in account or developer settings',
      "Find your device's Device ID (MAC address format)",
      'Enter both in your Fry dashboard device settings',
    ],
  },
  {
    id: 'purpleair',
    title: 'PurpleAir',
    fields: 'sensorId, readKey',
    steps: [
      'Go to the PurpleAir Map at map.purpleair.com',
      'Click your sensor and note the Sensor Index number from the URL',
      'If your sensor is private, find your Read Key in the PurpleAir dashboard',
      'Enter both in your Fry dashboard device settings',
    ],
  },
  {
    id: 'pebble',
    title: 'Pebble Tracker (IoTeX)',
    fields: 'imei',
    steps: [
      'Find the IMEI number on the back of your Pebble Tracker device',
      'The IMEI is a 15-digit number',
      'Enter it in your Fry dashboard device settings',
    ],
  },
  {
    id: 'ambient',
    title: 'Ambient Weather (WS-2902, WS-5000)',
    fields: 'api_key, device_mac',
    steps: [
      'Log in to ambientweather.net',
      'Go to Account then API Keys',
      'If no key exists, click Create API Key',
      'Copy the API Key (long hex string)',
      "Find your station's MAC Address in device settings (format: XX:XX:XX:XX:XX:XX)",
      'Enter both in your Fry dashboard device settings',
    ],
  },
  {
    id: 'ecowitt',
    title: 'Ecowitt (GW1000, GW2000, HP2551)',
    fields: 'app_key (auto-filled), api_key, device_mac',
    steps: [
      'Log in to ecowitt.net',
      'Go to Member Center then My API Key',
      'Copy your API Key',
      "Find your gateway's MAC Address in the Ecowitt app or device settings",
      'Enter both in your Fry dashboard device settings',
      'Note: The global app_key is handled by Fry Networks automatically',
    ],
  },
  {
    id: 'tempest',
    title: 'Tempest Weather Station',
    fields: 'station, token',
    steps: [
      'Log in to tempestwx.com or the Tempest app',
      'Find your Station ID in station settings',
      'Generate a Personal Use Token in your account settings',
      'Enter both in your Fry dashboard device settings',
    ],
  },
  {
    id: 'weatherxm',
    title: 'WeatherXM',
    fields: 'username, password',
    steps: [
      'Use your existing WeatherXM account email and password',
      'Ensure your station is active and sending data on the WeatherXM platform',
      'Enter your WeatherXM email and password in your Fry dashboard device settings',
    ],
  },
  {
    id: 'lacrosse',
    title: 'La Crosse (C83, C84, View app)',
    fields: 'email, password',
    steps: [
      'Create a La Crosse View account at lacrossetechnology.com or in the La Crosse View app',
      'Ensure your station is connected and sending data via the La Crosse View app',
      'Enter your La Crosse View email and password in your Fry dashboard device settings',
    ],
  },
  {
    id: 'switchbot',
    title: 'SwitchBot (Plug Mini, Meter, Hub)',
    fields: 'token, secret, deviceId',
    steps: [
      'Open the SwitchBot app',
      'Go to Profile then Preferences then Developer Options',
      'Enable developer mode and copy your Token and Secret',
      "Find your device's Device ID in the SwitchBot app device settings",
      'Enter all three in your Fry dashboard device settings',
    ],
  },
  {
    id: 'shelly',
    title: 'Shelly (Plug S, EM, 3EM)',
    fields: 'auth_key, serverUrl, deviceId',
    steps: [
      'Log in to the Shelly Cloud at control.shelly.cloud',
      'Go to User Settings then Cloud Key / Auth Key',
      'Copy your Auth Key and Server URI',
      "Find your device's Device ID in the Shelly app",
      'Enter all three in your Fry dashboard device settings',
    ],
  },
  {
    id: 'camera',
    title: 'Camera (RTSP-compatible)',
    fields: 'rtsp_url',
    steps: [
      "Find your camera's RTSP stream URL (typically rtsp://ip:port/stream)",
      'Common patterns: Hikvision uses /Streaming/Channels/101, Dahua uses /cam/realmonitor',
      'Include username and password in the URL if required',
      "Use the camera's public IP (not private LAN IP) and ensure the port is forwarded",
      'Enter the full RTSP URL in your Fry dashboard device settings',
    ],
  },
  {
    id: 'gmcmap',
    title: 'GMCMap (Radiation Monitor)',
    fields: 'gmcmap_id',
    steps: [
      'Go to gmcmap.com and find your Geiger counter on the map',
      'Note the Geiger Counter ID number from the URL or device page',
      'Enter the numeric ID in your Fry dashboard device settings',
    ],
  },
];

export default function CredentialsHelpPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    SECTIONS.forEach((s) => {
      init[s.id] = false;
    });
    return init;
  });
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.fields.toLowerCase().includes(q) ||
        s.steps.some((step) => step.toLowerCase().includes(q))
    );
  }, [search]);

  const expandAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    filtered.forEach((s) => {
      next[s.id] = true;
    });
    setExpanded((prev) => ({ ...prev, ...next }));
  }, [filtered]);

  const collapseAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    filtered.forEach((s) => {
      next[s.id] = false;
    });
    setExpanded((prev) => ({ ...prev, ...next }));
  }, [filtered]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const copyField = useCallback(
    (field: string) => {
      navigator.clipboard.writeText(field).then(() => {
        setCopied(field);
        setTimeout(() => setCopied(null), 1500);
      });
    },
    []
  );

  return (
    <>
      <Head>
        <title>Device Credential Setup | Fry Networks</title>
      </Head>
      <PageShell title="Device Credential Setup" breadcrumb={true}>
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Full-width search */}
          <div className="w-full max-w-2xl mx-auto mb-space-6">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-secondary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for your device type..."
                className="bg-surface-strong border border-divider rounded-token-lg px-4 py-3 pl-10 pr-10 w-full text-sm text-ink placeholder-ink-secondary outline-none focus:ring-2 focus:ring-primary-500/40 transition"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-secondary hover:text-primary-500 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Mobile jump-to-section dropdown */}
          <div className="mb-6 lg:hidden">
            <select
              className="bg-surface-strong border border-divider rounded-token-lg px-4 py-3 w-full text-sm text-ink outline-none focus:ring-2 focus:ring-primary-500/40 transition"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  setExpanded((prev) => ({ ...prev, [id]: true }));
                  window.location.hash = `#${id}`;
                }
              }}
            >
              <option value="" disabled>Jump to section...</option>
              {filtered.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </select>
          </div>

          {/* Results count */}
          <div className="mb-4 text-sm text-ink-secondary font-body">
            Showing {filtered.length} of {SECTIONS.length} device types
          </div>

          {/* Desktop + Mobile unified layout */}
          <div className="flex flex-col lg:flex-row gap-space-6">
            {/* Sticky sidebar */}
            <aside className="hidden lg:block w-[240px] sticky top-space-6 self-start">
              <nav className="flex flex-col">
                {filtered.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      toggle(section.id);
                      window.location.hash = `#${section.id}`;
                    }}
                    className={`text-sm transition border-l-2 ${
                      expanded[section.id]
                        ? 'text-primary-500 font-semibold border-primary-500 pl-3 py-2'
                        : 'text-ink-secondary hover:text-ink border-transparent pl-4 py-2'
                    }`}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            {/* Main content */}
            <div className="flex-1 space-y-space-4">
              {filtered.length === 0 && (
                <div className="bg-surface-elevated border border-divider rounded-token-lg p-6 text-center">
                  <p className="text-sm text-ink-secondary font-body">
                    No device types match your search.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-2 text-sm font-semibold text-primary-500 hover:text-primary-400 transition"
                  >
                    Clear search
                  </button>
                </div>
              )}

              {filtered.map((section) => (
                <div
                  key={section.id}
                  id={section.id}
                  className="bg-surface-elevated border border-divider rounded-token-md overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(section.id)}
                    className="flex justify-between items-center min-h-[44px] px-4 py-3 w-full text-left cursor-pointer transition hover:opacity-90"
                  >
                    <h2 className="text-base font-semibold text-ink font-display">
                      {section.title}
                    </h2>
                    <span className="ml-3 shrink-0 text-ink-secondary">
                      {expanded[section.id] ? (
                        <ChevronUpIcon className="h-5 w-5" />
                      ) : (
                        <ChevronDownIcon className="h-5 w-5" />
                      )}
                    </span>
                  </button>

                  {expanded[section.id] && (
                    <div className="px-4 pb-4 space-y-space-4">
                      {/* Credential fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-4">
                        {section.fields.split(', ').map((field) => {
                          const raw = field.replace(/\s*\(.*\)\s*/, '').trim();
                          return (
                            <div key={field} className="flex flex-col gap-1">
                              <span className="text-xs text-ink-secondary font-body uppercase tracking-wide">
                                {field}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyField(raw)}
                                className="bg-surface-strong border border-divider rounded-token-sm px-2 py-1 text-xs text-ink font-mono hover:bg-primary-500/20 transition inline-flex items-center gap-1.5 self-start"
                                title={`Copy ${raw}`}
                              >
                                {raw}
                                {copied === raw ? (
                                  <CheckIcon className="h-3 w-3 text-success-500" />
                                ) : (
                                  <ClipboardCopyIcon className="h-3 w-3 text-ink-secondary" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Steps */}
                      <div className="bg-surface-strong border border-divider rounded-token-md p-3 overflow-x-auto">
                        <ol className="list-decimal list-inside space-y-2 text-sm text-ink-secondary font-body leading-relaxed">
                          {section.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Back to top */}
              <div className="flex justify-end pt-space-4">
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="text-sm text-ink-secondary hover:text-primary-500 transition font-body"
                >
                  Back to top &uarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      </PageShell>
    </>
  );
}
