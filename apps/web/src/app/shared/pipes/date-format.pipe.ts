import { Pipe, PipeTransform, inject } from '@angular/core';
import { DateFormatService } from '../../core/services/date-format.service';

/**
 * Angular pipe that formats an ISO date string according to the tenant's
 * configured date format (AMERICAN / EUROPEAN / ISO).
 *
 * Usage: {{ someDate | dateFormat }}
 */
@Pipe({ name: 'dateFormat', standalone: true })
export class DateFormatPipe implements PipeTransform {
  private readonly svc = inject(DateFormatService);

  transform(value: string | null | undefined): string {
    return this.svc.formatDate(value);
  }
}

/**
 * Angular pipe that formats an ISO date string with a short month name
 * according to the tenant's configured date format.
 *
 * Usage: {{ someDate | dateLabel }}
 */
@Pipe({ name: 'dateLabel', standalone: true })
export class DateLabelPipe implements PipeTransform {
  private readonly svc = inject(DateFormatService);

  transform(value: string | null | undefined): string {
    return this.svc.formatDateLabel(value);
  }
}