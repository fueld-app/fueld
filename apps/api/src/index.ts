import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ApiResponse } from '@fueld/types';
import { authController } from './modules/auth';
import { documentsController } from './modules/documents/documents.controller';
import { supplierQuoteController } from './modules/documents/supplier-quote.controller';
import { startInquiryReminderJob } from './modules/documents/supplier-inquiry.service';
import { verifyController } from './modules/documents/verify.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { lloydsController } from './modules/lloyds';
import { companiesController } from './modules/companies/companies.controller';
import { vesselsController } from './modules/vessels/vessels.controller';
import { creditController } from './modules/credit/credit.controller';
import { creditApplicationsController } from './modules/credit/credit-applications.controller';
import { adminController, inviteController } from './modules/admin/admin.controller';
import { backupController } from './modules/admin/backup.controller';
import { settingsController } from './modules/admin/settings.controller';
import { securityController } from './modules/admin/security.controller';
import { llmController } from './modules/admin/llm.controller';
import { activityController, adminActivityController } from './modules/activity/activity.controller';
import { ordersController } from './modules/orders/orders.controller';
import { commentsController } from './modules/comments/comments.controller';
import { logFromRequest, startPruneJob } from './modules/activity/activity.service';
import {
  addSession,
  removeSession,
  updatePresence,
  subscribeAdmin,
  unsubscribeAdmin,
  logCopyEvent,
  logPrintEvent,
  logScreenshotEvent,
  subscribeSocketTopic,
  unsubscribeSocketTopic,
  onEntityView,
  sendToSocket,
  extractClientIp,
} from './modules/activity/session-tracker';
import { getNearbyVessels, getNearbyVesselPositions, syncPlaceFromSeasearcher } from './modules/lloyds/lli.service';
import { syncVesselFromSeasearcher } from './modules/vessels/vessel.service';
import { syncCompanyFromSeasearcher } from './modules/companies/company.service';
import { startPricePolling, getLatestPricePayload } from './modules/prices/price.service';
import { jwtAccessPlugin } from './modules/auth/jwt.setup';
import { db } from './db';
import { users } from './db/schema';
import { eq, sql } from 'drizzle-orm';
import { pushController } from './modules/push/push.controller';
import { whatsappController } from './modules/whatsapp/whatsapp.controller';
import { rfqController } from './modules/rfq/rfq.controller';
import { riskMonitoringController } from './modules/risk-monitoring/risk-monitoring.controller';
import { runScheduledChecks } from './modules/risk-monitoring/risk-monitoring.service';
import { vesselSanctionsController } from './modules/vessel-sanctions/vessel-sanctions.controller';
import { runScheduledVesselSanctionChecks } from './modules/vessel-sanctions/vessel-sanctions.service';
import { reconnectStoredSessions as reconnectWhatsAppSessions } from './modules/whatsapp/whatsapp.service';
import { plattsController } from './modules/platts/platts.controller';
import { resumePendingPlattsParseJobs } from './modules/platts/platts.service';
import { getBuildInfo } from './lib/build-info';
import { assertCredentialsEncryptionConfig } from './lib/crypto';
import { isRestoreModeActive } from './modules/admin/backup-state';

