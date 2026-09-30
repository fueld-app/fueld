/**
 * The supplier-invoice recipient rule, as a pure function.
 *
 * Unit-tested rather than through `/send` because the transport cannot be
 * controlled from an e2e file: `bun test` is process-global, `documents.
 * mail.service.test.ts` installs a `mock.module` over `src/lib/email`, and it
 * takes effect for whichever file imports first — so an e2e test cannot assert
 * what a success would have sent. The rule itself needs no database, no HTTP and
 * no SMTP, so it is tested directly.
 */
import { describe, expect, it } from 'bun:test';
import { selectSupplierRecipients } from '../src/modules/orders/supplier-invoice.service';

const row = (email: string, emailType: string, isPrimary = false) => ({ email, emailType, isPrimary });

describe('selectSupplierRecipients', () => {
  it('prefers an explicit override, verbatim', () => {
    const rows = [row('billing@x.test', 'invoice', true)];
    // The operator's override wins even when an address is on file.
    expect(selectSupplierRecipients(rows, ['  typed@x.test ', 'second@x.test']))
      .toEqual(['typed@x.test', 'second@x.test']);
  });

  it('uses the billing address ahead of the general one', () => {
    // On a PAYABLE the billing address is the one set up to receive it.
    expect(selectSupplierRecipients(
      [row('general@x.test', 'general', true), row('billing@x.test', 'invoice', true)],
      [],
    )).toEqual(['billing@x.test']);
  });

  it('falls back to general when no billing address is on file', () => {
    expect(selectSupplierRecipients([row('general@x.test', 'general')], [])).toEqual(['general@x.test']);
  });

  it('prefers the primary address within a class', () => {
    expect(selectSupplierRecipients(
      [row('plain@x.test', 'invoice'), row('primary@x.test', 'invoice', true)],
      [],
    )).toEqual(['primary@x.test']);
  });

  it('is deterministic when several addresses share a rank', () => {
    // Which address wins must not depend on row order, so run both orders.
    const a = row('b@x.test', 'invoice', true);
    const b = row('a@x.test', 'invoice', true);
    expect(selectSupplierRecipients([a, b], [])).toEqual(['a@x.test']);
    expect(selectSupplierRecipients([b, a], [])).toEqual(['a@x.test']);
  });

  it('falls back to any primary address when the types are unknown', () => {
    expect(selectSupplierRecipients([row('other@x.test', 'accounts', true)], [])).toEqual(['other@x.test']);
  });

  it('returns nothing when the supplier has no address at all', () => {
    // The caller turns this into a 400 naming the supplier: a payable that is
    // silently unsent is a loss, so "nowhere to send" must not look like success.
    expect(selectSupplierRecipients([], [])).toEqual([]);
    expect(selectSupplierRecipients([row('x@x.test', 'accounts')], [])).toEqual([]);
  });
});
