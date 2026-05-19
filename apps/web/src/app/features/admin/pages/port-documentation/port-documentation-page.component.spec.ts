import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { PortDocumentationPageComponent } from './port-documentation-page.component';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('PortDocumentationPageComponent', () => {
  async function createComponent(options?: {
    onGet?: (url: string, requestOptions?: unknown) => unknown;
    onPost?: (url: string, body: unknown) => unknown;
    onPatch?: (url: string, body: unknown) => unknown;
  }) {
    await TestBed.configureTestingModule({
      imports: [PortDocumentationPageComponent],
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: (url: string, requestOptions?: unknown) => of(options?.onGet?.(url, requestOptions) ?? { success: true, data: [] }),
            post: (url: string, body: unknown) => of(options?.onPost?.(url, body) ?? { success: true, data: [] }),
            patch: (url: string, body: unknown) => of(options?.onPatch?.(url, body) ?? { success: true, data: [] }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PortDocumentationPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, component: fixture.componentInstance };
  }

  it('uploads a flange worksheet and refreshes the asset list', async () => {
    const postCalls: Array<{ url: string; body: unknown }> = [];
    let assetLoads = 0;
    const { component } = await createComponent({
      onGet: (url) => {
        if (url.includes('/admin/port-documentation/assets')) {
          assetLoads += 1;
          return {
            success: true,
            data: assetLoads > 1
              ? [{
                  id: 'asset-1',
                  tenantId: 'tenant-1',
                  documentKind: 'FLANGE_WORKSHEET',
                  displayName: 'Flange Worksheet',
                  originalFileName: 'flange-worksheet.xlsx',
                  filePath: '/uploads/example.xlsx',
                  mimeType: XLSX_MIME,
                  fileSize: 128,
                  sha256Hex: 'abc',
                  versionNumber: 1,
                  isCurrent: true,
                  active: true,
                  uploadedBy: 'user-1',
                  supersededAt: null,
                  createdAt: '2026-05-19T00:00:00.000Z',
                }]
              : [],
          };
        }
        return { success: true, data: [] };
      },
      onPost: (url, body) => {
        postCalls.push({ url, body });
        return {
          success: true,
          data: {
            id: 'asset-1',
            tenantId: 'tenant-1',
            documentKind: 'FLANGE_WORKSHEET',
            displayName: 'Flange Worksheet',
            originalFileName: 'flange-worksheet.xlsx',
            filePath: '/uploads/example.xlsx',
            mimeType: XLSX_MIME,
            fileSize: 128,
            sha256Hex: 'abc',
            versionNumber: 1,
            isCurrent: true,
            active: true,
            uploadedBy: 'user-1',
            supersededAt: null,
            createdAt: '2026-05-19T00:00:00.000Z',
          },
        };
      },
    });

    const file = new File(['sheet'], 'flange-worksheet.xlsx', { type: XLSX_MIME });
    const target = { files: [file], value: 'picked' } as unknown as HTMLInputElement;

    await component.onFlangeWorksheetSelected({ target } as unknown as Event);

    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.url).toContain('/admin/port-documentation/assets/flange-worksheet');
    expect(postCalls[0]?.body).toBeInstanceOf(FormData);
    expect((postCalls[0]?.body as FormData).get('file')).toBe(file);
    expect(component.assets()).toHaveLength(1);
    expect(component.toast()).toEqual({ type: 'success', message: 'Flange Worksheet uploaded.' });
    expect(target.value).toBe('');
  });

  it('downloads an asset using the response filename when provided', async () => {
    vi.useFakeTimers();
    const { component } = await createComponent({
      onGet: (url, requestOptions) => {
        if (url.includes('/admin/port-documentation/assets/asset-1/download') && requestOptions) {
          return new HttpResponse({
            body: new Blob(['asset']),
            headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="server-name.xlsx"' }),
            status: 200,
          });
        }
        return { success: true, data: [] };
      },
    });

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      await component.downloadAsset({
        id: 'asset-1',
        tenantId: 'tenant-1',
        documentKind: 'FLANGE_WORKSHEET',
        displayName: 'Flange Worksheet',
        originalFileName: 'fallback.xlsx',
        filePath: '/uploads/example.xlsx',
        mimeType: XLSX_MIME,
        fileSize: 128,
        sha256Hex: 'abc',
        versionNumber: 1,
        isCurrent: true,
        active: true,
        uploadedBy: 'user-1',
        supersededAt: null,
        createdAt: '2026-05-19T00:00:00.000Z',
      });

      expect(createObjectUrlSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectUrlSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      clickSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
    }
  });
});
