/**
 * SOW (Statement of Work) PDF template using Forme JSX components.
 *
 * Implements the design spec from docs/templates/sow-template.md.
 *
 * Business rules enforced:
 * - No hourly rates or per-item pricing visible (Decision #16)
 * - 4 hard exclusions from Decision #10 (evolved)
 * - "We" voice throughout (Decision #20)
 * - 2-part or 3-milestone payment terms (Decision #14)
 * - Max 8 deliverable items (errors above 8)
 *
 * @see docs/templates/sow-template.md — full design specification
 */

import React from 'react'
import { Document, Page, View, Text } from '@formepdf/react'
import { BRAND_NAME } from '../config/brand'

// ---------------------------------------------------------------------------
// SignWell text-tag field placement
//
// The client signature and client date fields are placed by SignWell via
// text tags embedded in the PDF — not by hardcoded coordinates. SignWell
// scans the document for these literal strings, places fields over their
// bounding boxes, and auto-fills them at signing time. Tags are rendered
// in white on white so they are invisible on the printed/unsigned PDF.
//
// Benefits over coordinate-based placement:
//   - Template edits cannot drift from field position (they move together)
//   - Zero coordinate math / DPI conversion at the provider boundary
//   - Adding fields (initials, checkboxes) is a one-line template edit
//
// Tag format: {{<type>:<signer>}} — short form, signer 1 is the client.
// Ref: https://developers.signwell.com/reference/adding-text-tags
// ---------------------------------------------------------------------------

const SIGNATURE_BLOCK_WIDTH = 216
const CLIENT_SIGNER_INDEX = 1

// ---------------------------------------------------------------------------
// Props interface (matches Section 9.2 of sow-template.md)
// ---------------------------------------------------------------------------

export interface SOWTemplateProps {
  client: {
    businessName: string
    contactName: string
    contactTitle?: string
  }
  document: {
    date: string // pre-formatted: "March 30, 2026"
    expirationDate: string
    sowNumber: string // "SOW-202603-001"
  }
  engagement: {
    overview: string
    startDate: string // pre-formatted
    endDate: string // pre-formatted
  }
  items: Array<{
    name: string
    description: string
  }>
  payment: {
    schedule: 'two_part' | 'three_milestone'
    totalPrice: string // pre-formatted: "$3,500"
    deposit: string
    completion: string
    milestone?: string // only for three_milestone
    milestoneLabel?: string
  }
}

// ---------------------------------------------------------------------------
// Exclusions list (Decision #10 — evolved)
// ---------------------------------------------------------------------------

export const EXCLUSIONS = [
  'Bookkeeping remediation or catch-up',
  'Data migration from legacy systems',
  'Ground-up product development (consumer apps, SaaS products)',
  'Ongoing support beyond the handoff session',
]

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// prettier-ignore
const colors = {
  primary: '#1e40af', textPrimary: '#1e293b', textBody: '#334155',
  textMuted: '#64748b', border: '#e2e8f0', surfaceLight: '#f8fafc', white: '#ffffff',
}
const fonts = { heading: 'Plus Jakarta Sans', body: 'Inter' }
// prettier-ignore
const sectionHeadingStyle = {
  fontFamily: fonts.heading, fontWeight: 700 as const, fontSize: 12, color: colors.primary,
  textTransform: 'uppercase' as const, marginBottom: 12, paddingLeft: 8, borderLeft: `3px solid ${colors.primary}`,
}
// prettier-ignore
const bodyTextStyle = { fontFamily: fonts.body, fontWeight: 400 as const, fontSize: 10, color: colors.textBody, lineHeight: 1.4 }
// prettier-ignore
const labelStyle = { fontFamily: fonts.body, fontWeight: 500 as const, fontSize: 8, color: colors.textMuted }
// prettier-ignore
const finePrintStyle = { fontFamily: fonts.body, fontWeight: 400 as const, fontSize: 8, color: colors.textMuted }
// prettier-ignore
const pageMargins = { top: 54, bottom: 54, left: 72, right: 72 }

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SOWFooter({ sowNumber, pageLabel }: { sowNumber: string; pageLabel: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: pageMargins.bottom,
        left: pageMargins.left,
        right: pageMargins.right,
      }}
    >
      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 8 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={finePrintStyle}>{BRAND_NAME} | smd.services</Text>
        <Text style={finePrintStyle}>
          {sowNumber} | {pageLabel}
        </Text>
      </View>
    </View>
  )
}

