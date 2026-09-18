# Deployment Evidence — Email Sender Fix

**Date**: 2026-08-27
**Version**: 1.0.0-email-sender-fix-v2
**Git commits**: 8a84c8d2, fb45a991

## SSH Output: All 4 VPS build-info.json + running process

### staging (31.70.79.3)
```
{"version":"1.0.0-email-sender-fix-v2","buildTime":"2026-08-27T17:50:00Z"}
blue
1634002 /opt/fueld/blue/app-release
```

### channeltx (74.208.245.215)
```
{"version":"1.0.0-email-sender-fix-v2","buildTime":"2026-08-27T17:50:00Z"}
blue
73071 /opt/fueld/blue/app-release
```

### moxie (31.70.94.96)
```
{"version":"1.0.0-email-sender-fix-v2","buildTime":"2026-08-27T17:50:00Z"}
blue
1234401 /opt/fueld/blue/app-release
```

### riviera-marine (139.162.157.31)
```
{"version":"1.0.0-email-sender-fix-v2","buildTime":"2026-08-27T17:50:00Z"}
blue
3620727 /opt/fueld/blue/app-release
```

## Email Log Verification (riviera-marine DB)

```sql
SELECT el.sent_from_email, u.name as sent_by, el.subject, el.channel
FROM email_log el LEFT JOIN users u ON u.id = el.sent_by_user_id
WHERE u.email = 'mirko@rivieramarine.mc' ORDER BY el.created_at DESC LIMIT 3;
```

Result:
```
    sent_from_email     |    sent_by    |                               subject                               | channel
------------------------+---------------+---------------------------------------------------------------------+---------
 mirko@rivieramarine.mc | Mirko Antichi | Bunker Nomination — 20260827-000481 — EM Hydra, Genova              | GRAPH
 mirko@rivieramarine.mc | Mirko Antichi | Bunker Confirmation — 20260827-000481 — EM Hydra, Genova            | GRAPH
 mirko@rivieramarine.mc | Mirko Antichi | Revised Bunker Confirmation — 20260728-000377 — Lila Mumbai, Jeddah | GRAPH
```

## Test Results

```
22 pass
0 fail
```

Including 2 regression tests:
- regression: uses current user token when shared sender db query fails
- regression: uses current user token when Graph is available (default per-user mode)
