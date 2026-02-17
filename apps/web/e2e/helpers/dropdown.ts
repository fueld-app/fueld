import { expect, type Locator, type Page } from '@playwright/test';

export async function selectSearchableDropdownOption(
  page: Page,
  scope: Locator,
  fieldLabel: string,
  optionLabel: string,
): Promise<void> {
  // Anchor to the label text and then scope to its immediate field wrapper.
  // This avoids matching a larger container that contains multiple dropdowns.
  const field = scope.getByText(fieldLabel, { exact: true }).locator('..');
  const input = field.getByRole('combobox');

  await input.click();
  await input.fill(optionLabel);

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click();

  await expect(listbox).toBeHidden();
  await expect(input).toHaveValue(optionLabel);
}
