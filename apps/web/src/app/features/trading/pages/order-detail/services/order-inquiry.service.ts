import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import type { InquirySupplierComparisonRow, SupplierInquiryReplyRow, InquirySupplierPerformance } from '../order-detail.types';

import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderInquiryService {
  private readonly http = inject(HttpClient);

  async loadSupplierContext(orderId: string): Promise<InquirySupplierComparisonRow[]> {
    if (!orderId) return [];

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquirySupplierComparisonRow[]>>(`${API_URL}/orders/${orderId}/inquiry/suppliers`),
      );
      if (res.success) {
        return res.data ?? [];
      }
    } catch {
      // silently ignore
    }
    return [];
  }

  async loadReplies(orderId: string): Promise<SupplierInquiryReplyRow[]> {
    if (!orderId) return [];

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierInquiryReplyRow[]>>(`${API_URL}/orders/${orderId}/inquiry/sent`),
      );
      if (res.success) {
        return res.data ?? [];
      }
    } catch {
      // silently ignore
    }
    return [];
  }

  compareSupplierPerformance(
    left: InquirySupplierComparisonRow,
    right: InquirySupplierComparisonRow,
  ): number {
    const scoreDiff = this.supplierScore(right.performance) - this.supplierScore(left.performance);
    if (scoreDiff !== 0) return scoreDiff;
    return left.supplierName.localeCompare(right.supplierName);
  }

  supplierScore(performance: InquirySupplierPerformance): number {
    const quoteRate = performance.sentCount > 0 ? performance.quotedCount / performance.sentCount : 0;
    const deliverabilityRate = performance.deliverableCount + performance.nonDeliverableCount > 0
      ? performance.deliverableCount / (performance.deliverableCount + performance.nonDeliverableCount)
      : 0;
    const responseBonus = performance.averageResponseHours == null
      ? 0
      : Math.max(0, 72 - Math.min(72, performance.averageResponseHours)) * 5;
    const lastAtPlace = performance.lastDeliveredAtPlace ? Date.parse(performance.lastDeliveredAtPlace) : 0;
    const lastOverall = performance.lastDeliveredAtOverall ? Date.parse(performance.lastDeliveredAtOverall) : 0;
    return performance.deliveredCountAtPlace * 1000
      + performance.deliveredCountOverall * 100
      + Math.round(quoteRate * 100) * 10
      + Math.round(deliverabilityRate * 100) * 8
      + Math.round(responseBonus)
      + Math.floor(lastAtPlace / 86400000)
      + Math.floor(lastOverall / 86400000 / 10);
  }

  deliverabilityLabel(performance: InquirySupplierPerformance): string {
    const responseCount = performance.deliverableCount + performance.nonDeliverableCount;
    if (responseCount <= 0) return '';
    return `${Math.round((performance.deliverableCount / responseCount) * 100)}% deliverable`;
  }

  replySummary(row: SupplierInquiryReplyRow): string {
    if (row.status === 'QUOTED' && row.quoteLineCount > 0) {
      const totalLines = row.items.length;
      return `${row.quoteLineCount}/${totalLines} line${totalLines === 1 ? '' : 's'} quoted`;
    }
    if (row.status === 'DECLINED' && row.declineReason) {
      return row.declineReason;
    }
    if (row.status === 'NO_REPLY') {
      return 'Marked as no reply';
    }
    return 'Awaiting supplier response';
  }

  supplierPerformanceSummary(performance: InquirySupplierPerformance): string {
    if (performance.lastDeliveredAtPlace) {
      return `Last here ${this.formatHistoryDate(performance.lastDeliveredAtPlace)}`;
    }
    if (performance.lastDeliveredAtOverall) {
      return `Last served ${this.formatHistoryDate(performance.lastDeliveredAtOverall)}`;
    }
    if (performance.noReplyCount > 0) {
      return `${performance.noReplyCount} no reply`;
    }
    if (performance.declinedCount > 0) {
      return `${performance.declinedCount} declined`;
    }
    return '';
  }

  isTopSupplier(row: InquirySupplierComparisonRow, rankedSuppliers: InquirySupplierComparisonRow[]): boolean {
    const topRow = rankedSuppliers[0];
    return !!topRow && topRow.supplierId === row.supplierId && this.supplierScore(row.performance) > 0;
  }

  private formatHistoryDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
