import { Service, signal } from '@angular/core';

@Service()
export class NewInquiryModalService {
  readonly requestId = signal(0);

  requestOpen(): void {
    this.requestId.update((value) => value + 1);
  }
}