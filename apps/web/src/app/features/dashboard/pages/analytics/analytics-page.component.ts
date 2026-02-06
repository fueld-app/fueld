import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsOption } from 'echarts';
import { NgxEchartsModule } from 'ngx-echarts'; // Will be installed in a later step

// ═══════════════════════════════════════════════════════════════════════
//  Analytics Page — Funnel Chart and Loss Analysis Pie Chart
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgxEchartsModule],
  template: `
    <div class="mb-6">
      <!-- Breadcrumb -->
      <nav class="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
        <a routerLink="/dashboard" class="hover:text-brand-600 transition-colors">Dashboard</a>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
        <span class="text-gray-900 font-medium">Analytics</span>
      </nav>

      <!-- Title row -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Analytics</h1>
          <p class="mt-1 text-sm text-gray-500">Performance insights and loss analysis.</p>
        </div>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Funnel Chart -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Sales Funnel</h3>
        <div echarts [options]="funnelChartOptions" class="h-[400px]"></div>
      </div>

      <!-- Loss Analysis Pie Chart -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Loss Analysis</h3>
        <div echarts [options]="lossAnalysisChartOptions" class="h-[400px]"></div>
      </div>
    </div>
  `,
})
export class AnalyticsPageComponent implements OnInit {
  funnelChartOptions: EChartsOption = {};
  lossAnalysisChartOptions: EChartsOption = {};

  ngOnInit(): void {
    this.initFunnelChart();
    this.initLossAnalysisChart();
  }

  private initFunnelChart(): void {
    this.funnelChartOptions = {
      tooltip: {
        trigger: 'item',
        formatter: '{a} <br/>{b} : {c} units',
      },
      legend: {
        data: ['Inquiries', 'Offers', 'Orders'],
      },
      series: [
        {
          name: 'Sales Funnel',
          type: 'funnel',
          left: '10%',
          top: 60,
          bottom: 60,
          width: '80%',
          gap: 2,
          label: {
            show: true,
            position: 'inside',
          },
          labelLine: {
            length: 10,
            lineStyle: {
              width: 1,
              type: 'solid',
            },
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 1,
          },
          emphasis: {
            label: {
              fontSize: 20,
            },
          },
          data: [
            { value: 1000, name: 'Inquiries' },
            { value: 600, name: 'Offers' },
            { value: 300, name: 'Orders' },
          ],
        },
      ],
    };
  }

  private initLossAnalysisChart(): void {
    this.lossAnalysisChartOptions = {
      tooltip: {
        trigger: 'item',
        formatter: '{a} <br/>{b} : {c} ({d}%)',
      },
      legend: {
        bottom: '1%',
        left: 'center',
        data: ['Price', 'Credit', 'Logistics', 'Other'],
      },
      series: [
        {
          name: 'Loss Reasons',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: false,
            position: 'center',
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 20,
              fontWeight: 'bold',
            },
          },
          labelLine: {
            show: false,
          },
          data: [
            { value: 150, name: 'Price', itemStyle: { color: '#ef4444' } }, // red-500
            { value: 80, name: 'Credit', itemStyle: { color: '#f97316' } }, // orange-500
            { value: 40, name: 'Logistics', itemStyle: { color: '#facc15' } }, // yellow-400
            { value: 30, name: 'Other', itemStyle: { color: '#a3a3a3' } }, // gray-400
          ],
        },
      ],
    };
  }
}
