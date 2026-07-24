/**
 * Meta Pixel bootstrap (ADR 0066 launch gate 2, #1723). Loaded by
 * src/components/MetaPixel.astro with the pixel id in data-pixel-id.
 *
 * Order matters: Global Privacy Control is honored before anything
 * loads, and Limited Data Use (geo auto-detect 0/0) is set BEFORE
 * init so every browser event carries the CCPA posture — matching the
 * server-side CAPI events in src/lib/marketing/meta-capi.ts.
 */
;(function () {
  var script = document.currentScript
  var pixelId = script && script.getAttribute('data-pixel-id')
  if (!pixelId) return
  if (navigator.globalPrivacyControl) return

  // Standard Meta Pixel snippet (function stub + async fbevents.js load).
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
    }
    if (!f._fbq) f._fbq = n
    n.push = n
    n.loaded = !0
    n.version = '2.0'
    n.queue = []
    t = b.createElement(e)
    t.async = !0
    t.src = v
    s = b.getElementsByTagName(e)[0]
    s.parentNode.insertBefore(t, s)
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')

  window.fbq('dataProcessingOptions', ['LDU'], 0, 0)
  window.fbq('init', pixelId)
  window.fbq('track', 'PageView')
})()
