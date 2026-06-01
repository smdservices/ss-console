/**
 * Public surface for the Operator capability layer.
 *
 * Skills import capability interfaces from this module:
 *
 *   import type { Email, PracticeManagement } from '@/lib/operator/capabilities'
 *
 * Adapters import from the same module and from their capability's
 * specific type exports for the shapes they need to construct.
 */

export type {
  AdapterBase,
  AdapterErrorCode,
  CapabilityName,
  CapabilitySet,
  DateRange,
  FieldCoverage,
  HealthStatus,
  OpaqueRef,
} from './types'
export { AdapterError } from './types'

export type {
  PracticeManagement,
  Matter,
  MatterStatus,
  MatterQuery,
  CreateMatterInput,
  MatterUpdate,
  Contact,
  ContactQuery,
  CreateContactInput,
  TimeEntry,
  TimeEntryInput,
  DocumentRef,
  DocumentUpload,
} from './practice-management'

export type {
  Email,
  EmailAddress,
  EmailMessage,
  EmailThread,
  ThreadQuery,
  DraftInput,
  DraftRef,
  DraftUpdate,
  SentItem,
} from './email'

export type {
  Calendar,
  CalendarEvent,
  EventStatus,
  Attendee,
  EventQuery,
  SuggestTimeInput,
  SuggestedSlot,
  CreateEventDraftInput,
  EventDraftRef,
  EventDraftUpdate,
} from './calendar'

export type {
  DocumentStorage,
  StoredDocument,
  Folder,
  DocumentVersion,
  ListFolderQuery,
  FolderListing,
  UploadDocumentInput,
  UpdateDocumentInput,
  ShareDocumentDraftInput,
  ShareDraftRef,
} from './document-storage'

export type {
  ESign,
  Envelope,
  EnvelopeStatus,
  Signer,
  EnvelopeQuery,
  ReminderInput,
} from './e-sign'

export type { CourtAccess, CaseQuery, CaseResult, Docket, DocketEntry } from './court-access'

export type {
  Payments,
  Transaction,
  TransactionType,
  TransactionStatus,
  TransactionQuery,
  PaymentRequestDraftInput,
  PaymentRequestDraftRef,
  TrustAccountBalance,
} from './payments'

export type {
  Accounting,
  Invoice,
  InvoiceStatus,
  InvoiceLineItem,
  InvoiceQuery,
  CreateInvoiceDraftInput,
  InvoiceDraftRef,
  AccountsReceivableEntry,
  AccountsReceivableQuery,
  ExpenseEntryDraftInput,
  ExpenseEntryDraftRef,
} from './accounting'

export type {
  IntakeCRM,
  Lead,
  LeadStatus,
  LeadQuery,
  UpdateLeadInput,
  IntakeFormResponse,
  IntakeFormResponseQuery,
  LeadNote,
} from './intake-crm'

export type {
  CallTracking,
  CallRecord,
  CallDirection,
  CallOutcome,
  CallQuery,
  CallRecording,
  CallAttribution,
} from './call-tracking'

export type {
  InternalComms,
  ChannelSummary,
  ChannelMessage,
  ListChannelMessagesQuery,
  PostToChannelInput,
  SendDmInput,
  PostRef,
  ReactionInput,
  Mention,
} from './internal-comms'

export {
  CONFORMANCE_INVARIANTS,
  BANNED_METHOD_NAMES,
  inspectAdapter,
  assertCapabilitySetWellFormed,
  assertHealthStatusWellFormed,
  makeAdapterErrorCodes,
} from './conformance'

export type { ConformanceInvariantKey, ConformanceResult } from './conformance'