function SOWHeader({
  client,
  doc,
}: {
  client: SOWTemplateProps['client']
  doc: SOWTemplateProps['document']
}) {
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        <View>
          <Text
            style={{
              fontFamily: fonts.heading,
              fontWeight: 800,
              fontSize: 20,
              color: colors.primary,
            }}
          >
            {BRAND_NAME}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontWeight: 400,
              fontSize: 9,
              color: colors.textMuted,
              marginTop: 2,
            }}
          >
            smd.services
          </Text>
        </View>
        <Text
          style={{
            fontFamily: fonts.heading,
            fontWeight: 700,
            fontSize: 14,
            color: colors.primary,
          }}
        >
          STATEMENT OF WORK
        </Text>
      </View>
      <View style={{ marginBottom: 16 }}>
        {(
          [
            ['Prepared for:', client.businessName],
            ['Attn:', client.contactName],
            ['Date:', doc.date],
            ['Valid through:', doc.expirationDate],
            ['SOW #:', doc.sowNumber],
          ] as [string, string][]
        ).map(([label, value]) => (
          <View style={{ flexDirection: 'row', marginBottom: 4 }}>
            <Text style={{ ...labelStyle, width: 100 }}>{label}</Text>
            <Text style={bodyTextStyle}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 16 }} />
    </>
  )
}

const scopeColStyle = (w: number | 'flex', weight: number, color: string) => ({
  fontFamily: fonts.body,
  fontWeight: weight,
  fontSize: 9,
  color,
  ...(w === 'flex' ? { flex: 1 } : { width: w }),
})

function SOWScopeTableHeader({ rowPadding }: { rowPadding: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceLight,
        borderBottom: `1px solid ${colors.border}`,
        padding: `${rowPadding}pt 8pt`,
      }}
    >
      <Text style={scopeColStyle(30, 600, colors.textPrimary)}>#</Text>
      <Text style={scopeColStyle(160, 600, colors.textPrimary)}>Deliverable</Text>
      <Text style={scopeColStyle('flex', 600, colors.textPrimary)}>Description</Text>
    </View>
  )
}

function SOWScopeTableRow({
  item,
  index,
  isLast,
  rowPadding,
}: {
  item: SOWTemplateProps['items'][number]
  index: number
  isLast: boolean
  rowPadding: number
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: index % 2 === 0 ? colors.white : colors.surfaceLight,
        borderBottom: isLast ? undefined : `1px solid ${colors.border}`,
        padding: `${rowPadding}pt 8pt`,
      }}
    >
      <Text style={scopeColStyle(30, 400, colors.textBody)}>{index + 1}</Text>
      <Text style={scopeColStyle(160, 400, colors.textBody)}>{item.name}</Text>
      <Text style={scopeColStyle('flex', 400, colors.textBody)}>{item.description}</Text>
    </View>
  )
}

function SOWScopeTable({
  items,
  rowPadding,
}: {
  items: SOWTemplateProps['items']
  rowPadding: number
}) {
  return (
    <View style={{ border: `1px solid ${colors.border}`, marginBottom: 16 }}>
      <SOWScopeTableHeader rowPadding={rowPadding} />
      {items.map((item, index) => (
        <SOWScopeTableRow
          key={index}
          item={item}
          index={index}
          isLast={index === items.length - 1}
          rowPadding={rowPadding}
        />
      ))}
    </View>
  )
}

function PayRow({ label, amount, mb = 0 }: { label: string; amount: string; mb?: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: mb }}>
      <Text style={bodyTextStyle}>{label}</Text>
      <Text style={bodyTextStyle}>{amount}</Text>
    </View>
  )
}

function SOWPaymentBlock({ payment }: { payment: SOWTemplateProps['payment'] }) {
  const totStyle = {
    fontFamily: fonts.body,
    fontWeight: 700,
    fontSize: 14,
    color: colors.textPrimary,
  }
  return (
    <>
      <View
        style={{
          backgroundColor: colors.surfaceLight,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          padding: 12,
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={totStyle}>Project total</Text>
          <Text style={totStyle}>{payment.totalPrice}</Text>
        </View>
        <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 8 }} />
        {payment.schedule === 'two_part' ? (
          <>
            <PayRow label="Due at signing (50%)" amount={payment.deposit} mb={4} />
            <PayRow label="Due at completion (50%)" amount={payment.completion} />
          </>
        ) : (
          <>
            <PayRow label="Due at signing" amount={payment.deposit} mb={4} />
            <PayRow
              label={`Due at ${payment.milestoneLabel ?? 'mid-engagement milestone'}`}
              amount={payment.milestone ?? ''}
              mb={4}
            />
            <PayRow label="Due at completion" amount={payment.completion} />
          </>
        )}
      </View>
      <Text style={{ ...finePrintStyle, marginBottom: 16 }}>
        Payment is due regardless of scope additions surfaced during the engagement.
      </Text>
    </>
  )
}