function resolveMigrationsDir(): string {
  const env = process.env['MIGRATIONS_DIR'];
  if (env) return env;

  const candidates = [
    // When running within the apps/api package directly
    join(import.meta.dir, '../drizzle'),
    // When running from monorepo root (bun --filter @fueld/api ...)
    join(process.cwd(), 'apps/api/drizzle'),
    // Legacy / fallback
    join(process.cwd(), 'drizzle'),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  // Let drizzle-orm throw a clear error if the path is invalid.
  return './drizzle';
}

const MIGRATIONS_DIR = resolveMigrationsDir();

async function runPendingMigrations() {
  // Ensure our tracking table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _applied_migrations (
      tag text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    )
  `);

  // Read journal to discover all migrations
  const journalPath = join(MIGRATIONS_DIR, 'meta/_journal.json');
  if (!existsSync(journalPath)) {
    console.warn('⚠️  No migration journal found at', journalPath);
    return;
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ tag: string }>;
  };

  // ── Bootstrap detection ──────────────────────────────────────────
  // If _applied_migrations is empty, check whether the database already
  // has tables (i.e. it was previously migrated by drizzle's built-in
  // migrate() which uses a separate tracking table).  In that case we
  // enter "bootstrap mode": every statement error is tolerated and each
  // migration is recorded, so that subsequent starts use the normal
  // strict path.
  const appliedCount = (await db.execute(sql`SELECT count(*)::int AS c FROM _applied_migrations`)) as Array<{ c: number }>;
  let bootstrapMode = false;
  if ((appliedCount[0]?.c ?? 0) === 0) {
    const tableCheck = (await db.execute(sql`
      SELECT count(*)::int AS c
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    `)) as Array<{ c: number }>;
    if ((tableCheck[0]?.c ?? 0) > 0) {
      bootstrapMode = true;
      console.log('  ↳ Detected existing database with empty migration tracker — entering bootstrap mode…');
    }
  }

  // Find which migrations have already been applied
  const applied = (await db.execute(sql`SELECT tag FROM _applied_migrations`)) as Array<{ tag: string }>;
  const appliedTags = new Set(applied.map((r) => r.tag));

  let newCount = 0;
  for (const entry of journal.entries) {
    if (appliedTags.has(entry.tag)) continue;

    const filePath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(filePath)) {
      throw new Error(`Migration file missing: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await db.execute(sql.raw(stmt));
      } catch (e: any) {
        // Detect "already exists" / duplicate-object errors robustly.
        const allText = [
          e?.message, e?.detail, e?.code,
          e?.cause?.message, e?.cause?.code,
          String(e),
        ].filter(Boolean).join(' ');

        const DUPLICATE_CODES = ['42710', '42P07', '42P06', '42701'];
        const isDuplicate =
          allText.includes('already exists') ||
          allText.includes('duplicate') ||
          DUPLICATE_CODES.some((c) => allText.includes(c));

        if (isDuplicate) {
          console.log(`  ↳ skipped (already exists): ${stmt.slice(0, 80)}…`);
        } else if (bootstrapMode) {
          // During bootstrap of an existing DB, tolerate ALL errors.
          // Old migrations can reference columns/types that later
          // migrations removed — that's expected.
          console.log(`  ↳ skipped (bootstrap): ${stmt.slice(0, 80)}…`);
        } else {
          console.error(`❌ Migration ${entry.tag} failed on statement:\n  ${stmt.slice(0, 120)}`);
          console.error('  Error details:', JSON.stringify({
            message: e?.message, code: e?.code, detail: e?.detail,
            severity: e?.severity, causeMsg: e?.cause?.message,
          }));
          throw e;
        }
      }
    }

    await db.execute(sql`INSERT INTO _applied_migrations (tag) VALUES (${entry.tag})`);
    newCount++;
    console.log(`  ✅ Applied migration: ${entry.tag}`);
  }

  if (newCount === 0) {
    console.log('ℹ️  Migrations already up to date');
  } else {
    console.log(`✅ ${newCount} migration(s) applied`);
  }
}

