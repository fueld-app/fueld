import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
  OnInit,
  OnDestroy,
  AfterViewInit,
  effect,
  ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  OrderStatus,
  PaymentTermType,
  PricingModel,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
  type OrderAttachmentDto,
  type CustomerPaymentDto,
  type CompanyContactDto,
  type BankAccountDto,
  type OrderSupplierDto,
  type SupplierNominationSummaryDto,
  type WarehouseDto,
  type InventorySkuDto,
  type OrderTransferDto,
  type OrderPortDocumentDto,
  type DeliveryDocumentationSettingsDto,
} from '@fueld/types';

import {
  OrderItemsComponent,
} from '../../components/order-items/order-items.component';
import type {
  OrderItemRow,
  OrderItemsEconomics,
} from '../../components/order-items/order-item.types';
import { OrderFinancingSummaryComponent } from '../../components/order-financing-summary/order-financing-summary.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../components/header-actions/header-actions.component';
import { SendEmailModalComponent, type SendEmailPayload, type DocumentEmailType, type SendWhatsAppPayload, type SendEmailAttachmentOption } from '../../components/send-email-modal/send-email-modal.component';
import { SendInquiryModalComponent, type SendInquiryPayload, type SendInquiryWhatsAppPayload } from '../../components/send-inquiry-modal/send-inquiry-modal.component';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { OrderPaymentTermsCardComponent } from './components/order-payment-terms-card/order-payment-terms-card.component';
import { OrderNotesTermsCardComponent } from './components/order-notes-terms-card/order-notes-terms-card.component';
import { OrderDeliveryCardComponent } from './components/order-delivery-card/order-delivery-card.component';
import { OrderAttachmentsCardComponent } from './components/order-attachments-card/order-attachments-card.component';
import { OrderSettingsDropdownComponent } from './components/order-settings-dropdown/order-settings-dropdown.component';
import { OrderPlattsSignalsComponent } from './components/order-platts-signals/order-platts-signals.component';
import { OrderSecondaryTabsComponent } from './components/order-secondary-tabs/order-secondary-tabs.component';
import { OrderPaymentModalComponent } from './components/order-payment-modal/order-payment-modal.component';
import { OrderConvertModalComponent } from './components/order-convert-modal/order-convert-modal.component';
import { OrderCancelModalComponent } from './components/order-cancel-modal/order-cancel-modal.component';
import { OrderPlaceRemarkPromptComponent } from './components/order-place-remark-prompt/order-place-remark-prompt.component';
import { OrderSuppliersTabComponent } from './components/order-suppliers-tab/order-suppliers-tab.component';
import { OrderCaptureTabComponent } from './components/order-capture-tab/order-capture-tab.component';
import { OrderPaymentsCardComponent } from './components/order-payments-card/order-payments-card.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { PdfPreviewModalComponent } from '../../../../shared/components/pdf-preview-modal/pdf-preview-modal.component';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { EmailHistoryCardComponent } from '../../../../shared/components/email-history-card/email-history-card.component';
import { TradingDetailHeaderComponent } from '../../components/detail-header/detail-header.component';
import { TradingDetailMetaCardsComponent } from '../../components/detail-meta-cards/detail-meta-cards.component';
import { InternalTransferSummaryComponent } from '../../components/internal-transfer-summary/internal-transfer-summary.component';
import { InternalTransferSidesComponent } from '../../components/internal-transfer-sides/internal-transfer-sides.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { OrderReferenceDataService } from './services/order-reference-data.service';
import { OrderReplyService } from './services/order-reply.service';
import { buildItemPayload, normalizeTimeZone, parseFixedOffsetMinutes, getTimeZoneOffset, toUtcIsoFromZonedInput, toUtcIsoFromZonedDateInput, formatStoredDateOnlyForInputZoned, formatDateTimeInput, toIsoFromDateTimeInput, formatStoredDateOnlyForInput, parseDecimalValue, normalizeTerms, normalizeCurrencyCode } from './services/order-utils';
import { OrderLoaderService } from './services/order-loader.service';
import { OrderPortDocumentationService } from './services/order-port-documentation.service';
import { OrderInquiryService } from './services/order-inquiry.service';
import { OrderFinancialService } from './services/order-financial.service';
import { OrderSupplierService } from './services/order-supplier.service';
import { OrderPdfService } from './services/order-pdf.service';
import { OrderCommunicationService } from './services/order-communication.service';
import { OrderSearchService } from './services/order-search.service';
import { OrderSaveService } from './services/order-save.service';
import { OrderInventoryService } from './services/order-inventory.service';
import { OrderPlattsService } from './services/order-platts.service';
import { DateFormatService } from '@app/core/services/date-format.service';
import { OrderBrokerService } from './services/order-broker.service';
import { OrderAgentService } from './services/order-agent.service';
import { OrderActionService } from './services/order-action.service';
import { CreditApplicationModalComponent } from '../../../credit/components/credit-application-modal.component';

// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  Order Detail Page — Full order view with editable items grid
// ═══════════════════════════════════════════════════════════════════════

import { API_URL, toAbsoluteUrl } from '@app/core/config/api';
import type {
  InquirySupplierPerformance,
  InquirySupplierComparisonRow,
  InquiryQuoteMatrixRow,
  SupplierInquiryReplyRow,
  SupplierInquiryReplyItem,
  InquiryReplyRecommendation,
} from './order-detail.types';