interface Page1Props {
  client: SOWTemplateProps['client']
  doc: SOWTemplateProps['document']
  engagement: SOWTemplateProps['engagement']
  items: SOWTemplateProps['items']
  payment: SOWTemplateProps['payment']
  rowPadding: number
}

function SOWPage1({ client, doc, engagement, items, payment, rowPadding }: Page1Props) {
  return (
    <Page size="Letter" margin={pageMargins}>
      <SOWHeader client={client} doc={doc} />
      <Text style={sectionHeadingStyle}>ENGAGEMENT OVERVIEW</Text>
      <Text style={{ ...bodyTextStyle, marginBottom: 16 }}>{engagement.overview}</Text>
      <Text style={sectionHeadingStyle}>SCOPE OF WORK</Text>
      <SOWScopeTable items={items} rowPadding={rowPadding} />
      <Text style={sectionHeadingStyle}>TIMELINE</Text>
      <View style={{ flexDirection: 'row', gap: 40, marginBottom: 16 }}>
        <View>
          <Text style={labelStyle}>Estimated start</Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: 10,
              color: colors.textBody,
              marginTop: 2,
            }}
          >
            {engagement.startDate}
          </Text>
        </View>
        <View>
          <Text style={labelStyle}>Estimated completion</Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: 10,
              color: colors.textBody,
              marginTop: 2,
            }}
          >
            {engagement.endDate}
          </Text>
        </View>
      </View>
      <Text style={sectionHeadingStyle}>PROJECT INVESTMENT</Text>
      <SOWPaymentBlock payment={payment} />
      <SOWFooter sowNumber={doc.sowNumber} pageLabel="Page 1 of 3" />
    </Page>
  )
}

function SOWPage2({ sowNumber }: { sowNumber: string }) {
  return (
    <Page size="Letter" margin={pageMargins}>
      <Text style={sectionHeadingStyle}>WHAT&apos;S INCLUDED</Text>
      <Text style={{ ...bodyTextStyle, marginBottom: 16 }}>
        This engagement includes problem diagnosis, process documentation, tool configuration, one
        handoff training session with your team, and a written handoff document. Scope is limited to
        the deliverables listed on page 1.
      </Text>
      <Text style={sectionHeadingStyle}>EXCLUSIONS</Text>
      <Text style={{ ...bodyTextStyle, marginBottom: 8 }}>
        The following are outside the scope of this engagement:
      </Text>
      {EXCLUSIONS.map((exclusion, index) => (
        <Text
          style={{
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 9,
            color: colors.textBody,
            marginLeft: 16,
            marginBottom: 4,
          }}
        >
          {index + 1}. {exclusion}
        </Text>
      ))}
      <Text
        style={{
          fontFamily: fonts.body,
          fontWeight: 400,
          fontSize: 9,
          color: colors.textMuted,
          marginTop: 12,
          marginBottom: 16,
        }}
      >
        Work discovered during the engagement that falls outside the agreed scope will be logged and
        reviewed together before the final handoff. If additional work is warranted, we&apos;ll
        propose a separate scope and estimate.
      </Text>
      {/*
        Terms are authored template language describing standard engagement
        mechanics (quote validity, start-date confirmation workflow, the
        existence of a stabilization period, termination notice). The SOW
        is a signed contractual document, so this is NOT Pattern A/B
        fabrication under CLAUDE.md's "no fabricated client-facing content"
        policy — parallel to CLAUDE.md Rule 3's explicit exemption for
        signed contracts. See docs/templates/sow-template.md for the full
        rationale and #398 for the audit that confirmed this read.

        What still matters: no fixed durations (the 2-week stabilization
        phrasing and the "within 1 business day" SLAs were removed). Per-
        engagement specifics (scope, pricing, milestones) remain authored.
      */}
      <Text style={sectionHeadingStyle}>TERMS</Text>
      <View style={{ marginBottom: 16 }}>
        {[
          '1. This SOW is valid for 5 business days from the date above. After expiration, scope and pricing may be revised.',
          '2. The engagement start date is tentative until the deposit is received. We will confirm the start date after the deposit clears.',
          '3. A stabilization period follows the final handoff. During this period, we will address questions and minor adjustments related to the work delivered. New scope requires a separate engagement.',
          '4. Either party may terminate this agreement with 3 business days’ written notice. Work completed to date will be delivered and invoiced proportionally.',
        ].map((term, i) => (
          <Text
            style={{
              fontFamily: fonts.body,
              fontWeight: 400,
              fontSize: 9,
              color: colors.textBody,
              marginBottom: i < 3 ? 8 : 0,
            }}
          >
            {term}
          </Text>
        ))}
      </View>
      <SOWFooter sowNumber={sowNumber} pageLabel="Page 2 of 3" />
    </Page>
  )
}

