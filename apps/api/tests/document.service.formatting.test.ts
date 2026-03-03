import { describe, expect, it } from 'bun:test';
import { __documentTestUtils } from '../src/modules/documents/document.service';

describe('document.service formatting helpers', () => {
  it('builds OFFER for-account-of text with vessel IMO and client name', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'OFFER',
      vesselName: 'Aurora',
      vesselImo: '1234567',
      clientName: 'Acme Trading',
      companyName: 'Ignored Here',
    });

    expect(text).toBe('Master and/or owner and/or charterers and/or MV Aurora (IMO: 1234567) and/or Acme Trading');
  });

  it('does not duplicate MV prefix when vessel name already starts with MV', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'CONFIRMATION',
      vesselName: 'MV Borealis',
      vesselImo: null,
      clientName: 'Client Co',
    });

    expect(text).toBe('Master and/or owner and/or charterers and/or MV Borealis and/or Client Co');
  });

  it('uses company name for NOMINATION for-account-of text', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'NOMINATION',
      vesselName: 'Aurora',
      companyName: 'Fueld Trading Ltd',
      clientName: 'Should Not Be Used',
    });

    expect(text).toBe('Fueld Trading Ltd');
  });

  it('falls back to default name for NOMINATION when company name is empty', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'NOMINATION',
      vesselName: 'Aurora',
      companyName: '   ',
    });

    expect(text).toBe('Invoicing company');
  });

  it('replaces company/document placeholders in terms text', () => {
    const text = __documentTestUtils.replaceCompanyNamePlaceholder(
      'This ${documentName} is issued by ${companyName}. Ref: ${offerOrConfirmation}.',
      'Fueld Trading Ltd',
      'Offer',
    );

    expect(text).toBe('This Offer is issued by Fueld Trading Ltd. Ref: Offer.');
  });
});