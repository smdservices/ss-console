// SMD Services business card generator — Moo Standard US, letterpress-prepped.
// Run: node scripts/marketing/generate-card.mjs
//
// Ad-hoc deps (not in package.json — keep these out of the project tree):
//   npm install --no-save pdf-lib @pdf-lib/fontkit
//
// Requires ghostscript installed locally (`brew install ghostscript`).
//
// Spec: moo.com/us/business-cards/design-guidelines (verified 2026-05-07)
//   Trim:  3.50" x 2.00"  (88.90 x 50.80 mm)
//   Bleed: 3.66" x 2.16"  (92.96 x 54.86 mm)  <- file size
//   Safe:  3.34" x 1.84"  (84.84 x 46.74 mm)
//   CMYK, vector PDF, <=50MB.
//
// Output: ~/Desktop/smd-business-card/smd-card-final-letterpress.pdf
// (text converted to outlines via gs, no font dependency at print time).
import { PDFDocument, cmyk } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

const PT = 72
const BLEED = { w: 3.66 * PT, h: 2.16 * PT }
const SAFE_INSET_FROM_BLEED = 0.16 * PT // 0.08" bleed margin + 0.08" safe inset

const CONTENT = {
  brand: 'SMD',
  subbrand: 'SERVICES',
  name: 'Scott Durgan',
  title: 'Principal',
  phone: '602.999.5967',
  email: 'scott@smd.services',
  url: 'smd.services',
}

const INK = cmyk(0, 0, 0, 1) // pure CMYK black

// macOS system fonts (TTF, single-file, no TTC extraction needed)
const FONTS = {
  caslon: '/System/Library/Fonts/Supplemental/BigCaslon.ttf',
  georgia: '/System/Library/Fonts/Supplemental/Georgia.ttf',
  georgiaBold: '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
  georgiaItalic: '/System/Library/Fonts/Supplemental/Georgia Italic.ttf',
}

async function main() {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle('SMD Services Business Card')
  doc.setAuthor('SMD Services')

  const caslon = await doc.embedFont(await fs.readFile(FONTS.caslon), { subset: true })
  const georgia = await doc.embedFont(await fs.readFile(FONTS.georgia), { subset: true })
  const georgiaBold = await doc.embedFont(await fs.readFile(FONTS.georgiaBold), { subset: true })
  const georgiaItalic = await doc.embedFont(await fs.readFile(FONTS.georgiaItalic), { subset: true })

  // Manual letter-spacing helper: spaces each character by tracking units
  // (relative to font size). pdf-lib doesn't expose character spacing directly,
  // so we render each char with computed x advance + tracking.
  function drawTracked(page, text, opts) {
    const { x, y, size, font, color, tracking } = opts
    let cursor = x
    for (const ch of text) {
      page.drawText(ch, { x: cursor, y, size, font, color })
      cursor += font.widthOfTextAtSize(ch, size) + tracking * size
    }
  }

  // ---- FRONT ----
  const front = doc.addPage([BLEED.w, BLEED.h])
  const xLeft = SAFE_INSET_FROM_BLEED + 0.04 * PT
  const topSafeY = BLEED.h - SAFE_INSET_FROM_BLEED

  // SMD wordmark — Big Caslon, display weight by design
  const brandSize = 32
  const brandBaselineY = topSafeY - brandSize - 0.04 * PT
  front.drawText(CONTENT.brand, {
    x: xLeft,
    y: brandBaselineY,
    size: brandSize,
    font: caslon,
    color: INK,
  })

  // SERVICES — Big Caslon, smaller, with tracking for refinement
  const subSize = 9.5
  const subBaselineY = brandBaselineY - subSize - 0.20 * PT
  drawTracked(front, CONTENT.subbrand, {
    x: xLeft + 0.02 * PT,
    y: subBaselineY,
    size: subSize,
    font: caslon,
    color: INK,
    tracking: 0.22, // ~220/1000em — refined letter-spacing
  })

  // ---- BACK ----
  const back = doc.addPage([BLEED.w, BLEED.h])
  const bottomSafeY = SAFE_INSET_FROM_BLEED

  // Identity (top-left)
  const nameSize = 11
  const titleSize = 9
  const nameBaselineY = topSafeY - nameSize - 0.06 * PT
  back.drawText(CONTENT.name, {
    x: xLeft,
    y: nameBaselineY,
    size: nameSize,
    font: georgiaBold,
    color: INK,
  })
  const titleBaselineY = nameBaselineY - titleSize * 1.55
  back.drawText(CONTENT.title, {
    x: xLeft,
    y: titleBaselineY,
    size: titleSize,
    font: georgiaItalic,
    color: INK,
  })

  // Contact stack (bottom-left)
  const contactSize = 8.5
  const contactLineGap = contactSize * 1.55
  const urlBaselineY = bottomSafeY + 0.06 * PT
  const emailBaselineY = urlBaselineY + contactLineGap
  const phoneBaselineY = emailBaselineY + contactLineGap

  back.drawText(CONTENT.phone, {
    x: xLeft, y: phoneBaselineY, size: contactSize, font: georgia, color: INK,
  })
  back.drawText(CONTENT.email, {
    x: xLeft, y: emailBaselineY, size: contactSize, font: georgia, color: INK,
  })
  back.drawText(CONTENT.url, {
    x: xLeft, y: urlBaselineY, size: contactSize, font: georgia, color: INK,
  })

  // ---- Save embedded-font version ----
  const bytes = await doc.save()
  const outDir = path.join(os.homedir(), 'Desktop', 'smd-business-card')
  await fs.mkdir(outDir, { recursive: true })

  const embeddedPath = path.join(outDir, '_with-embedded-fonts.pdf')
  await fs.writeFile(embeddedPath, bytes)

  // ---- Outline via ghostscript ----
  const finalPath = path.join(outDir, 'smd-card-final-letterpress.pdf')
  execSync(
    `gs -q -o "${finalPath}" -dNoOutputFonts -sDEVICE=pdfwrite ` +
      `-dPDFSETTINGS=/prepress -dCompatibilityLevel=1.6 ` +
      `"${embeddedPath}"`,
    { stdio: 'pipe' },
  )

  // ---- Per-page previews from outlined version ----
  const finalBytes = await fs.readFile(finalPath)
  const finalDoc = await PDFDocument.load(finalBytes)

  const frontDoc = await PDFDocument.create()
  const [frontCopy] = await frontDoc.copyPages(finalDoc, [0])
  frontDoc.addPage(frontCopy)
  await fs.writeFile(path.join(outDir, '_preview-front.pdf'), await frontDoc.save())

  const backDoc = await PDFDocument.create()
  const [backCopy] = await backDoc.copyPages(finalDoc, [1])
  backDoc.addPage(backCopy)
  await fs.writeFile(path.join(outDir, '_preview-back.pdf'), await backDoc.save())

  console.log(`Embedded-font PDF: ${embeddedPath}`)
  console.log(`  ${(bytes.length / 1024).toFixed(1)} KB`)
  console.log(`Outlined (UPLOAD THIS): ${finalPath}`)
  console.log(`  ${(finalBytes.length / 1024).toFixed(1)} KB`)
  console.log(`Page size: 263.52pt x 155.52pt = 3.66" x 2.16" (bleed)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
