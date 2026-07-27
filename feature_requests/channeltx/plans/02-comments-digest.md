# Feature 2: Comments Digest Email

**Priority:** P2 · **Complexity:** Low-Med · **Effort:** M (3–7 days) · **Dependencies:** None

## Request

Daily email with all comments made that day, so teams are aware of updates. Previously had this at ENDOFA (daily email with all comments). Asked how Riviera does it.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Comments Service | `modules/comments/comments.service.ts` (135L) | Entity comments on orders, places, companies, vessels with timestamps + user info |
| Comments Table | `entityComments` table | `entityType`, `entityId`, `userId`, `userName`, `content`, `followUpDate`, `createdAt` |
| Activity Service | `modules/activity/activity.service.ts` (491L) | `activityLogs` table — tracks all CRUD operations with metadata |
| Scheduled Reports | `runDueReportSchedules` / `startReportsScheduleJob` | Hourly cron — proven pattern for time-based email delivery |
| Mail Service | `modules/documents/mail.service.ts` (773L) | Sends emails via Microsoft Graph or SMTP. Has email template rendering. |

## Gap

No existing "comments digest" email. The scheduled report system only sends margin/summary/exception reports. No mechanism to query comments by date range and email them.

## Implementation

### Backend
1. Add a `buildCommentsDigest()` function that:
   - Queries `entityComments` created in the last 24 hours for the tenant
   - Optionally queries `activityLogs` for status changes and updates (if `includeActivityLog` is enabled)
   - Groups by entity type (order, vessel, place, company)
   - Formats as HTML email with links to each entity
2. Add a "Comments Digest" schedule type to the existing `runDueReportSchedules` cron:
   - Check `schedule.hourUtc` against current UTC hour
   - Send via `mail.service.ts` (Graph or SMTP)
3. Add API endpoints for:
   - Configuring the digest schedule (hours, recipients, options)
   - Previewing the digest (show what would be sent)

### Frontend
1. Add "Comments Digest" settings panel in admin settings (under notifications or a new "Daily Emails" section)
2. Configure: send time, recipient roles, extra emails, include activity log toggle
3. Preview button to see the last 24h of comments

### Schema Changes
**None** — `entityComments` and `activityLogs` already have all needed fields.

### TenantSettings Flag

```typescript
commentsDigest?: {
  enabled: boolean;
  hourUtc: number;               // when to send daily digest
  recipientRoles: string[];      // e.g., ['ADMIN', 'OPERATIONSMANAGER']
  extraEmails?: string[];
  includeActivityLog?: boolean;  // also include status changes, updates
  entityTypes?: string[];        // e.g., ['order', 'vessel'] — null = all
};
```

## Questions for ChannelTX

- Should the email include only comments, or also status changes and updates (full activity rundown)?
- Should it cover all orders or be filterable by team?
- What time should it go out each morning?
- Who should receive it — all team members or specific roles?