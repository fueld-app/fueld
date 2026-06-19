import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  PortDocumentationOrderContextDto,
  BunkerInstructionsPreviewDto,
  OrderPortDocumentDto,
} from '@fueld/types';
import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderPortDocumentationService {
  private readonly http = inject(HttpClient);

  readonly portDocumentationContext = signal<PortDocumentationOrderContextDto | null>(null);
  readonly portDocumentationLoading = signal(false);
  readonly portDocumentationError = signal('');
  readonly portDocumentationAction = signal<string | null>(null);
  readonly bunkerInstructionsPreview = signal<BunkerInstructionsPreviewDto | null>(null);

  async load(orderId: string): Promise<void> {
    if (!orderId) return;

    this.portDocumentationLoading.set(true);
    this.portDocumentationError.set('');
    this.bunkerInstructionsPreview.set(null);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortDocumentationOrderContextDto>>(`${API_URL}/orders/${orderId}/port-documentation`),
      );
      if (res.success) {
        this.portDocumentationContext.set(res.data);
      } else {
        this.portDocumentationContext.set(null);
        const msg = res.message ?? 'Port Documentation is not available on this deployment yet.';
        this.portDocumentationError.set(msg);
        console.warn('[PortDocumentation] Load failed:', msg, { orderId });
      }
    } catch (err) {
      this.portDocumentationContext.set(null);
      const msg = 'Port Documentation is not available on this deployment yet.';
      this.portDocumentationError.set(msg);
      console.warn('[PortDocumentation] Load error:', err, { orderId });
    } finally {
      this.portDocumentationLoading.set(false);
    }
  }

  async previewBunkerInstructions(orderId: string): Promise<void> {
    if (!orderId) return;

    this.portDocumentationAction.set('preview-bunker');
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BunkerInstructionsPreviewDto>>(`${API_URL}/orders/${orderId}/port-documentation/bunker-instructions/preview`),
      );
      if (!res.success) {
        return;
      }
      this.bunkerInstructionsPreview.set(res.data);
    } catch {
      // silently fail
    } finally {
      this.portDocumentationAction.set(null);
    }
  }

  async generateBunkerInstructions(orderId: string): Promise<void> {
    await this.runMutation(
      orderId,
      'generate-bunker',
      'Bunker Instructions generated.',
      'Failed to generate Bunker Instructions.',
      () => this.postDocument(orderId, 'bunker-instructions/generate'),
    );
  }

  async generateGateList(orderId: string): Promise<void> {
    await this.runMutation(
      orderId,
      'generate-gate-list',
      'Gate List generated.',
      'Failed to generate Gate List.',
      () => this.postDocument(orderId, 'gate-list/generate'),
    );
  }

  async includeFlangeWorksheetDocument(orderId: string): Promise<void> {
    await this.runMutation(
      orderId,
      'include-flange',
      'Flange Worksheet included on the order.',
      'Failed to include Flange Worksheet.',
      () => this.postDocument(orderId, 'flange-worksheet/include'),
    );
  }

  async downloadDocument(orderId: string, doc: OrderPortDocumentDto): Promise<void> {
    if (!orderId) return;

    this.portDocumentationAction.set(`download-${doc.id}`);
    try {
      const response = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${orderId}/port-documentation/documents/${doc.id}/download`, {
          responseType: 'blob',
          observe: 'response',
        }),
      );
      this.downloadResponseBlob(response, doc.fileName);
    } catch {
      // silently fail
    } finally {
      this.portDocumentationAction.set(null);
    }
  }

  async ensureReadyForSend(orderId: string): Promise<boolean> {
    let currentContext = this.portDocumentationContext();
    if (!currentContext) {
      await this.load(orderId);
      currentContext = this.portDocumentationContext();
    }

    if (this.getActiveDocumentCount(currentContext) > 0) return true;

    if (!currentContext?.enabled) {
      return false;
    }

    const generatedCount = await this.prepareForSend(orderId);
    if (generatedCount > 0) {
      return true;
    }

    return false;
  }

  private async prepareForSend(orderId: string): Promise<number> {
    const context = this.portDocumentationContext();
    const operations: Array<() => Promise<void>> = [];

    operations.push(() => this.postDocument(orderId, 'bunker-instructions/generate'));
    if ((context?.gateListCount ?? 0) > 0) {
      operations.push(() => this.postDocument(orderId, 'gate-list/generate'));
    }
    if (context?.currentFlangeWorksheet) {
      operations.push(() => this.postDocument(orderId, 'flange-worksheet/include'));
    }

    this.portDocumentationAction.set('prepare-send');
    try {
      let successCount = 0;
      for (const operation of operations) {
        try {
          await operation();
          successCount += 1;
        } catch {
          // Continue so one missing document type doesn't block the rest.
        }
      }

      await this.load(orderId);
      return this.getActiveDocumentCount(this.portDocumentationContext());
    } finally {
      this.portDocumentationAction.set(null);
    }
  }

  private getActiveDocumentCount(context: PortDocumentationOrderContextDto | null | undefined): number {
    return (context?.documents ?? [])
      .filter((doc) => String(doc.status ?? '').toUpperCase() === 'ACTIVE')
      .length;
  }

  private async postDocument(orderId: string, pathSuffix: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<OrderPortDocumentDto>>(`${API_URL}/orders/${orderId}/port-documentation/${pathSuffix}`, {}),
    );
    if (!res.success) {
      throw new Error(res.message ?? 'Request failed');
    }
  }

  private async runMutation(
    orderId: string,
    actionKey: string,
    _successMessage: string,
    _errorMessage: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    this.portDocumentationAction.set(actionKey);
    try {
      await operation();
      await this.load(orderId);
    } catch {
      // silently fail
    } finally {
      this.portDocumentationAction.set(null);
    }
  }

  private downloadResponseBlob(response: HttpResponse<Blob>, fallbackFileName: string): void {
    const blob = response.body;
    if (!blob) throw new Error('Missing file body');

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = this.extractFilenameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackFileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  private extractFilenameFromDisposition(header: string | null): string | null {
    const match = header?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? null;
  }

  humanizeDocumentKind(value: string | null | undefined): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  humanizeDocumentSource(value: string | null | undefined): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }
}
