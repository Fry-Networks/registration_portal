# Announcements Admin Plan

This document captures the contract that the dashboard expects and what the upcoming admin tooling needs to deliver. Use it as the implementation guide when wiring the admin panel.

## Collections & Schema

### `main.announcements`
Each announcement is stored as a document with the following structure:

```json
{
  "_id": ObjectId,
  "title": "String (required)",
  "body": "Markdown or plain text (required)",
  "variant": "info" | "warning" | "error" | "success" | "critical",       // optional, defaults to "info"
  "priority": Number,                       // higher values float to the top in both banner + tray
  "status": "draft" | "scheduled" | "published" | "archived",
  "publish_at": ISODate | null,             // optional, defaults to immediate publication
  "expires_at": ISODate | null,             // optional auto-expiry; omit for persistent announcements
  "cta": {
    "label": "String",                    // optional; dashboard falls back to "Learn more"
    "href": "String"                       // optional; must be a valid HTTPS URL
  },
  "audience": "all",                       // reserved for future targeted announcements
  "created_at": ISODate,
  "updated_at": ISODate,
  "created_by": ObjectId | String,          // admin account identifier from the admin panel
  "updated_by": ObjectId | String
}
```

> **Notes**
> - `variant: "critical"` is accepted but rendered as the dashboard "error" styling.
> - The dashboard polls `/api/announcements/active` every 5 minutes, so scheduled and expiry boundaries can rely on `publish_at`/`expires_at` without additional cron work.

### `main.registration-users`
Banner dismissals are tracked per wallet. The dashboard writes to this array via the `/api/announcements/dismiss` endpoint.

```json
{
  "announcement_dismissals": [
    {
      "id": "<announcementId>",
      "dismissedAt": ISODate
    }
  ]
}
```

The admin panel does not need to edit this field directly; it is useful when troubleshooting whether a user has acknowledged a notice.

## Backend APIs (already available)

The dashboard now exposes read/acknowledge endpoints. Build the admin UI against these contracts:

| Method | Route | Purpose |
| ------ | ----- | ------- |
| `GET`  | `/api/announcements/active` | Returns the list of published announcements the user should see, plus the banner dismissals already recorded for the authenticated wallet. |
| `POST` | `/api/announcements/dismiss` | Records that the authenticated wallet dismissed a banner (called automatically by the dashboard UI). |

Admin tooling still needs create/update/publish endpoints. Suggested pattern (to implement in the admin service):

- `GET /announcements` — paginated list with filters for status, publish window and text search.
- `POST /announcements` — create a draft.
- `PUT /announcements/:id` — update mutable fields when the announcement is in `draft` or `scheduled`.
- `POST /announcements/:id/publish` — publish immediately or queue for `publish_at`.
- `POST /announcements/:id/archive` — archive early and optionally force-remove banner visibility.

Keep auditing metadata (`created_by`, `updated_by`) in sync with the admin identity provider.

## Admin Panel UX Checklist

1. **Draft creation**
   - Title and body (markdown editor with preview is ideal).
   - Variant selection with preview of banner + tray styling.
   - Priority slider (0–100 suggested) with helper copy describing how higher numbers float above other announcements.
   - Optional CTA URL + label validation (must start with `https://`).

2. **Scheduling**
   - Toggle for “Publish immediately” vs. “Schedule for later”.
   - Optional expiry date/time (UTC). Warn when expiry precedes publish time.

3. **Review & publish flow**
   - Display rendered preview of banner + notification tray entry.
   - Require confirmation modal summarizing publish window, variant, priority and CTA link.
   - Surface who last edited the announcement and when.

4. **Post-publish management**
   - Ability to force archive (sets `status = 'archived'` and `expires_at = now`).
   - Allow edits to `body`, `cta`, and `expires_at` while published — copy should warn that changes propagate to users within ~5 minutes.
   - Display acknowledgement statistics (count of entries in `announcement_dismissals` for the ID) if the analytics pipeline exposes them.

5. **Safety rails**
   - Validate body length (e.g., 2–2000 characters) and reject script tags.
   - Require admins to confirm when variant is `error/critical` or when priority exceeds a high-water mark.
   - Log all mutations for audit trails.

## Dashboard Contract Recap

- Users see the highest-priority banner(s) immediately below the navbar. Dismissing a banner records the acknowledgement but keeps the item inside the bell tray until the user explicitly dismisses it there.
- The tray merges device warnings and announcements. Announcements show an "Announcement" chip, published timestamp, and CTA link if provided.
- The dashboard polls every 5 minutes; there is also a manual refresh via the bell icon toggle.
- Creating or updating announcements in MongoDB (or via the admin API) is enough — no redeploy required.

Keep this document with the admin repo so both projects share the same contract.
