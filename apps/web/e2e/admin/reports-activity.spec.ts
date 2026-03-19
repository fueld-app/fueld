import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const adminEmail = process.env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = process.env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';

test('reports config changes appear in admin activity log', async ({ page }) => {
  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 15_000 });

  const savedViewName = `Quarterly Ops Review ${Date.now()}`;
  const updatedSavedViewName = `${savedViewName} Updated`;
  const scheduleName = `Daily Audit Digest ${Date.now()}`;
  const updatedScheduleName = `${scheduleName} Updated`;

  await page.getByTestId('reports-view-name').fill(savedViewName);
  await page.getByTestId('reports-view-description').fill('Playwright saved view');

  const createViewResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/reports/saved-views'),
  );
  await page.getByTestId('reports-save-view').click();
  await createViewResponse;
  await expect(page.getByText(savedViewName, { exact: true })).toBeVisible({ timeout: 15_000 });

  const savedViewCard = page.getByText(savedViewName, { exact: true }).locator('..').locator('..');
  const savedViewCardId = await savedViewCard.getAttribute('data-testid');
  if (!savedViewCardId) throw new Error('Saved view card test id not found');
  const savedViewId = savedViewCardId.replace('reports-view-card-', '');

  await page.getByTestId(`reports-view-edit-${savedViewId}`).click();
  await page.getByTestId('reports-view-name').fill(updatedSavedViewName);
  await page.getByTestId('reports-save-view').click();
  await expect(page.getByText(updatedSavedViewName, { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('reports-schedule-name').fill(scheduleName);
  await page.getByTestId('reports-schedule-description').fill('Playwright schedule');
  await page.getByTestId('reports-schedule-delivery-mode').selectOption('CSV_XLSX');
  await page.getByTestId('reports-schedule-body-mode').selectOption('ATTACHMENT_ONLY');
  await page.getByTestId('reports-schedule-hour').selectOption('9');
  await page.getByTestId('reports-schedule-extra-emails').fill('ops+reports@fueld.test');

  const createScheduleResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/reports/schedules'),
  );
  await page.getByTestId('reports-save-schedule').click();
  await createScheduleResponse;
  await expect(page.getByText(scheduleName, { exact: true })).toBeVisible({ timeout: 15_000 });

  const scheduleCard = page.getByText(scheduleName, { exact: true }).locator('..').locator('..');
  const scheduleCardId = await scheduleCard.getAttribute('data-testid');
  if (!scheduleCardId) throw new Error('Schedule card test id not found');
  const scheduleId = scheduleCardId.replace('reports-schedule-card-', '');

  await page.getByTestId(`reports-schedule-edit-${scheduleId}`).click();
  await page.getByTestId('reports-schedule-name').fill(updatedScheduleName);
  await page.getByTestId('reports-save-schedule').click();
  await expect(page.getByTestId(`reports-schedule-card-${scheduleId}`)).toContainText(updatedScheduleName, { timeout: 15_000 });

  const deleteUpdatedViewResponse = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/reports/saved-views/'),
  );
  await page.getByTestId(`reports-view-delete-${savedViewId}`).click();
  await deleteUpdatedViewResponse;
  await expect(page.getByText(updatedSavedViewName, { exact: true })).not.toBeVisible({ timeout: 15_000 });

  const deleteUpdatedScheduleResponse = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/reports/schedules/'),
  );
  await page.getByTestId(`reports-schedule-delete-${scheduleId}`).click();
  await deleteUpdatedScheduleResponse;
  await expect(page.getByTestId(`reports-schedule-card-${scheduleId}`)).toHaveCount(0, { timeout: 15_000 });

  await page.goto('/admin/activity');
  await expect(page.getByRole('heading', { name: /Activity/i })).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('activity-log-tab').click();

  const entityFilter = page.getByTestId('activity-log-entity-filter');

  await entityFilter.selectOption('report_saved_view');
  await expect(page.locator('tr').filter({ hasText: savedViewName }).filter({ hasText: 'Create' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tr').filter({ hasText: updatedSavedViewName }).filter({ hasText: 'Update' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tr').filter({ hasText: updatedSavedViewName }).filter({ hasText: 'Delete' }).first()).toBeVisible({ timeout: 15_000 });

  await entityFilter.selectOption('report_schedule');
  await expect(page.locator('tr').filter({ hasText: scheduleName }).filter({ hasText: 'Create' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tr').filter({ hasText: updatedScheduleName }).filter({ hasText: 'Update' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tr').filter({ hasText: updatedScheduleName }).filter({ hasText: 'Delete' }).first()).toBeVisible({ timeout: 15_000 });
});
