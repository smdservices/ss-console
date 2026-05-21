/**
 * Clerk `appearance` configuration that themes the <SignIn> and <SignUp>
 * widgets to match the SMD Services Plainspoken Sign Shop identity.
 *
 * Values are sourced from @venturecrane/tokens/ss.css (the canonical
 * design tokens for the venture). Clerk's `variables` slot accepts
 * literal hex strings, not CSS var refs, so we duplicate the hex
 * values here. If a token shifts, update this file in lockstep.
 *
 * Style notes (Plainspoken aesthetic):
 *   - Sharp corners everywhere (borderRadius: 0)
 *   - Heavy 3px ink borders on cards, inputs, and primary buttons
 *   - Cream background, ink text, burnt-orange primary
 *   - Archivo / Archivo Narrow typography (matches header monogram)
 *   - All-caps Archivo Narrow on buttons and small labels
 *
 * The "Secured by Clerk" footer is locked to the Hobby tier and
 * remains visible until we upgrade. Everything else is themed below.
 */

// Hex values mirror @venturecrane/tokens/ss.css.
const COLOR = {
  background: '#f5f0e3',
  textPrimary: '#1a1512',
  textSecondary: '#4a423c',
  primary: '#c5501e',
  primaryHover: '#a84318',
  complete: '#4a6b3e',
  error: '#a02a2a',
} as const

export const clerkAppearance = {
  variables: {
    colorPrimary: COLOR.textPrimary,
    colorBackground: COLOR.background,
    colorText: COLOR.textPrimary,
    colorTextSecondary: COLOR.textSecondary,
    colorTextOnPrimaryBackground: '#ffffff',
    colorInputBackground: COLOR.background,
    colorInputText: COLOR.textPrimary,
    colorDanger: COLOR.error,
    colorSuccess: COLOR.complete,
    colorNeutral: COLOR.textPrimary,
    borderRadius: '0',
    fontFamily: 'Archivo, system-ui, sans-serif',
    fontFamilyButtons: 'Archivo, system-ui, sans-serif',
    fontSize: '0.9375rem',
    fontWeight: {
      normal: '400',
      medium: '500',
      bold: '700',
    },
    spacingUnit: '0.25rem',
  },
  elements: {
    // Card chrome: 3px ink border, sharp corners, cream background, no shadow.
    card:
      'rounded-none border-[3px] border-[color:var(--ss-color-text-primary)] ' +
      'bg-[color:var(--ss-color-background)] shadow-none',
    rootBox: 'w-full',
    // Header
    headerTitle:
      "font-['Archivo'] font-black uppercase tracking-tight " +
      'text-[color:var(--ss-color-text-primary)]',
    headerSubtitle:
      "font-['Archivo_Narrow'] uppercase tracking-[0.12em] " +
      'text-[color:var(--ss-color-text-secondary)]',
    // Primary button: ink filled, sharp, uppercase Archivo Narrow, burnt-orange on hover.
    formButtonPrimary:
      'rounded-none border-[3px] border-[color:var(--ss-color-text-primary)] ' +
      'bg-[color:var(--ss-color-text-primary)] text-white ' +
      "font-['Archivo_Narrow'] font-bold uppercase tracking-[0.12em] " +
      'hover:bg-[color:var(--ss-color-primary)] hover:border-[color:var(--ss-color-primary)] ' +
      'focus-visible:ring-2 focus-visible:ring-[color:var(--ss-color-action)] ' +
      'focus-visible:ring-offset-2 transition-colors',
    // Secondary / form button reset
    formButtonReset:
      'rounded-none text-[color:var(--ss-color-text-secondary)] ' +
      'hover:text-[color:var(--ss-color-text-primary)]',
    // Input fields: heavy ink border, sharp, cream background.
    formFieldInput:
      'rounded-none border-[3px] border-[color:var(--ss-color-text-primary)] ' +
      'bg-[color:var(--ss-color-background)] text-[color:var(--ss-color-text-primary)] ' +
      'focus:ring-2 focus:ring-[color:var(--ss-color-action)] focus:ring-offset-0',
    formFieldLabel:
      "font-['Archivo_Narrow'] uppercase tracking-[0.12em] font-bold text-sm " +
      'text-[color:var(--ss-color-text-primary)]',
    formFieldHintText: 'text-xs text-[color:var(--ss-color-text-secondary)]',
    formFieldErrorText: 'text-xs text-[color:var(--ss-color-error)]',
    // Social buttons (Google, etc. — if enabled later)
    socialButtonsBlockButton:
      'rounded-none border-[3px] border-[color:var(--ss-color-text-primary)] ' +
      'bg-[color:var(--ss-color-background)] text-[color:var(--ss-color-text-primary)] ' +
      "font-['Archivo_Narrow'] uppercase tracking-[0.12em] font-bold " +
      'hover:bg-[color:var(--ss-color-border-subtle)]',
    socialButtonsBlockButtonText: "font-['Archivo_Narrow'] uppercase tracking-[0.12em] font-bold",
    // Footer + action links. Normal-case here so email addresses
    // (rendered in identity-preview rows like "Signed in as foo@bar")
    // are not text-transformed and don't overflow the card.
    footer: 'rounded-none bg-[color:var(--ss-color-background)]',
    footerAction: "font-['Archivo_Narrow'] text-sm normal-case tracking-normal",
    footerActionLink:
      "font-['Archivo_Narrow'] font-bold uppercase tracking-[0.12em] " +
      'text-[color:var(--ss-color-primary)] hover:text-[color:var(--ss-color-primary-hover)] ' +
      'underline-offset-2',
    footerActionText: 'text-[color:var(--ss-color-text-secondary)] normal-case tracking-normal',
    // Identity preview (e.g., "Signed in as ___"). Force normal case so
    // the email reads as-typed and the row fits inside the card.
    identityPreviewText: 'normal-case tracking-normal text-[color:var(--ss-color-text-secondary)]',
    identityPreviewEditButton: 'normal-case tracking-normal text-[color:var(--ss-color-primary)]',
    // OTP / verification code inputs
    otpCodeFieldInput:
      'rounded-none border-[3px] border-[color:var(--ss-color-text-primary)] ' +
      'bg-[color:var(--ss-color-background)]',
    // Form section divider
    dividerLine: 'bg-[color:var(--ss-color-text-primary)]',
    dividerText:
      "font-['Archivo_Narrow'] uppercase tracking-[0.14em] text-xs " +
      'text-[color:var(--ss-color-text-secondary)]',
    // Alert + notice surfaces
    alert: 'rounded-none border-[3px]',
    alertText: "font-['Archivo_Narrow'] text-sm",
    // Spinner + busy state
    spinner: 'text-[color:var(--ss-color-primary)]',
  },
} as const