function SOWPage3({
  client,
  sowNumber,
}: {
  client: SOWTemplateProps['client']
  sowNumber: string
}) {
  return (
    <Page size="Letter" margin={pageMargins}>
      <Text style={sectionHeadingStyle}>NEXT STEPS</Text>
      <Text style={{ ...bodyTextStyle, marginBottom: 24 }}>
        Once you sign below, we will send a deposit invoice. Work begins after the deposit is
        received. We will confirm the kickoff date after the deposit clears.
      </Text>
      <Text style={sectionHeadingStyle}>AGREEMENT</Text>
      <Text style={{ ...bodyTextStyle, marginBottom: 16 }}>
        By signing below, the client agrees to the scope, timeline, pricing, and terms described in
        this document. {BRAND_NAME} agrees by presenting this Statement of Work for signature.
      </Text>
      <View style={{ width: SIGNATURE_BLOCK_WIDTH }}>
        <Text
          style={{
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: 9,
            color: colors.textPrimary,
            marginBottom: 8,
          }}
        >
          CLIENT ACCEPTANCE
        </Text>
        {/* Client signature — SignWell text tag rendered invisibly (white on white).
            SignWell places the signature field over this tag's bounding box at signing
            time, so template edits and field placement move together by construction. */}
        <Text
          style={{ fontFamily: fonts.body, fontSize: 36, color: colors.white, letterSpacing: 1 }}
        >{`{{s:${CLIENT_SIGNER_INDEX}}}`}</Text>
        <View style={{ height: 1, backgroundColor: colors.textBody, marginBottom: 4 }} />
        <Text
          style={{ fontFamily: fonts.body, fontWeight: 400, fontSize: 9, color: colors.textBody }}
        >
          {client.contactName}
        </Text>
        {client.contactTitle && (
          <Text
            style={{ fontFamily: fonts.body, fontWeight: 400, fontSize: 9, color: colors.textBody }}
          >
            {client.contactTitle}
          </Text>
        )}
        {/* Date row — "Date:" label visible, SignWell date tag rendered invisibly.
            SignWell auto-fills the signing date into the tag's bounding box. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
          <Text
            style={{
              fontFamily: fonts.body,
              fontWeight: 400,
              fontSize: 8,
              color: colors.textMuted,
              marginRight: 4,
            }}
          >
            Date:
          </Text>
          <Text
            style={{ fontFamily: fonts.body, fontSize: 11, color: colors.white, letterSpacing: 1 }}
          >{`{{d:${CLIENT_SIGNER_INDEX}}}`}</Text>
        </View>
        <Text style={{ ...finePrintStyle, marginTop: 16, lineHeight: 1.4 }}>
          {BRAND_NAME} assents to this agreement by presenting this Statement of Work for signature.
        </Text>
      </View>
      <SOWFooter sowNumber={sowNumber} pageLabel="Page 3 of 3" />
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Template component
// ---------------------------------------------------------------------------

export function SOWTemplate(props: SOWTemplateProps) {
  const { client, document: doc, engagement, items, payment } = props

  if (items.length > 8) {
    throw new Error(
      `SOW template supports a maximum of 8 deliverable items. Received ${items.length}. ` +
        'Exceeding 8 deliverables likely signals scope that is too broad for one engagement.'
    )
  }

  const rowPadding = items.length > 6 ? 4 : 6

  return (
    <Document>
      <SOWPage1
        client={client}
        doc={doc}
        engagement={engagement}
        items={items}
        payment={payment}
        rowPadding={rowPadding}
      />
      <SOWPage2 sowNumber={doc.sowNumber} />
      <SOWPage3 client={client} sowNumber={doc.sowNumber} />
    </Document>
  )
}