@Component({
  selector: 'app-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    OrderItemsComponent,
    OrderFinancingSummaryComponent,
    HeaderActionsComponent,
    SendEmailModalComponent,
    SendInquiryModalComponent,
    CommentsCardComponent,
    ActivityTimelineComponent,
    EmailHistoryCardComponent,
    PdfPreviewModalComponent,
    TradingDetailHeaderComponent,
    TradingDetailMetaCardsComponent,
    InternalTransferSummaryComponent,
    InternalTransferSidesComponent,
    CreditApplicationModalComponent,
    OrderPaymentTermsCardComponent,
    OrderNotesTermsCardComponent,
    OrderDeliveryCardComponent,
    OrderPaymentsCardComponent,
    OrderAttachmentsCardComponent,
    OrderSettingsDropdownComponent,
    OrderPlattsSignalsComponent,
    OrderSecondaryTabsComponent,
    OrderPaymentModalComponent,
    OrderConvertModalComponent,
    OrderCancelModalComponent,
    OrderPlaceRemarkPromptComponent,
    OrderSuppliersTabComponent,
    OrderCaptureTabComponent,
  ],
  templateUrl: 'order-detail-page.component.html',
  styles: [
    `
      .fueld-clamp-1 {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
      }
      .fueld-clamp-2 {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
    `,
  ],
})
export class OrderDetailPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  protected readonly refData = inject(OrderReferenceDataService);
  protected readonly replySvc = inject(OrderReplyService);
  private readonly orderLoader = inject(OrderLoaderService);
  readonly portDocSvc = inject(OrderPortDocumentationService);
  protected readonly inquirySvc = inject(OrderInquiryService);
  protected readonly financialSvc = inject(OrderFinancialService);
  protected readonly supplierSvc = inject(OrderSupplierService);
  protected readonly pdfSvc = inject(OrderPdfService);
  protected readonly commSvc = inject(OrderCommunicationService);
  protected readonly searchSvc = inject(OrderSearchService);
  protected readonly saveSvc = inject(OrderSaveService);
  protected readonly inventorySvc = inject(OrderInventoryService);
  protected readonly brokerSvc = inject(OrderBrokerService);
  protected readonly agentSvc = inject(OrderAgentService);
  protected readonly plattsSvc = inject(OrderPlattsService);
  protected readonly dateFormatSvc = inject(DateFormatService);
  protected readonly actionSvc = inject(OrderActionService);

  readonly emailModal = viewChild(SendEmailModalComponent);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);
  readonly inquiryModal = viewChild(SendInquiryModalComponent);
  readonly financingSummaryContainer = viewChild<ElementRef<HTMLElement>>('financingSummaryContainer');

  // ─── Email compose state ─────────────────────────────────────────

  /** Which document type is currently being composed for email */
  readonly emailDocumentType = signal<DocumentEmailType>('INVOICE');
  /** Display name for the PDF attachment in the compose modal */
  readonly emailPdfFileName = signal('');

  // ─── Route param ─────────────────────────────────────────────────

  readonly orderId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly order = signal<OrderDto | null>(null);
  readonly client = signal<CounterpartyDto | null>(null);
  readonly supplier = signal<CounterpartyDto | null>(null);
  readonly agent = this.agentSvc.agent;
  readonly vessel = signal<VesselDto | null>(null);
  readonly port = signal<PlaceDto | null>(null);
  readonly suppliers = signal<CounterpartyDto[]>([]);
  readonly agents = this.agentSvc.agents;
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vessels = signal<VesselDto[]>([]);
  readonly places = signal<PlaceDto[]>([]);
  readonly itemRows = signal<OrderItemRow[]>([]);
  readonly inquiryItems = computed(() =>
    this.itemRows().map((r) => ({ productType: r.productType, quantity: r.quantity, quantityMin: r.quantityMin, unit: r.costUnit ?? r.unit })),
  );

  // ─── Inventory (physical-ops) state ─────────────────────────────────
  /** Delegate availability checks to the inventory service. */
  readonly availabilityByRowId = this.inventorySvc.availabilityByRowId;

  /** Warehouses tied to the current order's client or supplier (so inventory pickers show useful options only). */
  readonly availableWarehouses = computed<WarehouseDto[]>(() => {
    const order = this.order();
    if (!order) return [];
    const relevantCompanyIds = new Set<string>();
    if (order.clientId) relevantCompanyIds.add(order.clientId);
    if (order.supplierId) relevantCompanyIds.add(order.supplierId);
    for (const supplier of this.orderSuppliers()) {
      if (supplier.companyId) relevantCompanyIds.add(supplier.companyId);
    }
    return this.refData.allWarehouses().filter((w) =>
      w.active && w.inventoryEnabled && relevantCompanyIds.has(w.ownerCompanyId),
    );
  });

  readonly warehouseDropdownOptions = computed<DropdownOption[]>(() =>
    this.availableWarehouses().map((w) => ({
      value: w.id,
      label: w.vesselName ? `${w.name} · ${w.vesselName}` : w.name,
    })),
  );

  readonly inventorySkuDropdownOptions = computed<DropdownOption[]>(() =>
    this.refData.inventorySkus()
      .filter((s) => s.active && s.inventoryTracked)
      .map((s) => ({
        value: s.id,
        label: s.grade ? `${s.displayName} (${s.grade})` : s.displayName,
      })),
  );

  /** True when any tracked line currently fails the availability check. */
  readonly hasInventoryShortage = computed(() => {
    const map = this.availabilityByRowId();
    return Object.values(map).some((a) => a && !a.ok);
  });

  // ─── Internal transfer state ────────────────────────────────────────
  readonly transfer = signal<OrderTransferDto | null>(null);
  readonly isInternalTransfer = computed(() => this.order()?.orderKind === 'INTERNAL_TRANSFER');
  readonly itemEconomics = signal<OrderItemsEconomics>({
    totalQuantity: 0,
    totalCost: 0,
    totalRevenue: 0,
    totalGrossProfit: 0,
    totalFinancingCost: 0,
    financingCostPerMt: null,
    totalNetProfit: 0,
    netMarginPct: null,
  });
  readonly itemDisplayCurrency = signal('USD');
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly invoiceNumber = signal('');
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);

  readonly selectedOwnCompany = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return null;
    return this.ownCompanies().find((c) => c.id === id) ?? null;
  });
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly clientSearchLoading = signal(false);
  readonly supplierSearchLoading = signal(false);
  readonly agentSearchLoading = this.agentSvc.agentSearchLoading;
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly attachments = signal<OrderAttachmentDto[]>([]);
  readonly supplierNomination = signal<SupplierNominationSummaryDto | null>(null);
  readonly orderSuppliers = signal<OrderSupplierDto[]>([]);
  readonly activeOrderSupplierId = signal<string | null>(null);
  readonly uploadingAttachment = signal(false);
  readonly attachmentType = signal('OTHER');
  selectedAttachment: File | null = null;
  readonly payments = signal<CustomerPaymentDto[]>([]);
  readonly paymentsLoading = signal(false);
  readonly portDocumentationContext = computed(() => this.portDocSvc.portDocumentationContext());
  readonly portDocumentationLoading = computed(() => this.portDocSvc.portDocumentationLoading());
  readonly portDocumentationError = computed(() => this.portDocSvc.portDocumentationError());
  readonly portDocumentationAction = computed(() => this.portDocSvc.portDocumentationAction());
  readonly bunkerInstructionsPreview = computed(() => this.portDocSvc.bunkerInstructionsPreview());
  // Credit line signals delegate to OrderFinancialService — the service owns the
  // HTTP loading calls, so the component must read from the same source to avoid
  // stale/empty signals (previous bug: component had its own signals that were
  // never populated because all load calls went to financialSvc).
  readonly customerCreditLines = computed(() => this.financialSvc.customerCreditLines());
  readonly customerCreditLoading = computed(() => this.financialSvc.customerCreditLoading());
  readonly customerCreditFrozen = computed(() => this.financialSvc.customerCreditFrozen());
  readonly supplierCreditLines = computed(() => this.financialSvc.supplierCreditLines());
  readonly supplierCreditLoading = computed(() => this.financialSvc.supplierCreditLoading());
  readonly noteTab = signal<'customer' | 'supplier'>('customer');
  readonly showCustomerPaymentNote = signal(false);
  readonly showSupplierPaymentNote = signal(false);
  readonly paymentModalRef = viewChild(OrderPaymentModalComponent);
  readonly todayLocalDateString = () => this.formatDateForInput(new Date(), this.placeTimezone());
  readonly convertModalRef = viewChild(OrderConvertModalComponent);
  readonly cancelModalRef = viewChild(OrderCancelModalComponent);
  readonly remarkPromptRef = viewChild(OrderPlaceRemarkPromptComponent);
  readonly activeDetailTab = signal('comments');
  readonly convertingToOrder = signal(false);
  readonly cancellingInquiry = signal(false);
  readonly availableInquiryCancelReasons = computed(() =>
    this.refData.inquiryCancelReasons().map((reason: string) => reason.trim()).filter(Boolean),
  );
  readonly cancellationTargetLabel = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Inquiry || status === OrderStatus.Offer ? 'inquiry' : 'order';
  });
  readonly plattsSuggestions = this.plattsSvc.suggestions;
  readonly plattsSuggestionsLoading = this.plattsSvc.loading;
  readonly plattsSuggestionsError = this.plattsSvc.error;
  readonly plattsSignalsMaxHeight = this.plattsSvc.maxHeight;
  readonly plattsSuggestionItems = this.plattsSvc.suggestionItems;
  readonly plattsSuggestionsMeta = this.plattsSvc.suggestions;

  /** Whether the user has linked WhatsApp in Settings */
  readonly waLinked = this.commSvc.waLinked;
  readonly inquirySupplierContextLoading = signal(false);
  readonly inquirySupplierContext = signal<InquirySupplierComparisonRow[]>([]);
  readonly inquiryRepliesLoading = signal(false);
  readonly inquiryRepliesSavingId = this.replySvc.replySavingId;
  readonly inquiryReplies = signal<SupplierInquiryReplyRow[]>([]);
  readonly editingInquiryReplyId = this.replySvc.editingReplyId;

  // ─── Terms UI (collapsed by default) ─────────────────────────────

  readonly showPlaceRemarkFull = signal(false);
  readonly showPlaceRemarkPrompt = signal(false);
  readonly pendingPlaceRemark = signal<string | null>(null);
  readonly showCustomerTermsFull = signal(false);
  readonly showSupplierTermsFull = signal(false);

  readonly customerTermsText = computed(() => {
    const orderTerms = this.order()?.termsAndConditions;
    if (orderTerms) return this.renderCompanyTerms(orderTerms, 'customer') || '';
    const specialTerms = this.client()?.specialCustomerTerms;
    if (specialTerms) return this.renderCompanyTerms(specialTerms, 'customer') || '';
    return this.renderCompanyTerms(this.selectedOwnCompany()?.customerTerms, 'customer') || '';
  });

  readonly supplierTermsText = computed(() =>
    this.renderCompanyTerms(this.selectedOwnCompany()?.supplierTerms, 'supplier') || '',
  );

  // ─── Contact persons ─────────────────────────────────────────────

  readonly customerContact = signal<CompanyContactDto | null>(null);
  readonly supplierContact = signal<CompanyContactDto | null>(null);
  readonly agentContact = this.agentSvc.agentContact;
  readonly customerContacts = signal<CompanyContactDto[]>([]);
  readonly supplierContacts = signal<CompanyContactDto[]>([]);
  readonly agentContacts = this.agentSvc.agentContacts;
  readonly brokerContact = this.brokerSvc.brokerContact;
  readonly brokerContacts = this.brokerSvc.brokerContacts;

  // ─── Broker search ──────────────────────────────────────────────

  readonly brokers = this.brokerSvc.brokers;
  readonly brokerSearchLoading = this.brokerSvc.brokerSearchLoading;

  // ─── Autosave ────────────────────────────────────────────────────

  readonly autoSaving = this.saveSvc.autoSaving;
  readonly lastSaved = this.saveSvc.lastSaved;
  readonly draftItemIds = this.saveSvc.draftItemIds;

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly activeOrderSupplier = computed(() => {
    const suppliers = this.orderSuppliers();
    const activeId = this.activeOrderSupplierId();
    return suppliers.find((supplier) => supplier.id === activeId)
      ?? suppliers.find((supplier) => supplier.isPrimary)
      ?? suppliers[0]
      ?? null;
  });
  readonly hasMultipleOrderSuppliers = computed(() => this.orderSuppliers().length > 1);
  readonly supplierName = computed(() => {
    return this.activeOrderSupplier()?.company?.name
      ?? this.supplier()?.name
      ?? '—';
  });
  readonly activeSupplierCompanyId = computed(() => this.activeOrderSupplier()?.companyId ?? this.order()?.supplierId ?? '');
  readonly activeSupplierContactId = computed(() => this.activeOrderSupplier()?.contactId ?? this.order()?.supplierContactId ?? '');
  readonly activeSupplierContactName = computed(() => this.activeOrderSupplier()?.contact?.name ?? this.supplierContact()?.name ?? '');
  readonly activeSupplierPaymentTermType = computed(() => this.activeOrderSupplier()?.paymentTermType ?? this.order()?.supplierPaymentTermType ?? null);
  readonly activeSupplierCreditDays = computed(() => this.activeOrderSupplier()?.creditDays ?? this.order()?.supplierCreditDays ?? null);
  readonly activeSupplierNote = computed(() => this.activeOrderSupplier()?.note ?? this.order()?.supplierNote ?? null);
  readonly activeSupplierDeliveredAt = computed(() => this.activeOrderSupplier()?.deliveredAt ?? this.order()?.deliveredAt ?? null);
  readonly nominationOrderSupplierId = computed(() => {
    const activeSupplier = this.activeOrderSupplier();
    return this.emailDocumentType() === 'NOMINATION' ? (activeSupplier ? activeSupplier.id : null) : null;
  });
  readonly emailModalDefaultPhone = computed(() => {
    if (this.emailDocumentType() === 'NOMINATION') {
      return this.activeOrderSupplier()?.contact?.phone
        ?? this.supplierContact()?.phone
        ?? null;
    }

    if (this.order()?.brokerGetsAll && this.brokerContact()?.phone) {
      return this.brokerContact()?.phone ?? null;
    }

    return this.customerContact()?.phone ?? null;
  });
  readonly orderSupplierTabs = computed(() => this.orderSuppliers().map((supplier, index) => ({
    id: supplier.id,
    label: supplier.company?.name ?? `Supplier ${index + 1}`,
    isPrimary: supplier.isPrimary,
  })));
  readonly brokerName = this.brokerSvc.brokerName;
  readonly brokerDropdownOptions = this.brokerSvc.brokerDropdownOptions;
  readonly brokerContactDropdownOptions = this.brokerSvc.brokerContactDropdownOptions;
  readonly agentName = this.agentSvc.agentName;
  readonly agentDropdownOptions = this.agentSvc.agentDropdownOptions;
  readonly agentContactDropdownOptions = this.agentSvc.agentContactDropdownOptions;
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');
  readonly subtitle = computed(() => '');
  readonly invoicingCompanyName = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return '—';
    const co = this.ownCompanies().find((c) => c.id === id);
    return co?.name ?? '—';
  });

  readonly isInquiryContext = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Inquiry || status === OrderStatus.Offer;
  });

  readonly isReadonly = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced
      || status === OrderStatus.Paid
      || status === OrderStatus.Cancelled;
  });

  readonly allowDeliveredEdit = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Confirmed
      || status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced;
  });

  readonly allowBankAccountEdit = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Delivered || status === OrderStatus.Invoiced;
  });

  readonly deliveredAtLocal = computed(() => {
    const iso = this.activeSupplierDeliveredAt();
    if (!iso) return '';
    return formatStoredDateOnlyForInputZoned(iso, this.placeTimezone());
  });

  readonly deliveredQtyComplete = computed(() =>
    this.itemRows().length > 0
    && this.itemRows().every((row) => this.getEffectiveDeliveredQuantity(row) !== null),
  );
  readonly supplierNominationDateMismatch = computed(() => {
    const internalDate = this.activeSupplierDeliveredAt()?.slice(0, 10) ?? null;
    const supplierDate = this.supplierNomination()?.deliveryCompletedAt?.slice(0, 10) ?? null;
    return !!internalDate && !!supplierDate && internalDate !== supplierDate;
  });

  readonly hasDeliveryDocumentation = computed(() => {
    const allowedTypes = this.refData.deliveryDocumentationSettings().deliveryDocumentationTypes;
    return this.attachments().some((att) => allowedTypes.includes((att.type ?? '').toUpperCase()));
  });
  readonly invoiceEmailAttachmentOptions = computed<SendEmailAttachmentOption[]>(() => {
    const allowedTypes = this.refData.deliveryDocumentationSettings().deliveryDocumentationTypes;
    return this.attachments()
      .filter((att) => allowedTypes.includes((att.type ?? '').toUpperCase()))
      .map((att) => ({
        id: att.id,
        fileName: att.fileName,
        label: `${att.type ?? 'Doc'} uploaded ${new Date(att.createdAt).toLocaleDateString('en-GB')}`,
        previewUrl: att.filePath.startsWith('http') ? att.filePath : `${API_URL}${att.filePath}`,
      }));
  });
  readonly portDocumentationEmailAttachmentOptions = computed<SendEmailAttachmentOption[]>(() =>
    (this.portDocumentationContext()?.documents ?? [])
      .filter((doc) => String(doc.status ?? '').toUpperCase() === 'ACTIVE')
      .map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        label: `${this.portDocSvc.humanizeDocumentKind(doc.documentKind)} · ${this.portDocSvc.humanizeDocumentSource(doc.sourceType)}`,
        previewUrl: `${API_URL}/orders/${this.order()?.id ?? this.orderId()}/port-documentation/documents/${doc.id}/download`,
      })),
  );
  readonly emailAttachmentOptions = computed<SendEmailAttachmentOption[]>(() => {
    if (this.emailDocumentType() === 'INVOICE') {
      return this.invoiceEmailAttachmentOptions();
    }
    if (this.emailDocumentType() === 'PORT_DOCUMENTATION') {
      return this.portDocumentationEmailAttachmentOptions();
    }
    return [];
  });

  readonly isPaidOrCancelled = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Paid || status === OrderStatus.Cancelled;
  });


  readonly canRecordPayment = computed(() => this.order()?.status !== OrderStatus.Cancelled);

  readonly canEditClient = computed(() => !this.isPaidOrCancelled());
  readonly hasInvoicingCompany = computed(() => !!this.order()?.invoicingCompanyId);
  readonly hasSupplier = computed(() => this.orderSuppliers().length > 0 || !!this.order()?.supplierId);
  readonly itemSupplierOptions = computed<DropdownOption[]>(() =>
    this.orderSuppliers().map((supplier, index) => ({
      value: supplier.id,
      label: supplier.company?.name ?? `Supplier ${index + 1}`,
    })),
  );
  readonly hasBankAccount = computed(() => !!this.order()?.bankAccountId);
  readonly hasEta = computed(() => !!this.order()?.eta);
  readonly hasLineItems = computed(() => this.itemRows().length > 0);

  readonly isResponsibleUser = computed(() => {
    const currentUserId = this.auth.user()?.id ?? '';
    return !!currentUserId && this.order()?.salesRepId === currentUserId;
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() => {
    const activeSupplierId = this.activeOrderSupplier()?.id ?? null;
    const selectedCompanyIds = new Set(
      this.orderSuppliers()
        .filter((supplier) => supplier.id !== activeSupplierId)
        .map((supplier) => supplier.companyId)
        .filter((companyId) => !!companyId),
    );

    return this.suppliers()
      .filter((supplier) => !selectedCompanyIds.has(supplier.id))
      .map((supplier) => ({ value: supplier.id, label: supplier.name }));
  });

  private mergeKnownSuppliers(additionalSuppliers: Array<CounterpartyDto | null | undefined>): void {
    const merged = new Map<string, CounterpartyDto>();

    for (const supplier of this.suppliers()) {
      if (supplier?.id) merged.set(supplier.id, supplier);
    }

    for (const supplier of additionalSuppliers) {
      if (supplier?.id) merged.set(supplier.id, supplier);
    }

    this.suppliers.set([...merged.values()]);
  }

  readonly clientDropdownOptions = computed<DropdownOption[]>(() =>
    this.clients().map((c) => ({ value: c.id, label: c.name })),
  );

  readonly vesselDropdownOptions = computed<DropdownOption[]>(() =>
    this.vessels().map((v) => ({ value: v.id, label: v.name })),
  );

  readonly placeDropdownOptions = computed<DropdownOption[]>(() =>
    this.places().map((p) => ({
      value: p.id,
      label: p.unlocode ? `${p.name} (${p.unlocode.replace(/\s+/g, '')})` : p.name,
    })),
  );

  readonly responsibleUserOptions = computed<DropdownOption[]>(() =>
    this.refData.teamUsers().map((u: { id: string; name: string }) => ({ value: u.id, label: u.name })),
  );

  readonly customerContactDropdownOptions = computed(() =>
    this.customerContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly supplierContactDropdownOptions = computed(() =>
    this.supplierContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly placeTimezone = computed(() => this.port()?.timezone ?? 'UTC');
  readonly placeTimezoneAbbr = computed(() => {
    const tz = this.placeTimezone();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
    } catch {
      return tz;
    }
  });
  readonly etaMinDateTime = computed(() => {
    const eta = this.order()?.eta;
    if (!eta) return '';
    return formatStoredDateOnlyForInputZoned(eta, this.placeTimezone());
  });

  readonly paymentsTotal = computed(() =>
    this.payments().reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
  );

  readonly totalDueForMarkPaid = computed(() =>
    this.itemRows().reduce((sum, item) => {
      const qty = Number(item.deliveredQuantity ?? item.quantity ?? 0);
      const unitPrice = Number(item.salesPrice ?? 0);
      return sum + qty * unitPrice;
    }, 0),
  );

  readonly hasEnoughPaymentsForMarkPaid = computed(() => {
    const due = this.totalDueForMarkPaid();
    if (due <= 0) return false;
    return this.paymentsTotal() >= due;
  });

  readonly customerCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.customerCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseCustomerCredit = computed(() => !!this.customerCreditSummary() && !this.customerCreditFrozen());

  readonly supplierCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.supplierCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseSupplierCredit = computed(() => !!this.supplierCreditSummary());

  readonly financingRateAnnual = computed(() => this.order()?.financingRateAnnual ?? 0.08);
  readonly financingDayCountConvention = computed(() => this.order()?.financingDayCountConvention ?? 365);
  readonly financingDays = computed(() => {
    const customerDays = this.order()?.customerPaymentTermType === 'CREDIT'
      ? Math.max(0, this.order()?.customerCreditDays ?? 0)
      : 0;
    const supplierDays = this.order()?.supplierPaymentTermType === 'CREDIT'
      ? Math.max(0, this.order()?.supplierCreditDays ?? 0)
      : 0;
    return Math.max(customerDays - supplierDays, 0);
  });

  readonly rankedInquirySuppliers = computed(() =>
    [...this.inquirySupplierContext()].sort((left, right) => this.compareInquirySupplierPerformance(left, right)).slice(0, 6),
  );

  readonly selectedSupplierComparison = computed(() => {
    const supplierId = this.order()?.supplierId ?? null;
    if (supplierId) {
      return this.inquirySupplierContext().find((row) => row.supplierId === supplierId) ?? null;
    }
    return this.rankedInquirySuppliers()[0] ?? null;
  });

  readonly sortedInquiryReplies = computed(() => {
    const selectedSupplierId = this.order()?.supplierId ?? null;
    return [...this.inquiryReplies()].sort((left, right) => {
      const selectedDiff = Number(right.supplierId === selectedSupplierId) - Number(left.supplierId === selectedSupplierId);
      if (selectedDiff !== 0) return selectedDiff;
      const rightSentAt = right.sentAt ? Date.parse(right.sentAt) : 0;
      const leftSentAt = left.sentAt ? Date.parse(left.sentAt) : 0;
      return rightSentAt - leftSentAt;
    });
  });

  readonly inquiryQuoteMatrixRows = computed<InquiryQuoteMatrixRow[]>(() => {
    const replies = this.sortedInquiryReplies();
    if (replies.length === 0) return [];

    const itemOrder = this.itemRows().map((item) => item.id);
    const replyItemMap = new Map<string, Map<string, SupplierInquiryReplyItem>>(
      replies.map((reply) => [
        reply.id,
        new Map(reply.items.map((item) => [item.orderItemId, item])),
      ]),
    );
    const fallbackItems = replies.flatMap((reply) => reply.items);
    const orderItemIds = itemOrder.length > 0
      ? itemOrder
      : Array.from(new Set(fallbackItems.map((item) => item.orderItemId)));
    const selectedSupplierId = this.order()?.supplierId ?? null;
    const defaultCurrency = this.order()?.currency ?? 'USD';

    return orderItemIds.map((orderItemId) => {
      const localItem = this.itemRows().find((item) => item.id === orderItemId);
      const fallbackItem = fallbackItems.find((item) => item.orderItemId === orderItemId) ?? null;

      return {
        orderItemId,
        productType: fallbackItem?.productType ?? localItem?.productType ?? '',
        quantity: fallbackItem?.quantity ?? String(localItem?.quantity ?? ''),
        quantityMin: localItem?.quantityMin != null ? String(localItem.quantityMin) : null,
        unit: fallbackItem?.unit ?? localItem?.unit ?? '',
        description: fallbackItem?.description ?? localItem?.description ?? null,
        cells: replies.map((reply) => {
          const replyItem = replyItemMap.get(reply.id)?.get(orderItemId) ?? null;
          return {
            supplierInquiryId: reply.id,
            supplierId: reply.supplierId,
            supplierName: reply.supplierName,
            status: reply.status,
            price: replyItem?.price ?? null,
            currency: replyItem?.currency ?? fallbackItem?.currency ?? defaultCurrency,
            note: replyItem?.note ?? null,
            responseHours: reply.responseHours,
            isSelectedSupplier: selectedSupplierId === reply.supplierId,
          };
        }),
      };
    });
  });

  readonly inquiryReplyRecommendations = computed(() => {
    const replies = this.sortedInquiryReplies();
    const recommendations = new Map<string, InquiryReplyRecommendation>();
    if (replies.length === 0) return recommendations;

    const totals = replies.map((reply) => ({
      id: reply.id,
      lineCount: reply.quoteLineCount,
      total: reply.items.reduce((sum, item) => sum + Number(item.price ?? 0), 0),
      responseHours: reply.responseHours,
    }));

    const maxLineCount = Math.max(...totals.map((entry) => entry.lineCount), 0);
    const minComparableTotal = Math.min(...totals.filter((entry) => entry.lineCount > 0).map((entry) => entry.total), Number.POSITIVE_INFINITY);
    const minResponseHours = Math.min(...totals.filter((entry) => entry.responseHours != null).map((entry) => entry.responseHours as number), Number.POSITIVE_INFINITY);

    const scored = totals.map((entry) => {
      const responseScore = entry.responseHours == null ? 0 : Math.max(0, 48 - Math.min(48, entry.responseHours));
      const totalScore = Number.isFinite(minComparableTotal) && entry.lineCount > 0
        ? Math.max(0, minComparableTotal === 0 ? 10 : (minComparableTotal / Math.max(entry.total, minComparableTotal)) * 10)
        : 0;
      return {
        ...entry,
        score: Number((entry.lineCount * 10 + responseScore + totalScore).toFixed(1)),
      };
    });

    const bestScore = Math.max(...scored.map((entry) => entry.score), 0);

    for (const entry of scored) {
      recommendations.set(entry.id, {
        bestOverall: entry.score === bestScore && bestScore > 0,
        lowestComparable: Number.isFinite(minComparableTotal) && entry.lineCount > 0 && entry.total === minComparableTotal,
        mostComplete: entry.lineCount > 0 && entry.lineCount === maxLineCount,
        fastest: Number.isFinite(minResponseHours) && entry.responseHours === minResponseHours,
        score: entry.score,
      });
    }

    return recommendations;
  });

  formatDateTimeForInput(date: Date, timeZone: string): string {
    const fixedOffset = parseFixedOffsetMinutes(timeZone);
    if (fixedOffset !== null) {
      const shifted = new Date(date.getTime() + fixedOffset * 60_000);
      const year = String(shifted.getUTCFullYear()).padStart(4, '0');
      const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const day = String(shifted.getUTCDate()).padStart(2, '0');
      const hour = String(shifted.getUTCHours()).padStart(2, '0');
      const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    const safeTimeZone = normalizeTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = map.get('year') ?? '0000';
    const month = map.get('month') ?? '01';
    const day = map.get('day') ?? '01';
    const hour = map.get('hour') ?? '00';
    const minute = map.get('minute') ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  formatDateForInput(date: Date, timeZone: string): string {
    return this.formatDateTimeForInput(date, timeZone).split('T')[0] ?? '';
  }

  formatStoredDateOnlyLabel(iso: string | null): string {
    return this.dateFormatSvc.formatDateLabel(iso);
  }


  private _initialLoadComplete = false;
  private _autosavePaused = false;

  constructor() {
    // Reactive autosave — watches mutable signals; fires on any change
    effect((onCleanup) => {
      this.order();
      this.itemRows();
      this.orderSuppliers();
      if (!this._initialLoadComplete || this._autosavePaused) return;

      const timer = setTimeout(() => this.performAutoSave(), 1500);
      onCleanup(() => clearTimeout(timer));
    });

    effect(() => {
      const orderId = this.orderId();
      const activeSupplier = this.activeOrderSupplier();
      if (!orderId || !activeSupplier || !this._initialLoadComplete) return;
      void this.financialSvc.loadSupplierCreditLines(activeSupplier.companyId);
      void this.loadCompanyContacts('supplier', activeSupplier.companyId);
      void this.loadSupplierNominationSummary();
    });
  }

  ngOnInit(): void {
    this.loadOrder();
    this.checkWhatsAppLinked();
    this.dateFormatSvc.load();
  }

  ngAfterViewInit(): void {
    // View init done
  }

  ngOnDestroy(): void {
    this.saveSvc.cancelAutoSave();
    this.plattsSvc.cancelTimer();
  }



  private detailBaseRouteForStatus(status: string):
    '/trading/orders'
    | '/trading/inquiries'
    | '/trading/delivered-orders'
    | '/trading/completed-orders'
    | '/trading/cancelled-orders' {
    if (status === OrderStatus.Inquiry || status === OrderStatus.Offer) {
      return '/trading/inquiries';
    }
    if (status === OrderStatus.Delivered) {
      return '/trading/delivered-orders';
    }
    if (status === OrderStatus.Paid) {
      return '/trading/completed-orders';
    }
    if (status === OrderStatus.Cancelled) {
      return '/trading/cancelled-orders';
    }
    return '/trading/orders';
  }

  private async normalizeDetailRoute(status: string, routeId: string): Promise<void> {
    const currentPath = this.router.url.split('?')[0]?.split('#')[0] ?? '';
    const expectedBase = this.detailBaseRouteForStatus(status);
    const isOnOrdersPath = currentPath.startsWith('/trading/orders/');
    const isOnInquiriesPath = currentPath.startsWith('/trading/inquiries/');
    const isOnDeliveredPath = currentPath.startsWith('/trading/delivered-orders/');
    const isOnCompletedPath = currentPath.startsWith('/trading/completed-orders/');
    const isOnCancelledPath = currentPath.startsWith('/trading/cancelled-orders/');

    const isAlreadyOnExpectedPath =
      (expectedBase === '/trading/orders' && isOnOrdersPath)
      || (expectedBase === '/trading/inquiries' && isOnInquiriesPath)
      || (expectedBase === '/trading/delivered-orders' && isOnDeliveredPath)
      || (expectedBase === '/trading/completed-orders' && isOnCompletedPath)
      || (expectedBase === '/trading/cancelled-orders' && isOnCancelledPath);

    if (!isAlreadyOnExpectedPath) {
      await this.router.navigate([expectedBase, routeId], {
        replaceUrl: true,
        queryParamsHandling: 'preserve',
      });
    }
  }

  private async loadOrder(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const r = await this.orderLoader.load(id);
      if (!r.order) { this.showToast('error', 'Failed to load order.'); return; }
      this.order.set(r.order);
      this.customerContact.set(r.customerContact);
      this.supplierContact.set(r.supplierContact);
      this.brokerContact.set(r.brokerContact);
      this.agentContact.set(r.agentContact);
      this.brokers.set(r.broker ? [r.broker] : []);
      this.agentSvc.agent.set(r.agent ?? null);
      this.agentSvc.agents.set(r.agent ? [r.agent] : []);
      this.agentSvc.agentContact.set(r.agentContact ?? null);
      this.client.set(r.client);
      if (r.client) this.clients.set([r.client]);
      this.supplier.set(r.supplier);
      this.mergeKnownSuppliers([r.supplier, ...(r.orderSuppliers?.map((s) => s.company) ?? [])]);
      this.orderSuppliers.set(r.orderSuppliers ?? []);
      this.activeOrderSupplierId.set(r.orderSuppliers?.find((s) => s.isPrimary)?.id ?? r.orderSuppliers?.[0]?.id ?? null);
      if (r.vessel) { this.vessel.set(r.vessel); this.vessels.set([r.vessel]); }
      if (r.port) { this.port.set(r.port); this.places.set([r.port]); }
      this.itemRows.set(r.items);
      this.saveSvc.draftItemIds.set(new Set());
      await this.normalizeDetailRoute(r.order.status, id);
      this.scheduleAvailabilityChecks();
      // Parallelize independent API calls for faster page load
      await Promise.all([
        this.financialSvc.loadCustomerCreditLines(r.order.clientId),
        this.financialSvc.loadSupplierCreditLines(this.activeOrderSupplier()?.companyId ?? r.order.supplierId),
        this.loadReferenceData(),
        this.inquirySvc.loadSupplierContext(this.orderId()),
        r.order.orderKind === 'INTERNAL_TRANSFER' ? this.loadInternalTransfer() : Promise.resolve(),
        this.loadCompanyContacts('customer', r.order.clientId).catch(() => {}),
        (() => { const id = this.activeOrderSupplier()?.companyId ?? r.order.supplierId; return id ? this.loadCompanyContacts('supplier', id).catch(() => {}) : Promise.resolve(); })(),
        r.order.brokerId ? this.loadCompanyContacts('broker', r.order.brokerId).catch(() => {}) : Promise.resolve(),
        r.order.agentId ? this.loadCompanyContacts('agent', r.order.agentId).catch(() => {}) : Promise.resolve(),
        this.inquirySvc.loadSupplierContext(this.orderId()),
        this.inquirySvc.loadReplies(this.orderId()),
        this.loadAttachments(),
        this.loadPayments(),
        this.portDocSvc.load(this.orderId()),
        this.loadSupplierNominationSummary(),
      ]);
      if (r.order.orderKind !== 'INTERNAL_TRANSFER') {
        this.transfer.set(null);
      }
      let invoicingId = this.order()?.invoicingCompanyId ?? null;
      if (r.ownCompanies.length) {
        this.ownCompanies.set(r.ownCompanies);
        invoicingId = this.applyPreferredInvoicingCompanySelection(r.ownCompanies);
      }
      if (invoicingId) await this.loadBankAccounts(invoicingId, { autoSelect: true });
      else this.bankAccounts.set([]);
      if (this.order()?.customerNote) this.showCustomerPaymentNote.set(true);
      if (this.order()?.supplierNote) this.showSupplierPaymentNote.set(true);
    } catch { this.showToast('error', 'Failed to load order.'); }
    this._initialLoadComplete = true;
  }

  private async loadPortDocumentationContext(): Promise<void> {
    await this.portDocSvc.load(this.orderId());
  }

  async previewBunkerInstructions(): Promise<void> {
    await this.portDocSvc.previewBunkerInstructions(this.orderId(), this.activeOrderSupplier()?.id ?? null);
    await this.loadPortDocumentationContext();
  }

  async generateBunkerInstructions(): Promise<void> {
    await this.portDocSvc.generateBunkerInstructions(this.orderId(), this.activeOrderSupplier()?.id ?? null);
    await this.loadPortDocumentationContext();
    this.showToast('success', 'Bunker Instructions generated.');
  }

  async generateGateList(): Promise<void> {
    await this.portDocSvc.generateGateList(this.orderId());
    await this.loadPortDocumentationContext();
    this.showToast('success', 'Gate List generated.');
  }

  async includeFlangeWorksheetDocument(): Promise<void> {
    await this.portDocSvc.includeFlangeWorksheetDocument(this.orderId());
    await this.loadPortDocumentationContext();
    this.showToast('success', 'Flange Worksheet included on the order.');
  }

  async downloadPortDocumentationDocument(doc: OrderPortDocumentDto): Promise<void> {
    await this.portDocSvc.downloadDocument(this.orderId(), doc);
  }

  private async loadAttachments(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderAttachmentDto[]>>(`${API_URL}/orders/${id}/attachments`),
      );
      if (res.success) this.attachments.set(res.data ?? []);
    } catch {
      this.attachments.set([]);
    }
  }

  private async loadSupplierNominationSummary(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const activeSupplierId = this.hasMultipleOrderSuppliers() ? this.activeOrderSupplier()?.id : null;
    const query = activeSupplierId ? `?orderSupplierId=${encodeURIComponent(activeSupplierId)}` : '';
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierNominationSummaryDto | null>>(`${API_URL}/orders/${id}/nomination-response${query}`),
      );
      this.supplierNomination.set(res.success ? (res.data ?? null) : null);
    } catch {
      this.supplierNomination.set(null);
    }
  }

  private async loadInquirySupplierContext(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.isInquiryContext()) {
      this.inquirySupplierContext.set([]);
      return;
    }

    this.inquirySupplierContextLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquirySupplierComparisonRow[]>>(`${API_URL}/orders/${id}/inquiry/suppliers`),
      );
      if (res.success) {
        this.inquirySupplierContext.set(res.data ?? []);
      } else {
        this.inquirySupplierContext.set([]);
      }
    } catch {
      this.inquirySupplierContext.set([]);
    } finally {
      this.inquirySupplierContextLoading.set(false);
    }
  }

  private async loadInquiryReplies(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.isInquiryContext()) {
      this.inquiryReplies.set([]);
      return;
    }

    this.inquiryRepliesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierInquiryReplyRow[]>>(`${API_URL}/orders/${id}/inquiry/sent`),
      );
      if (res.success) {
        this.inquiryReplies.set(res.data ?? []);
      } else {
        this.inquiryReplies.set([]);
      }
    } catch {
      this.inquiryReplies.set([]);
    } finally {
      this.inquiryRepliesLoading.set(false);
    }
  }

  async loadPayments(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    this.paymentsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CustomerPaymentDto[]>>(`${API_URL}/orders/${id}/payments`),
      );
      if (res.success) this.payments.set(res.data ?? []);
    } catch {
      this.payments.set([]);
    } finally {
      this.paymentsLoading.set(false);
    }
  }

  async openAttachment(att: OrderAttachmentDto): Promise<void> {
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading(att.fileName || 'Attachment');
    try {
      const url = att.filePath.startsWith('http')
        ? att.filePath
        : `${API_URL}${att.filePath}`;
      const blob = await firstValueFrom(
        this.http.get(url, { responseType: 'blob' }),
      );
      modal.setBlob(blob, att.fileName || 'attachment');
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to load attachment.');
    }
  }

  openPaymentModal(): void {
    const modal = this.paymentModalRef();
    if (modal) { modal.openModal(); return; }
    setTimeout(() => this.paymentModalRef()?.openModal(), 200);
  }


  private async loadReferenceData(): Promise<void> {
    await this.refData.loadEager();
    // Lazy-load less critical data after render
    queueMicrotask(() => this.refData.loadLazy());
    // Copy supplier data from service to component signal
    // Other signals are read directly from refData service
  }

  readonly paymentTermOptions: DropdownOption[] = [
    { value: 'CREDIT', label: 'Credit' },
    { value: 'COD', label: 'Cash on Delivery' },
    { value: 'PREPAY', label: 'Cash in advance' },
  ];

  formatCustomerPaymentTerms(): string {
    const type = this.order()?.customerPaymentTermType;
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.order()?.customerCreditDays ?? 0;
      return `Credit ${days} days`;
    }
    if (type === 'COD') return 'Cash on Delivery';
    if (type === 'PREPAY') return 'Cash in advance';
    return type;
  }

  formatSupplierPaymentTerms(): string {
    const type = this.activeSupplierPaymentTermType();
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.activeSupplierCreditDays() ?? 0;
      return `Credit ${days} days`;
    }
    if (type === 'COD') return 'Cash on Delivery';
    if (type === 'PREPAY') return 'Cash in advance';
    return type;
  }

  onCustomerPaymentTermChange(value: string): void {
    if (value === 'CREDIT' && this.customerCreditFrozen()) {
      this.showToast('error', 'Customer credit is frozen due to risk monitoring.');
      return;
    }
    if (value === 'CREDIT' && !this.canUseCustomerCredit()) {
      this.showToast('error', 'No customer credit line is available.');
      return;
    }
    this.order.update((o) => {
      if (!o) return o;
      const next = { ...o, customerPaymentTermType: (value || null) as any };
      if (value !== 'CREDIT') next.customerCreditDays = null;
      return next;
    });
  }

  renderCompanyTerms(template: string | null | undefined, context: 'customer' | 'supplier'): string {
    const raw = (template ?? '').trim();
    if (!raw) return '';

    const documentName = this.isInquiryContext() ? 'Offer' : 'Confirmation';
    const replacements: Record<string, string> = {
      companyName: (this.selectedOwnCompany()?.name ?? '').trim(),
      documentName,
      offerOrConfirmation: documentName,
      paymentTerms: normalizeTerms(
        context === 'customer' ? this.formatCustomerPaymentTerms() : this.formatSupplierPaymentTerms(),
      ),
      customerNote: normalizeTerms(this.order()?.customerNote ?? ''),
      supplierNote: normalizeTerms(this.order()?.supplierNote ?? ''),
      invoiceNumber: normalizeTerms(this.invoiceNumber()),
      orderNumber: normalizeTerms(this.order()?.orderNumber ?? ''),
      vesselName: normalizeTerms(this.vessel()?.name ?? ''),
      portName: normalizeTerms(this.port()?.name ?? ''),
    };

    let rendered = raw;
    for (const [key, value] of Object.entries(replacements)) {
      rendered = rendered.replace(new RegExp(`\\$\\{${key}\\}|\\{\\{${key}\\}\\}`, 'g'), value);
    }

    return rendered;
  }



  onCustomerCreditDaysChange(value: number | string): void {
    const days = typeof value === 'string' ? Number(value) : value;
    const maxDays = this.customerCreditSummary()?.maxDays ?? null;
    const nextDays = Number.isFinite(days) ? days : null;
    if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
      this.order.update((o) => (o ? { ...o, customerCreditDays: maxDays } : o));
      this.showToast('error', `Max credit is ${maxDays} days.`);
    } else {
      this.order.update((o) => (o ? { ...o, customerCreditDays: nextDays } : o));
    }
  }

  onSupplierPaymentTermChange(value: string): void {
    const ptt = value as any;
    if (ptt === 'CREDIT' && !this.canUseSupplierCredit()) {
      this.showToast('error', 'No supplier credit line is available.');
      return;
    }
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierPaymentTermType: ptt || null,
            supplierCreditDays: ptt === 'CREDIT' ? order.supplierCreditDays ?? null : null,
          }
        : order);
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({
      ...supplier,
      paymentTermType: ptt || null,
      creditDays: ptt === 'CREDIT' ? supplier.creditDays ?? null : null,
    }));
  }

  onSupplierCreditDaysChange(value: number | string): void {
    const days = typeof value === 'string' ? Number(value) : value;
    const maxDays = this.supplierCreditSummary()?.maxDays ?? null;
    const nextDays = Number.isFinite(days) ? days : null;
    if (this.orderSuppliers().length === 0) {
      if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
        this.order.update((order) => order ? { ...order, supplierCreditDays: maxDays } : order);
        this.showToast('error', `Max credit is ${maxDays} days.`);
      } else {
        this.order.update((order) => order ? { ...order, supplierCreditDays: nextDays } : order);
      }
      return;
    }
    if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
      this.updateActiveOrderSupplier((supplier) => ({ ...supplier, creditDays: maxDays }));
      this.showToast('error', `Max credit is ${maxDays} days.`);
    } else {
      this.updateActiveOrderSupplier((supplier) => ({ ...supplier, creditDays: nextDays }));
    }
  }

  onSupplierNoteChange(value: string): void {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, supplierNote: value } : order);
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, note: value }));
  }

  onCustomerNoteChange(value: string): void {
    this.order.update((o) => (o ? { ...o, customerNote: value } : o));
  }

  onPurchaseOrderNumberChange(value: string): void {
    this.order.update((o) => (o ? { ...o, purchaseOrderNumber: value || null } : o));
  }

  onResponsibleUserChange(userId: string): void {
    this.order.update((o) => (o ? { ...o, salesRepId: userId || null } : o));
  }

  // ─── Contact person handlers ─────────────────────────────────────

  async loadCompanyContacts(side: 'customer' | 'supplier' | 'broker' | 'agent', companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API_URL}/companies/local/${companyId}/contacts`),
      );
      if (res.success) {
        if (side === 'customer') this.customerContacts.set(res.data ?? []);
        else if (side === 'supplier') this.supplierContacts.set(res.data ?? []);
        else if (side === 'broker') this.brokerContacts.set(res.data ?? []);
        else if (side === 'agent') this.agentSvc.setAgentContacts(res.data ?? []);
      }
    } catch {
      // silently ignore
    }
  }

  onCustomerContactChange(contactId: string): void {
    this.order.update((o) => (o ? { ...o, customerContactId: contactId || null } : o));
    const contact = this.customerContacts().find((c) => c.id === contactId) ?? null;
    this.customerContact.set(contact);
  }

  onActiveSupplierContactChange(contactId: string): void {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, supplierContactId: contactId || null } : order);
      const contact = this.supplierContacts().find((c) => c.id === contactId) ?? null;
      this.supplierContact.set(contact);
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, contactId: contactId || null }));
    const contact = this.supplierContacts().find((c) => c.id === contactId) ?? null;
    this.supplierContact.set(contact);
  }

  onAgentContactChange(contactId: string): void {
    this.agentSvc.onAgentContactChange(
      contactId,
      (updater) => { this.order.update((o) => (o ? updater(o) : o)); },
    );
  }

  // ─── Broker handlers ─────────────────────────────────────────────

  async searchBrokers(term: string): Promise<void> {
    await this.brokerSvc.searchBrokers(term);
  }

  onBrokerChange(brokerId: string): void {
    this.brokerSvc.onBrokerChange(
      brokerId,
      (updater) => { this.order.update((o) => (o ? updater(o) : o)); },
      (companyId) => { void this.loadCompanyContacts('broker', companyId); },
    );
  }

  onBrokerContactChange(contactId: string): void {
    this.brokerSvc.onBrokerContactChange(
      contactId,
      (updater) => { this.order.update((o) => (o ? updater(o) : o)); },
    );
  }

  onBrokerGetsAllChange(value: boolean): void {
    this.brokerSvc.onBrokerGetsAllChange(
      value,
      (updater) => { this.order.update((o) => (o ? updater(o) : o)); },
    );
  }

  async searchAgents(term: string): Promise<void> {
    await this.agentSvc.searchAgents(term);
  }

  onAgentChange(agentId: string): void {
    this.agentSvc.onAgentChange(
      agentId,
      (updater) => { this.order.update((o) => (o ? updater(o) : o)); },
      (companyId) => { void this.loadCompanyContacts('agent', companyId); },
    );
  }

  onTermsChange(value: string): void {
    this.order.update((o) => (o ? { ...o, termsAndConditions: value || null } : o));
  }

  onAttachmentSelected(file: File): void {
    this.selectedAttachment = file;
  }

  async uploadAttachment(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.selectedAttachment) return;
    this.uploadingAttachment.set(true);
    try {
      const form = new FormData();
      form.append('file', this.selectedAttachment);
      form.append('type', this.attachmentType());
      const res = await firstValueFrom(
        this.http.post<ApiResponse<OrderAttachmentDto>>(`${API_URL}/orders/${id}/attachments`, form),
      );
      if (res.success && res.data) {
        this.attachments.update((prev) => [res.data, ...prev]);
        this.selectedAttachment = null;
      }
    } catch {
      this.showToast('error', 'Failed to upload attachment.');
    } finally {
      this.uploadingAttachment.set(false);
    }
  }

  async deleteAttachment(att: OrderAttachmentDto): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ deleted: boolean }>>(`${API_URL}/orders/${id}/attachments/${att.id}`),
      );
      if (res.success) {
        this.attachments.update((prev) => prev.filter((a) => a.id !== att.id));
        this.showToast('success', 'Attachment removed.');
      } else {
        this.showToast('error', res.message ?? 'Failed to remove attachment.');
      }
    } catch {
      this.showToast('error', 'Failed to remove attachment.');
    }
  }

  private async setOrderStatus(status: OrderStatus): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status }),
      );
      if (res.success) {
        this.order.update((o) => (o ? { ...o, status } : o));
      }
    } catch {
      this.showToast('error', 'Failed to update order status.');
    }
  }

  formatFileSize(size: number): string {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, idx);
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }




  private getEffectiveDeliveredQuantity(row: OrderItemRow): number | null {
    const deliveredQuantity = parseDecimalValue(row.deliveredQuantity);
    if (deliveredQuantity !== null) return deliveredQuantity;
    return parseDecimalValue(row.quantity);
  }

  private buildItemPayload(rows: OrderItemRow[], options?: { fillMissingDeliveredQuantity?: boolean }) {
    return buildItemPayload(rows, options?.fillMissingDeliveredQuantity);
  }

  private normalizeIncomingItemRows(items: OrderItemRow[]): OrderItemRow[] {
    const previousRows = this.itemRows();
    const previousIds = new Set(previousRows.map((row) => row.id));
    const nextIds = new Set(items.map((row) => row.id));
    const activeSupplier = this.activeOrderSupplier();
    const defaultSupplierId = this.hasMultipleOrderSuppliers() && activeSupplier?.companyId
      ? activeSupplier.id
      : null;

    const normalizedItems = items.map((item) => {
      if (!defaultSupplierId || item.orderSupplierId || previousIds.has(item.id)) {
        return item;
      }

      return {
        ...item,
        orderSupplierId: defaultSupplierId,
      };
    });

    this.saveSvc.trackNewDraftItems(normalizedItems, previousIds);

    return normalizedItems;
  }

  private rebindTemporaryItemSupplierIds(previousSuppliers: OrderSupplierDto[], nextSuppliers: OrderSupplierDto[]): void {
    const companyIdByTempSupplierId = new Map(
      previousSuppliers
        .filter((supplier) => this.isTemporaryOrderSupplierId(supplier.id) && !!supplier.companyId)
        .map((supplier) => [supplier.id, supplier.companyId] as const),
    );

    if (companyIdByTempSupplierId.size === 0) return;

    const supplierIdByCompanyId = new Map(
      nextSuppliers
        .filter((supplier) => !!supplier.companyId)
        .map((supplier) => [supplier.companyId, supplier.id] as const),
    );

    this.itemRows.update((rows) => rows.map((row) => {
      if (!row.orderSupplierId) return row;

      const companyId = companyIdByTempSupplierId.get(row.orderSupplierId);
      if (!companyId) return row;

      const persistedSupplierId = supplierIdByCompanyId.get(companyId);
      if (!persistedSupplierId || persistedSupplierId === row.orderSupplierId) return row;

      return {
        ...row,
        orderSupplierId: persistedSupplierId,
      };
    }));
  }

  private async syncOrderSupplierRecords(orderId: string): Promise<void> {
    const suppliers = this.orderSuppliers();
    if (suppliers.length === 0) {
      const order = this.order();
      if (order?.supplierId) {
        await this.reloadOrderSuppliers(orderId);
      }
      return;
    }

    const preferredCompanyId = this.activeOrderSupplier()?.companyId ?? null;
    for (const supplier of suppliers) {
      if (!supplier.companyId) continue;

      const endpoint = this.isTemporaryOrderSupplierId(supplier.id)
        ? `${API_URL}/orders/${orderId}/suppliers`
        : `${API_URL}/orders/${orderId}/suppliers/${supplier.id}`;
      const request$ = this.isTemporaryOrderSupplierId(supplier.id)
        ? this.http.post<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            isPrimary: supplier.isPrimary,
          })
        : this.http.put<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            sortOrder: supplier.sortOrder,
            isPrimary: supplier.isPrimary,
          });

      const res = await firstValueFrom(request$);

      if (!res.success || !res.data) {
        throw new Error(res.message ?? 'Failed to save supplier details');
      }
    }

    const previousSuppliers = suppliers;
    await this.reloadOrderSuppliers(orderId, preferredCompanyId);
    this.rebindTemporaryItemSupplierIds(previousSuppliers, this.orderSuppliers());
  }

  private async reloadOrderSuppliers(orderId: string, preferredCompanyId?: string | null): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<OrderSupplierDto[]>>(`${API_URL}/orders/${orderId}/suppliers`),
    );

    if (!res.success || !res.data) return;

    this.mergeKnownSuppliers(res.data.map((supplier) => supplier.company));
    this.orderSuppliers.set(res.data);
    const currentActiveSupplierId = this.activeOrderSupplierId();
    const preferredSupplierId = (currentActiveSupplierId && res.data.some((supplier) => supplier.id === currentActiveSupplierId)
      ? currentActiveSupplierId
      : null)
      ?? res.data.find((supplier) => preferredCompanyId && supplier.companyId === preferredCompanyId)?.id
      ?? res.data.find((supplier) => supplier.isPrimary)?.id
      ?? res.data[0]?.id
      ?? null;
    this.activeOrderSupplierId.set(preferredSupplierId);
  }

  private isTemporaryOrderSupplierId(orderSupplierId: string | null | undefined): boolean {
    return typeof orderSupplierId === 'string' && orderSupplierId.startsWith('temp:');
  }

  private async clearActiveSupplierSelection(): Promise<void> {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: null,
            supplierContactId: null,
            supplierPaymentTermType: null,
            supplierCreditDays: null,
            supplierNote: null,
            deliveredAt: null,
          }
        : order);
      this.supplier.set(null);
      this.supplierContact.set(null);
      this.supplierContacts.set([]);
      void this.financialSvc.loadSupplierCreditLines(null);
      return;
    }

    const activeSupplier = this.activeOrderSupplier();
    if (!activeSupplier) return;

    if (this.isTemporaryOrderSupplierId(activeSupplier.id)) {
      this.orderSuppliers.update((suppliers) => suppliers.filter((supplier) => supplier.id !== activeSupplier.id));
      const nextActive = this.activeOrderSupplier();
      this.activeOrderSupplierId.set(nextActive?.id ?? null);
      this.supplier.set(nextActive?.company ?? null);
      this.supplierContact.set(nextActive?.contact ?? null);
      await this.financialSvc.loadSupplierCreditLines(nextActive?.companyId ?? null);
      if (nextActive?.companyId) {
        await this.loadCompanyContacts('supplier', nextActive.companyId);
      } else {
        this.supplierContacts.set([]);
      }
      return;
    }

    const orderId = this.orderId();
    if (!orderId) return;

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string; isPrimary: boolean }>>(`${API_URL}/orders/${orderId}/suppliers/${activeSupplier.id}`),
      );

      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to remove supplier.');
        return;
      }

      await this.reloadOrderSuppliers(orderId);

      const nextActive = this.activeOrderSupplier();
      const latestDeliveredAt = this.orderSuppliers()
        .map((supplier) => supplier.deliveredAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null;
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: nextActive?.companyId ?? null,
            supplierContactId: nextActive?.contactId ?? null,
            supplierPaymentTermType: nextActive?.paymentTermType ?? null,
            supplierCreditDays: nextActive?.creditDays ?? null,
            supplierNote: nextActive?.note ?? null,
            deliveredAt: latestDeliveredAt,
          }
        : order);
      this.supplier.set(nextActive?.company ?? null);
      this.supplierContact.set(nextActive?.contact ?? null);
      await this.financialSvc.loadSupplierCreditLines(nextActive?.companyId ?? null);
      if (nextActive?.companyId) {
        await this.loadCompanyContacts('supplier', nextActive.companyId);
      } else {
        this.supplierContacts.set([]);
      }
    } catch {
      this.showToast('error', 'Failed to remove supplier.');
    }
  }



  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(this.normalizeIncomingItemRows(items));
    this.queuePlattsSuggestionsLoad();
    this.scheduleAvailabilityChecks();
  }

  // ─── Inventory availability ──────────────────────────────────────
  /** Schedule an availability check for each tracked line; debounced per row. */
  private scheduleAvailabilityChecks(): void {
    this.inventorySvc.scheduleChecks(this.itemRows(), this.order());
  }

  /** Load the internal-transfer extension (source/destination companies + warehouses). */
  private async loadInternalTransfer(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ transfer: OrderTransferDto; sides: unknown[] }>>(
          `${API_URL}/transfers/${id}`,
        ),
      );
      if (res.success && res.data?.transfer) {
        this.transfer.set(res.data.transfer);
      }
    } catch {
      // non-fatal: a missing transfer extension just hides the summary card.
    }
  }

  async loadPlattsSuggestions(): Promise<void> {
    await this.plattsSvc.load(this.itemRows(), this.order());
  }

  openPlattsReport(reportId: string): void {
    this.plattsSvc.openReport(reportId);
  }

  private queuePlattsSuggestionsLoad(): void {
    this.plattsSvc.queueLoad(() => this.itemRows(), () => this.order());
  }

  onInvoicingCompanyChange(companyId: string): void {
    const nextCompanyId = this.resolveRequestedInvoicingCompanyId(companyId);
    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;

    if (currentCompanyId === nextCompanyId) {
      return;
    }

    this.order.update((o) => o ? { ...o, invoicingCompanyId: nextCompanyId, bankAccountId: null } : o);
    this.bankAccounts.set([]);
    if (nextCompanyId) void this.loadBankAccounts(nextCompanyId, { autoSelect: true });
  }

  onBankAccountChange(bankAccountId: string): void {
    const nextBankAccountId = this.resolveRequestedBankAccountId(bankAccountId, this.bankAccounts());
    const currentBankAccountId = this.order()?.bankAccountId ?? null;

    if (currentBankAccountId === nextBankAccountId) {
      return;
    }

    this.order.update((o) => o ? { ...o, bankAccountId: nextBankAccountId } : o);
  }

  private async loadBankAccounts(companyId: string, options?: { autoSelect?: boolean }): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BankAccountDto[]>>(
          `${API_URL}/admin/settings/companies/${companyId}/bank-accounts`,
        ),
      );
      if (res.success) {
        this.bankAccounts.set(res.data);
        if (options?.autoSelect) {
          this.applyPreferredBankAccountSelection(res.data);
        }
      }
    } catch { /* silently ignore */ }
  }

  private applyPreferredInvoicingCompanySelection(companies: OwnCompanyDto[]): string | null {
    const nextCompanyId = this.resolveRequestedInvoicingCompanyId(this.order()?.invoicingCompanyId);
    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;

    if (currentCompanyId === nextCompanyId) {
      return nextCompanyId;
    }

    if (companies.length === 0) {
      return currentCompanyId;
    }

    this.order.update((order) => (order
      ? { ...order, invoicingCompanyId: nextCompanyId, bankAccountId: null }
      : order));
    return nextCompanyId;
  }

  private applyPreferredBankAccountSelection(accounts: BankAccountDto[]): void {
    const preferredBankAccountId = this.resolveRequestedBankAccountId(this.order()?.bankAccountId, accounts);

    if (this.order()?.bankAccountId === preferredBankAccountId) {
      return;
    }

    this.order.update((order) => (order ? { ...order, bankAccountId: preferredBankAccountId } : order));
  }

  private getPreferredBankAccount(accounts: BankAccountDto[]): BankAccountDto | null {
    if (accounts.length === 0) return null;

    const orderCurrency = normalizeCurrencyCode(this.order()?.currency);
    if (orderCurrency) {
      const currencyMatches = accounts.filter((account) => normalizeCurrencyCode(account.currency) === orderCurrency);
      if (currencyMatches.length > 0) {
        return currencyMatches.find((account) => account.isDefault) ?? currencyMatches[0];
      }
    }

    return accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;
  }

  private resolveRequestedInvoicingCompanyId(companyId: string | null | undefined): string | null {
    const normalizedCompanyId = (companyId ?? '').trim();
    const companies = this.ownCompanies();

    if (normalizedCompanyId && companies.some((company) => company.id === normalizedCompanyId)) {
      return normalizedCompanyId;
    }

    if (companies.length === 0) {
      return normalizedCompanyId || null;
    }

    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;
    if (currentCompanyId && companies.some((company) => company.id === currentCompanyId)) {
      return currentCompanyId;
    }

    return companies[0]?.id ?? null;
  }

  private resolveRequestedBankAccountId(
    bankAccountId: string | null | undefined,
    accounts: BankAccountDto[],
  ): string | null {
    const normalizedBankAccountId = (bankAccountId ?? '').trim();

    if (normalizedBankAccountId && accounts.some((account) => account.id === normalizedBankAccountId)) {
      return normalizedBankAccountId;
    }

    if (accounts.length === 0) {
      return null;
    }

    const currentBankAccountId = this.order()?.bankAccountId ?? null;
    if (currentBankAccountId && accounts.some((account) => account.id === currentBankAccountId)) {
      return currentBankAccountId;
    }

    return this.getPreferredBankAccount(accounts)?.id ?? null;
  }



  async searchClients(term: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      this.clients.set(await this.searchSvc.searchClients(term, this.client()));
    } catch {
      // silently ignore
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  async searchSuppliers(term: string): Promise<void> {
    this.supplierSearchLoading.set(true);
    try {
      this.suppliers.set(await this.searchSvc.searchSuppliers(
        term,
        this.activeSupplierCompanyId(),
        this.activeOrderSupplier()?.company ?? null,
        this.supplier(),
        this.suppliers(),
      ));
    } catch {
      // silently ignore
    } finally {
      this.supplierSearchLoading.set(false);
    }
  }

  async searchVessels(term: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      this.vessels.set(await this.searchSvc.searchVessels(term, this.vessel()));
    } catch {
      // silently ignore
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  async searchPlaces(term: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      this.places.set(await this.searchSvc.searchPlaces(term, this.port()));
    } catch {
      // silently ignore
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  onClientChange(clientId: string): void {
    if (!clientId) return;
    this.order.update((o) => (o ? { ...o, clientId, customerContactId: null } : o));
    const clientData = this.clients().find((c) => c.id === clientId);
    this.client.set(clientData ?? null);
    this.customerContact.set(null);
    void this.financialSvc.loadCustomerCreditLines(clientId).then(() => {
      // Auto-default to CREDIT if client has credit lines and no payment term is set
      const currentOrder = this.order();
      if (currentOrder && !currentOrder.customerPaymentTermType) {
        const summary = this.customerCreditSummary();
        if (summary && !this.customerCreditFrozen()) {
          this.order.update((o) => (o ? { ...o, customerPaymentTermType: PaymentTermType.Credit, customerCreditDays: summary.maxDays } : o));
        }
      }
    });
    void this.loadCompanyContacts('customer', clientId);
  }

  onActiveSupplierCompanyChange(supplierId: string): void {
    if (!supplierId) {
      void this.clearActiveSupplierSelection();
      return;
    }
    const supplierData = this.suppliers().find((supplier) => supplier.id === supplierId)
      ?? (this.supplier()?.id === supplierId ? this.supplier() : null);
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId,
            supplierContactId: null,
          }
        : order);
      this.supplier.set(supplierData ?? null);
      this.supplierContact.set(null);
      void this.financialSvc.loadSupplierCreditLines(supplierId);
      void this.loadCompanyContacts('supplier', supplierId);
      this.applyPreferredInvoicingCompanyFromSupplier(supplierData);
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({
      ...supplier,
      companyId: supplierId,
      contactId: null,
      company: this.suppliers().find((item) => item.id === supplierId) ?? this.supplier() ?? null,
      contact: null,
    }));
    this.supplier.set(supplierData ?? null);
    this.supplierContact.set(null);
    void this.financialSvc.loadSupplierCreditLines(supplierId);
    void this.loadCompanyContacts('supplier', supplierId);
    this.applyPreferredInvoicingCompanyFromSupplier(supplierData);
  }

  private applyPreferredInvoicingCompanyFromSupplier(supplierData: CounterpartyDto | null): void {
    const preferredId = supplierData?.preferredInvoicingCompanyId;
    if (!preferredId) return;

    const currentOrder = this.order();
    if (!currentOrder) return;

    const currentInvoicingId = currentOrder.invoicingCompanyId;
    if (currentInvoicingId === preferredId) return;

    // Validate the preferred company is in the user's accessible own companies
    const isValid = this.ownCompanies().some((co) => co.id === preferredId);
    if (!isValid) return;

    this.order.update((o) => o ? { ...o, invoicingCompanyId: preferredId, bankAccountId: null } : o);
    this.bankAccounts.set([]);
    void this.loadBankAccounts(preferredId, { autoSelect: true });
  }

  applyComparisonSupplier(row: InquirySupplierComparisonRow): void {
    this.onActiveSupplierCompanyChange(row.supplierId);
    this.showToast('success', `Selected ${row.supplierName} as supplier.`);
  }

  selectOrderSupplierTab(orderSupplierId: string): void {
    this.activeOrderSupplierId.set(orderSupplierId);
    const supplier = this.orderSuppliers().find((item) => item.id === orderSupplierId) ?? null;
    this.supplier.set(supplier?.company ?? null);
    this.supplierContact.set(supplier?.contact ?? null);
  }

  async addSupplierTab(): Promise<void> {
    const activeSupplier = this.activeOrderSupplier();
    if (this.orderSuppliers().some((supplier) => this.isTemporaryOrderSupplierId(supplier.id) && !supplier.companyId)) {
      this.showToast('error', 'Choose a supplier in the new tab before adding another one.');
      return;
    }

    const tempId = `temp:${crypto.randomUUID()}`;
    const nextSortOrder = Math.max(-1, ...this.orderSuppliers().map((supplier) => supplier.sortOrder ?? -1)) + 1;
    const orderId = this.orderId() ?? activeSupplier?.orderId ?? '';

    this.orderSuppliers.update((suppliers) => [...suppliers, {
      id: tempId,
      orderId,
      companyId: '',
      contactId: null,
      paymentTermType: null,
      creditDays: null,
      note: null,
      sortOrder: nextSortOrder,
      isPrimary: false,
      deliveredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      company: null,
      contact: null,
    }]);
    this.selectOrderSupplierTab(tempId);
  }

  private updateActiveOrderSupplier(
    updater: (supplier: OrderSupplierDto) => OrderSupplierDto,
  ): void {
    const resolvedActiveSupplier = this.activeOrderSupplier();
    const activeSupplierId = this.activeOrderSupplierId() ?? resolvedActiveSupplier?.id ?? null;
    if (!activeSupplierId) return;
    if (!this.activeOrderSupplierId()) {
      this.activeOrderSupplierId.set(activeSupplierId);
    }

    let nextSupplier: OrderSupplierDto | undefined;
    this.orderSuppliers.update((suppliers) => suppliers.map((supplier) => {
      if (supplier.id !== activeSupplierId) return supplier;
      nextSupplier = updater(supplier);
      return nextSupplier;
    }));

    if (!nextSupplier) return;
    const updatedSupplier = nextSupplier;

    this.supplier.set(updatedSupplier.company ?? null);
    this.supplierContact.set(updatedSupplier.contact ?? null);

    if (updatedSupplier.isPrimary) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: updatedSupplier.companyId,
            supplierContactId: updatedSupplier.contactId ?? null,
            supplierPaymentTermType: updatedSupplier.paymentTermType ?? null,
            supplierCreditDays: updatedSupplier.creditDays ?? null,
            supplierNote: updatedSupplier.note ?? null,
            deliveredAt: updatedSupplier.deliveredAt ?? order.deliveredAt ?? null,
          }
        : order);
    }

    const latestDeliveredAt = this.orderSuppliers()
      .map((supplier) => supplier.deliveredAt ?? null)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? null;

    this.order.update((order) => order ? { ...order, deliveredAt: latestDeliveredAt ?? order.deliveredAt ?? null } : order);
  }

  openInquiryReplyEditor(row: SupplierInquiryReplyRow): void { this.replySvc.openEditor(row); }
  cancelInquiryReplyEditor(): void { this.replySvc.cancelEditor(); }
  isEditingInquiryReply(row: SupplierInquiryReplyRow): boolean { return this.replySvc.isEditing(row); }
  statusBadgeClass = this.replySvc.statusBadgeClass.bind(this.replySvc);
  formatHistoryDateTime = this.replySvc.fmtDateTime.bind(this.replySvc);
  quoteRateLabel = this.replySvc.quoteRateLabel.bind(this.replySvc);
  averageResponseLabel = this.replySvc.avgResponseLabel.bind(this.replySvc);
  responseHoursLabel = this.replySvc.responseHoursLabel.bind(this.replySvc);

  deliverabilityLabel(performance: InquirySupplierPerformance): string {
    const responseCount = performance.deliverableCount + performance.nonDeliverableCount;
    if (responseCount <= 0) return '';
    return `${Math.round((performance.deliverableCount / responseCount) * 100)}% deliverable`;
  }

  inquiryReplySummary(row: SupplierInquiryReplyRow): string {
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

  inquiryQuoteMatrixCellLabel(status: SupplierInquiryReplyRow['status']): string {
    if (status === 'DECLINED') return 'Declined';
    if (status === 'NO_REPLY') return 'No reply';
    return 'Awaiting reply';
  }

  inquiryReplyRecommendation(inquiryId: string): InquiryReplyRecommendation | undefined {
    return this.inquiryReplyRecommendations().get(inquiryId) ?? undefined;
  }


  /** Strip trailing zeros from a numeric string, show min-max spread if applicable. */
  formatQty(qty: string | null, qtyMin?: string | null): string {
    const fmt = (v: string) => {
      const n = parseFloat(v);
      return isNaN(n) ? v : n.toString();
    };
    if (!qty) return '';
    const max = fmt(qty);
    const min = qtyMin ? fmt(qtyMin) : '';
    return min && min !== max ? `${min} - ${max}` : max;
  }

  supplierPerformanceSummary(performance: InquirySupplierPerformance): string {
    if (performance.lastDeliveredAtPlace) {
      return `Last here ${this.formatHistoryDateTime(performance.lastDeliveredAtPlace)}`;
    }
    if (performance.lastDeliveredAtOverall) {
      return `Last served ${this.formatHistoryDateTime(performance.lastDeliveredAtOverall)}`;
    }
    if (performance.noReplyCount > 0) {
      return `${performance.noReplyCount} no reply`;
    }
    if (performance.declinedCount > 0) {
      return `${performance.declinedCount} declined`;
    }
    return '';
  }

  isTopInquirySupplier(row: InquirySupplierComparisonRow): boolean {
    const topRow = this.rankedInquirySuppliers()[0];
    return !!topRow && topRow.supplierId === row.supplierId && this.inquirySupplierScore(row.performance) > 0;
  }

  private compareInquirySupplierPerformance(left: InquirySupplierComparisonRow, right: InquirySupplierComparisonRow): number {
    const scoreDiff = this.inquirySupplierScore(right.performance) - this.inquirySupplierScore(left.performance);
    if (scoreDiff !== 0) return scoreDiff;
    return left.supplierName.localeCompare(right.supplierName);
  }

  private inquirySupplierScore(performance: InquirySupplierPerformance): number {
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



  onVesselChange(vesselId: string): void {
    if (!vesselId) return;
    this.order.update((o) => (o ? { ...o, vesselId } : o));
    const vesselData = this.vessels().find((v) => v.id === vesselId);
    this.vessel.set(vesselData ?? null);
  }

  onPortChange(placeId: string): void {
    if (!placeId) return;
    const previousRemark = this.order()?.placeRemark ?? null;
    this.order.update((o) => (o ? { ...o, placeId } : o));
    const placeData = this.places().find((p) => p.id === placeId);
    this.port.set(placeData ?? null);

    // Prompt user if the new place has a different default remark
    const newDefault = placeData?.orderRemark ?? null;
    if ((newDefault ?? '') !== (previousRemark ?? '')) {
      this.pendingPlaceRemark.set(newDefault);
      const prompt = this.remarkPromptRef();
      if (prompt) { prompt.show(); return; }
      setTimeout(() => this.remarkPromptRef()?.show(), 200);
    }
  }

  onPlaceRemarkChange(value: string): void {
    this.order.update((o) => (o ? { ...o, placeRemark: value || null } : o));
  }

  applyNewPlaceRemark(): void {
    const remark = this.pendingPlaceRemark();
    this.order.update((o) => (o ? { ...o, placeRemark: remark } : o));
    this.showPlaceRemarkPrompt.set(false);
    this.pendingPlaceRemark.set(null);
  }

  dismissPlaceRemarkPrompt(): void {
    this.showPlaceRemarkPrompt.set(false);
    this.pendingPlaceRemark.set(null);
  }

  onEtaChange(eta: string): void {
    const iso = eta ? toUtcIsoFromZonedDateInput(eta, this.placeTimezone()) : null;
    this.order.update((o) => (o ? { ...o, eta: iso } : o));
    this.queuePlattsSuggestionsLoad();
  }

  onEtdChange(etd: string): void {
    const iso = etd ? toUtcIsoFromZonedDateInput(etd, this.placeTimezone()) : null;
    this.order.update((o) => (o ? { ...o, etd: iso } : o));
  }

  onDeliveredAtChange(value: string): void {
    const iso = value ? toUtcIsoFromZonedDateInput(value, this.placeTimezone()) : null;
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, deliveredAt: iso } : order);
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, deliveredAt: iso }));
  }

  onDeliveryMethodChange(value: string | null): void {
    this.order.update((o) => (o ? { ...o, deliveryMethod: value || null } : o));
  }

  onItemEconomicsChange(economics: OrderItemsEconomics): void {
    this.itemEconomics.set(economics);
  }

  onCurrencyChange(currency: string): void {
    this.order.update((o) => (o ? { ...o, currency } : o));
    if (this.bankAccounts().length > 0) {
      this.applyPreferredBankAccountSelection(this.bankAccounts());
    } else {
      const invoicingCompanyId = this.order()?.invoicingCompanyId;
      if (invoicingCompanyId) {
        void this.loadBankAccounts(invoicingCompanyId, { autoSelect: true });
      }
    }
  }

  onCategoryChange(categoryKey: string): void {
    this.order.update((o) => (o ? { ...o, categoryKey: categoryKey || null } : o));
  }




  private async performAutoSave(): Promise<void> {
    const id = this.orderId();
    const o = this.order();
    if (!id || !o || this.isPaidOrCancelled()) return;

    // Pause the autosave effect while saving: the save path reloads suppliers and
    // rebinds item rows (new array refs / itemRows.update), which would re-trigger
    // this effect and loop an autosave every ~1.5s. An edit made during the save
    // window is an accepted rare edge case (the next edit recovers).
    this._autosavePaused = true;
    this.autoSaving.set(true);
    try {
      const success = await this.saveSvc.saveOrder(id, o, {
        itemRows: () => this.itemRows(),
        hasMultipleOrderSuppliers: () => this.hasMultipleOrderSuppliers(),
        buildItemPayload: (rows, opts) => this.buildItemPayload(rows, opts),
        syncSupplierRecords: (oid) => this.syncOrderSupplierRecords(oid),
        clearSavedDraftIds: (rows) => this.saveSvc.clearSavedDraftItemIds(rows),
        loadCustomerCreditLines: (cid) => this.financialSvc.loadCustomerCreditLines(cid),
        loadSupplierCreditLines: (scid) => this.financialSvc.loadSupplierCreditLines(scid),
        activeSupplierCompanyId: () => this.activeOrderSupplier()?.companyId ?? null,
      });
      if (success) this.lastSaved.set(new Date());
    } finally {
      this.autoSaving.set(false);
      this._autosavePaused = false;
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────

  async onAction(action: HeaderAction): Promise<void> {
    await this.actionSvc.onAction(action, this.buildActionContext());
  }

  async confirmConvertToOrder(): Promise<void> {
    await this.actionSvc.confirmConvertToOrder(this.buildActionContext());
  }

  async confirmCancelInquiry(event: { reason: string; reasonOther?: string }): Promise<void> {
    await this.actionSvc.confirmCancelInquiry(this.buildActionContext(), event);
  }

  async saveOrder(): Promise<void> {
    await this.actionSvc.saveOrder(this.buildActionContext());
  }

  private buildActionContext(): import('./services/order-action.service').OrderActionContext {
    const self = this;
    return {
      order: () => self.order(),
      orderId: () => self.orderId(),
      itemRows: () => self.itemRows(),
      hasLineItems: () => self.hasLineItems(),
      hasBankAccount: () => self.hasBankAccount(),
      hasInvoicingCompany: () => self.hasInvoicingCompany(),
      hasEta: () => self.hasEta(),
      hasSupplier: () => self.hasSupplier(),
      isReadonly: () => self.isReadonly(),
      isInquiryContext: () => self.isInquiryContext(),
      isResponsibleUser: () => self.isResponsibleUser(),
      isPaidOrCancelled: () => self.isPaidOrCancelled(),
      deliveredQtyComplete: () => self.deliveredQtyComplete(),
      hasDeliveryDocumentation: () => self.hasDeliveryDocumentation(),
      hasInventoryShortage: () => self.hasInventoryShortage(),
      hasEnoughPaymentsForMarkPaid: () => self.hasEnoughPaymentsForMarkPaid(),
      hasIncompleteDraftItems: (rows) => self.saveSvc.hasIncompleteDraftItems(rows, () => self.hasMultipleOrderSuppliers()),
      activeOrderSupplier: () => self.activeOrderSupplier(),
      hasMultipleOrderSuppliers: () => self.hasMultipleOrderSuppliers(),
      invoiceNumber: () => self.invoiceNumber(),
      availableInquiryCancelReasons: () => self.availableInquiryCancelReasons(),
      deliveryDocumentationSettings: () => self.refData.deliveryDocumentationSettings(),
      getEffectiveDeliveredQuantity: (row) => self.getEffectiveDeliveredQuantity(row),
      buildItemPayload: (rows, opts) => self.buildItemPayload(rows, opts),
      pdfModal: () => self.pdfModal() ?? null,
      convertModalRef: () => self.convertModalRef() ?? null,
      cancelModalRef: () => self.cancelModalRef() ?? null,
      openPaymentModal: () => self.openPaymentModal(),
      openSendEmailModal: (dt: string) => self.openSendEmailModal(dt as any),
      openSendInquiryModal: () => self.openSendInquiryModal(),
      openBookingEmailModal: () => self.openBookingEmailModal(),
      syncOrderSupplierRecords: (oid) => self.syncOrderSupplierRecords(oid),
      clearSavedDraftItemIds: (rows) => self.saveSvc.clearSavedDraftItemIds(rows),
      normalizeDetailRoute: (s, id) => self.normalizeDetailRoute(s, id),
      updateOrder: (updater) => { self.order.update((o) => (o ? updater(o) : o)); },
      setConvertingToOrder: (v) => self.convertingToOrder.set(v),
      setCancellingInquiry: (v) => self.cancellingInquiry.set(v),
      setItemRows: (rows) => self.itemRows.set(rows),
      setSaving: (v) => self.saving.set(v),
      showToast: (t, m) => self.showToast(t, m),
    };
  }

  openSendInquiryModal(): void {
    this.commSvc.openSendInquiryModal(
      this.orderId(),
      this.hasLineItems(),
      this.hasEta(),
      this.inquiryModal(),
      (type, msg) => this.showToast(type, msg),
    );
  }

  onSendInquiry(payload: SendInquiryPayload): void {
    this.commSvc.onSendInquiry(
      payload,
      this.orderId(),
      this.inquiryModal(),
      (type, msg) => this.showToast(type, msg),
      () => {
        void Promise.all([
          this.inquirySvc.loadReplies(this.orderId()).then((r) => this.inquiryReplies.set(r)),
          this.inquirySvc.loadSupplierContext(this.orderId()).then((s) => this.inquirySupplierContext.set(s)),
        ]);
        this.inquiryModal()?.close();
      },
    );
  }

  openSendEmailModal(docType: DocumentEmailType): void {
    this.emailDocumentType.set(docType);
    this.commSvc.openSendEmailModal(docType, this.orderId(), this.activeOrderSupplier()?.id ?? null, this.emailModal(), this.order()?.orderNumber ?? null, (type, msg) => this.showToast(type, msg));
  }

  openBookingEmailModal(): void {
    this.emailDocumentType.set('BUNKER_BOOKING');
    this.emailPdfFileName.set('');
    this.commSvc.openBookingEmailModal(this.orderId(), this.emailModal(), (type, msg) => this.showToast(type, msg));
  }

  onSendEmail(payload: SendEmailPayload): void {
    this.commSvc.onSendEmail(
      payload,
      this.orderId(),
      this.emailModal(),
      (type, msg) => this.showToast(type, msg),
      // When a final INVOICE email is sent on a DELIVERED order, the backend
      // transitions the order status to INVOICED.  Update the local signal so
      // the status badge / header actions reflect the new state immediately.
      () => {
        if (payload.documentType === 'INVOICE' && this.order()?.status === OrderStatus.Delivered) {
          this.order.update((o) => (o ? { ...o, status: OrderStatus.Invoiced } : o));
        }
      },
    );
  }

  // ─── WhatsApp send handlers ──────────────────────────────────────

  /** Check if the current user has linked WhatsApp */
  private async checkWhatsAppLinked(): Promise<void> {
    await this.commSvc.checkWhatsAppLinked();
  }

  /** Send document PDF via WhatsApp from the email modal */
  async onSendInvoiceWhatsApp(payload: SendWhatsAppPayload): Promise<void> {
    await this.commSvc.onSendInvoiceWhatsApp(
      payload,
      this.orderId(),
      this.order()?.orderNumber ?? null,
      this.activeOrderSupplier()?.id ?? null,
      this.emailModal(),
      (type, msg) => this.showToast(type, msg),
    );
  }

  /** Send an already-loaded PDF via WhatsApp from the PDF preview modal */
  async onSendPdfWhatsApp(ev: { phone: string; blob: Blob; fileName: string }): Promise<void> {
    await this.commSvc.onSendPdfWhatsApp(
      ev,
      this.order()?.orderNumber ?? null,
      this.pdfModal(),
      (type, msg) => this.showToast(type, msg),
    );
  }

  /** Send inquiry via WhatsApp */
  async onSendInquiryWhatsApp(payload: SendInquiryWhatsAppPayload): Promise<void> {
    const id = this.orderId();
    if (!id || payload.recipients.length === 0) return;

    try {
      await this.commSvc.onSendInquiryWhatsApp(
        payload,
        id,
        this.inquiryModal(),
        (type, msg) => this.showToast(type, msg),
        () => {
          this.inquiryModal()?.close();
          void Promise.all([
            this.inquirySvc.loadReplies(this.orderId()),
            this.inquirySvc.loadSupplierContext(this.orderId()),
          ]);
        },
      );
    } catch {
      this.inquiryModal()?.waDone();
      this.showToast('error', 'Failed to send inquiry via WhatsApp. Is your device linked?');
    }
  }

  private markPaid(): void {
    if (this.order()?.status === OrderStatus.Paid) {
      this.showToast('error', 'Order is already marked as paid.');
      return;
    }
    if (!this.hasEnoughPaymentsForMarkPaid()) {
      this.showToast('error', 'Add payments equal to the total due before marking as paid.');
      this.openPaymentModal();
      return;
    }
    this.openPaymentModal();
  }

  // ─── Credit Application ──────────────────────────────────────────

  readonly showCreditApplicationModal = signal(false);

  onCreditApplicationSubmitted(): void {
    // Reload credit lines after application is submitted
    this.financialSvc.loadCustomerCreditLines(this.order()?.clientId);
  }

  private requireApiSuccess<T>(response: ApiResponse<T>, fallbackMessage: string): T {
    if (!response.success) {
      throw new Error(response.message ?? fallbackMessage);
    }
    return response.data;
  }

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
