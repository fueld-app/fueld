import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NewInquiryModalService {
  readonly requestId = signal(0);

  requestOpen(): void {
    this.requestId.update((value) => value + 1);
  }
}