function registerAutoSyncHooks() {
  onEntityView(async (socketId, entityType, entityId) => {
    try {
      if (entityType === 'Vessel') {
        const synced = await syncVesselFromSeasearcher(entityId);
        if (synced) {
          sendToSocket(socketId, { type: 'vessel-synced', data: synced });
        }
      } else if (entityType === 'Company') {
        const result = await syncCompanyFromSeasearcher(entityId);
        if (result) {
          sendToSocket(socketId, { type: 'company-synced', data: result.company });
          if (result.conflicts.length > 0) {
            sendToSocket(socketId, { type: 'company-sync-conflicts', data: result.conflicts });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Auto-sync] ${entityType} ${entityId} failed:`, err.message);
    }
  });
}

export interface CreateAppOptions {
  runMigrations?: boolean;
  enableBackgroundJobs?: boolean;
}

function startRiskMonitoringJob() {
  // Run every hour; the service internally skips companies checked within checkIntervalHours
  const INTERVAL_MS = 60 * 60 * 1000;

  const run = async () => {
    try {
      await runScheduledChecks();
    } catch (err) {
      console.error('[Risk Monitor] Scheduled check failed:', err);
    }
  };

  // Initial run after a short delay to let the server warm up
  setTimeout(run, 30_000);
  setInterval(run, INTERVAL_MS);
  console.log('[Risk Monitor] Background job started (interval: 1h)');
}

function startVesselSanctionJob() {
  // Run every hour; the service internally skips tenants checked within checkIntervalHours
  const INTERVAL_MS = 60 * 60 * 1000;

  const run = async () => {
    try {
      await runScheduledVesselSanctionChecks();
    } catch (err) {
      console.error('[Vessel Sanctions] Scheduled check failed:', err);
    }
  };

  setTimeout(run, 45_000);
  setInterval(run, INTERVAL_MS);
  console.log('[Vessel Sanctions] Background job started (interval: 1h)');
}

export async function createApp(options: CreateAppOptions = {}) {
  assertCredentialsEncryptionConfig();

  if (options.runMigrations !== false) {
    await runPendingMigrations();
  }

  const buildInfo = getBuildInfo();

  const app = new Elysia()
    .use(
      swagger({
        documentation: {
          info: {
            title: 'Fueld API',
            version: buildInfo.appVersion,
            description: 'Bunker Trading SaaS — REST API',
          },
          tags: [
            { name: 'Health', description: 'Health-check endpoints' },
            { name: 'Auth', description: 'Authentication & 2FA' },
            { name: 'Orders', description: 'Bunker order management' },
            { name: 'Documents', description: 'Invoice PDF generation & email' },
            { name: 'Dashboard', description: 'Collections, pipeline & team stats' },
            { name: 'Lloyd\'s', description: 'Lloyd\'s List Intelligence vessel, port & company lookup' },
            { name: 'Push', description: 'Push notification subscriptions' },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              },
            },
          },
        },
      }),
    )
    .use(
      cors({
        origin: process.env['CORS_ORIGIN'] || /localhost/,
        exposeHeaders: [
          'Content-Disposition',
          'X-Document-Revision',
          'X-Document-Reference',
          'X-Document-Fingerprint',
          'X-Document-Verify-Token',
        ],
      }),
    )
    .onBeforeHandle({ as: 'global' }, ({ request, set }) => {
      const pathname = new URL(request.url).pathname;

      if (isRestoreModeActive() && pathname !== '/health' && pathname !== '/admin/backup/status') {
        set.status = 503;
        return {
          success: false,
          data: null,
          message: 'Backup restore in progress. Try again later.',
        } satisfies ApiResponse<null>;
      }
    })
    .get(
      '/health',
      (): ApiResponse<{
        status: string;
        uptime: number;
        appVersion: string;
        deployVersion: string;
        gitSha: string;
        buildTime: string;
        backupFormatVersion: number;
        restoreInProgress: boolean;
      }> => ({
        success: true,
        data: {
          status: 'ok',
          uptime: process.uptime(),
          appVersion: buildInfo.appVersion,
          deployVersion: buildInfo.deployVersion,
          gitSha: buildInfo.gitSha,
          buildTime: buildInfo.buildTime,
          backupFormatVersion: buildInfo.backupFormatVersion,
          restoreInProgress: isRestoreModeActive(),
        },
      }),
      {
        detail: { tags: ['Health'], summary: 'Health check' },
      },
    )
    .onAfterResponse({ as: 'global' }, ({ request, set, body }) => {
      const status = typeof set.status === 'number' ? set.status : 200;
      logFromRequest(request, status, body);
    })
    .use(authController)
    .use(documentsController)
    .use(supplierQuoteController)
    .use(verifyController)
    .use(dashboardController)
    .use(lloydsController)
    .use(companiesController)
    .use(vesselsController)
    .use(creditController)
    .use(creditApplicationsController)
    .use(adminController)
    .use(backupController)
    .use(settingsController)
    .use(inviteController)
    .use(activityController)
    .use(adminActivityController)
    .use(ordersController)
    .use(commentsController)
    .use(securityController)
    .use(llmController)
    .use(pushController)
    .use(whatsappController)
    .use(rfqController)
    .use(plattsController)
    .use(riskMonitoringController)
    .use(vesselSanctionsController)
    .get('/uploads/avatars/:filename', async ({ params, set }) => {
      const { join } = await import('path');
      const path = join(process.cwd(), 'uploads/avatars', params.filename);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        set.status = 404;
        return 'Not found';
      }
      set.headers['content-type'] = file.type;
      set.headers['cache-control'] = 'public, max-age=3600';
      return file;
    })
    .get('/uploads/logos/:filename', async ({ params, set }) => {
      const { join } = await import('path');
      const path = join(process.cwd(), 'uploads/logos', params.filename);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        set.status = 404;
        return 'Not found';
      }
      set.headers['content-type'] = file.type;
      set.headers['cache-control'] = 'public, max-age=3600';
      return file;
    })
    .get('/uploads/attachments/:filename', async ({ params, set }) => {
      const { join } = await import('path');
      const path = join(process.cwd(), 'uploads/attachments', params.filename);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        set.status = 404;
        return 'Not found';
      }
      set.headers['content-type'] = file.type;
      set.headers['cache-control'] = 'public, max-age=3600';
      return file;
    })
    .use(jwtAccessPlugin)
    .ws('/ws', {
      query: t.Object({
        token: t.String(),
      }),

      async open(ws) {
        const token = ws.data.query.token;

        try {
          const raw = await ws.data.jwtAccess.verify(token);
          if (!raw || !raw['sub'] || raw['pending2fa']) {
            console.log('[WS] Connection rejected: invalid token');
            ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid or expired token' }));
            ws.close();
            return;
          }

          const socketId = crypto.randomUUID();
          (ws.data as any).auth = {
            sub: raw['sub'] as string,
            email: raw['email'] as string,
            role: raw['role'] as string,
          };
          (ws.data as any).socketId = socketId;

          let userName = (raw['name'] as string) ?? null;
          if (!userName) {
            const dbUser = await db.query.users.findFirst({
              where: eq(users.id, raw['sub'] as string),
              columns: { name: true },
            });
            userName = dbUser?.name ?? (raw['email'] as string);
          }

          const request = (ws as any).data?.request as Request | undefined;
          const ip =
            (request ? extractClientIp(request) : null)
            ?? (ws as any).raw?.remoteAddress
            ?? (ws as any).remoteAddress
            ?? null;

          addSession(socketId, ws, {
            userId: raw['sub'] as string,
            email: raw['email'] as string,
            name: userName,
            role: raw['role'] as string,
            ip,
            userAgent: null,
          });

          console.log(`[WS] Authenticated connection from ${raw['email']} (${socketId})`);
          ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket authenticated' }));

          setTimeout(() => {
            try {
              const payload = getLatestPricePayload();
              if (payload.prices.length > 0 || payload.fxRates) {
                ws.send(JSON.stringify({ type: 'prices', data: payload }));
              }
            } catch {
              // ws may have closed
            }
          }, 500);
        } catch {
          console.log('[WS] Connection rejected: token verification failed');
          ws.send(JSON.stringify({ type: 'auth-error', message: 'Token verification failed' }));
          ws.close();
        }
      },

      async message(ws, message) {
        const auth = (ws.data as any).auth;
        if (!auth) {
          ws.send(JSON.stringify({ type: 'auth-error', message: 'Not authenticated' }));
          return;
        }

        try {
          const data = typeof message === 'string' ? JSON.parse(message) : message;

          switch (data.type) {
            case 'presence': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                updatePresence(socketId, {
                  currentUrl: data.url ?? null,
                  timezone: data.timezone ?? null,
                  platform: data.platform ?? null,
                  pageTitle: data.pageTitle ?? null,
                  language: data.language ?? null,
                });
              }
              break;
            }

            case 'admin:subscribe-sessions': {
              const socketId = (ws.data as any).socketId;
              if (auth.role === 'ADMIN' && socketId) {
                subscribeAdmin(socketId);
              }
              break;
            }

            case 'admin:unsubscribe-sessions': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                unsubscribeAdmin(socketId);
              }
              break;
            }

            case 'whatsapp:subscribe': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                subscribeSocketTopic(socketId, 'whatsapp');
              }
              break;
            }

            case 'whatsapp:unsubscribe': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                unsubscribeSocketTopic(socketId, 'whatsapp');
              }
              break;
            }

            case 'copy-event': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                logCopyEvent(socketId, {
                  text: String(data.text ?? '').slice(0, 500),
                  sourceUrl: data.sourceUrl ?? null,
                  pageTitle: data.pageTitle ?? null,
                });
              }
              break;
            }

            case 'print-event': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                logPrintEvent(socketId, {
                  sourceUrl: data.sourceUrl ?? null,
                  pageTitle: data.pageTitle ?? null,
                });
              }
              break;
            }

            case 'screenshot-event': {
              const socketId = (ws.data as any).socketId;
              if (socketId) {
                logScreenshotEvent(socketId, {
                  sourceUrl: data.sourceUrl ?? null,
                  pageTitle: data.pageTitle ?? null,
                });
              }
              break;
            }

            case 'nearby-vessels': {
              if (!data.placeId) break;
              console.log(`[WS] Fetching nearby vessels for place ${data.placeId}…`);
              try {
                const vessels = await getNearbyVessels(String(data.placeId));
                ws.send(JSON.stringify({ type: 'nearby-vessels', data: vessels }));
                console.log(`[WS] Sent ${vessels.length} nearby vessels`);
              } catch (err: any) {
                console.warn(`[WS] Nearby vessels failed for ${data.placeId}:`, err.message);
                ws.send(JSON.stringify({ type: 'nearby-vessels', data: [] }));
              }
              break;
            }

            case 'vessel-positions': {
              if (!data.placeId) break;
              try {
                const positions = await getNearbyVesselPositions(String(data.placeId));
                ws.send(JSON.stringify({ type: 'vessel-positions', data: positions }));
              } catch (err: any) {
                console.warn(`[WS] Vessel positions failed for ${data.placeId}:`, err.message);
              }
              break;
            }

            case 'sync-place': {
              if (!data.placeId) break;
              console.log(`[WS] Syncing place ${data.placeId} from Seasearcher…`);
              const updated = await syncPlaceFromSeasearcher(String(data.placeId));
              if (updated) {
                ws.send(JSON.stringify({ type: 'place-synced', data: updated }));
                console.log(`[WS] Place ${data.placeId} synced successfully`);
              } else {
                ws.send(JSON.stringify({ type: 'sync-error', message: 'Place not found or no Seasearcher ID' }));
              }
              break;
            }

            case 'get-prices': {
              const payload = getLatestPricePayload();
              if (payload.prices.length > 0 || payload.fxRates) {
                ws.send(JSON.stringify({ type: 'prices', data: payload }));
              }
              break;
            }

            case 'ping': {
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
            }

            default:
              ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
          }
        } catch (err) {
          console.error('[WS] Error:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to process request' }));
        }
      },

      close(ws) {
        const auth = (ws.data as any).auth;
        const socketId = (ws.data as any).socketId;
        if (socketId) {
          removeSession(socketId);
        }
        console.log(`[WS] Client disconnected${auth ? ` (${auth.email})` : ''}`);
      },
    });

  if (options.enableBackgroundJobs !== false) {
    startPruneJob();
    startPricePolling();
    startInquiryReminderJob();
    registerAutoSyncHooks();
    reconnectWhatsAppSessions();
    resumePendingPlattsParseJobs();
    startRiskMonitoringJob();
    startVesselSanctionJob();
  }

  return app;
}

export interface StartServerOptions extends CreateAppOptions {
  port?: number;
}

function formatStartupError(err: unknown, port: number): string {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : '';
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown startup error');

  if (code === 'EADDRINUSE' || /address already in use|EADDRINUSE/i.test(message)) {
    return `Port ${port} is already in use. Stop the existing process or set PORT to a free port.`;
  }

  if (code === 'EACCES' || /permission denied|EACCES/i.test(message)) {
    return `Permission denied while binding to port ${port}. Try a higher port (for example PORT=3001).`;
  }

  return message;
}

export async function startServer(options: StartServerOptions = {}) {
  const app = await createApp(options);
  const port = options.port ?? (Number(process.env['PORT']) || 3000);

  try {
    app.listen(port);
  } catch (err) {
    const details = formatStartupError(err, port);
    console.error(`❌ API startup failed: ${details}`);
    throw err;
  }

  if (!app.server) {
    const details = `Server did not initialize on port ${port}`;
    console.error(`❌ API startup failed: ${details}`);
    throw new Error(details);
  }

  console.log(
    `🛢️  Fueld API is running at http://${app.server?.hostname}:${app.server?.port}`,
  );
  console.log(
    `📖 Swagger docs at http://${app.server?.hostname}:${app.server?.port}/swagger`,
  );

  return app;
}

if (import.meta.main) {
  startServer().catch((err) => {
    const port = Number(process.env['PORT']) || 3000;
    const details = formatStartupError(err, port);
    console.error(`❌ Fatal startup error: ${details}`);
    process.exit(1);
  });
}

export type App = Awaited<ReturnType<typeof createApp>>;
