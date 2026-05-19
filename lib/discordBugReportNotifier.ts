/**
 * Discord Bug Report Notifier
 * 
 * Sends bug report notifications to Discord channel 1489391160571985991
 * via the DISCORD_DASHBOARD_BUG_WEBHOOK_URL webhook.
 */

export interface BugReportDoc {
  _id?: any;
  walletAddress: string;
  discordUsername?: string | null;
  title: string;
  category: string;
  description: string;
  screenshot?: string | null;
  consoleLog: string;
  harFile: string;
  createdAt: Date;
  status: string;
}

const BASE_URL = 'https://dashboard.frynetworks.com';

export async function sendBugReportNotification(report: BugReportDoc): Promise<void> {
  const webhookUrl = process.env.DISCORD_DASHBOARD_BUG_WEBHOOK_URL?.trim();
  
  if (!webhookUrl) {
    console.warn('[discordBugReportNotifier] DISCORD_DASHBOARD_BUG_WEBHOOK_URL not configured, skipping notification');
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    
    // Build attachment links
    const attachments: string[] = [];
    if (report.consoleLog) {
      attachments.push(`[Console Log](${BASE_URL}${report.consoleLog})`);
    }
    if (report.harFile) {
      attachments.push(`[HAR File](${BASE_URL}${report.harFile})`);
    }
    if (report.screenshot) {
      attachments.push(`[Screenshot](${BASE_URL}${report.screenshot})`);
    }

    const embed = {
      title: `Bug Report: ${report.title}`,
      color: 0xe74c3c, // Red - matches fry.farm theme
      fields: [
        {
          name: 'Chain',
          value: 'Algorand',
          inline: true
        },
        {
          name: 'Category',
          value: report.category,
          inline: true
        },
        {
          name: 'Wallet Address',
          value: `\`${report.walletAddress}\``,
          inline: false
        },
        {
          name: 'Discord',
          value: report.discordUsername || 'Not linked',
          inline: true
        },
        {
          name: 'Description',
          value: report.description.length > 1024 
            ? report.description.slice(0, 1021) + '...'
            : report.description,
          inline: false
        }
      ],
      footer: {
        text: 'dashboard.frynetworks.com'
      },
      timestamp
    };

    // Add attachments field if any
    if (attachments.length > 0) {
      embed.fields.push({
        name: 'Attachments',
        value: attachments.join(' | '),
        inline: false
      });
    }

    const payload = {
      username: 'Fry Dashboard Bug Reporter',
      embeds: [embed],
      allowed_mentions: { parse: [] as string[] }
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[discordBugReportNotifier] Webhook failed (${response.status}): ${text}`);
    }
  } catch (error) {
    // Catch and log errors silently - never throw
    console.error('[discordBugReportNotifier] Failed to send notification:', error);
  }
}
