/**
 * The COS look, taken from the Victron Power page (James, 28 Nov 2026: "I want this theme on my entire program").
 *
 * One set of values every screen uses: graphite cards with a fine champagne edge, small gold uppercase
 * labels, light clean numbers, a gold main button with an outlined second button.
 *
 * Rules that do not change with the look:
 * - Status colours keep their meaning and their colours: red Down, amber Camera issues, green Up, grey Unknown.
 *   Champagne is chrome (labels, edges, buttons), never a status, so nothing gold can be read as a warning.
 * - The COS red mark and the red bottom bar stay; they are the brand.
 * - Text on lists and the board stays bigger and stronger than on the Victron page, for a phone in the sun.
 * - PDFs keep the red-and-black IT sheet look. This is the app only.
 */

/** The values, as CSS custom properties. Use these, not raw colours, so every screen moves together. */
export const COS_THEME_VARS = [
  '--cos-lux:#d8bf8a',
  '--cos-lux-strong:#e6d8b8',
  '--cos-lux-soft:rgba(216,191,138,.34)',
  '--cos-lux-faint:rgba(216,191,138,.14)',
  '--cos-ink:#f6f0e4',
  '--cos-mute:#98a1b0',
  '--cos-hair:rgba(255,255,255,.07)',
  '--cos-card:radial-gradient(130% 90% at 0% 0%,#1a1f29 0%,#10131a 60%,#0b0d12 100%)',
  '--cos-card-flat:#10131a',
  '--cos-card-edge:inset 0 1px 0 rgba(255,255,255,.05),0 8px 20px rgba(0,0,0,.28)',
  '--cos-gold-button:linear-gradient(180deg,#f0dcae 0%,#d8bf8a 55%,#b99a5c 100%)',
  '--cos-gold-button-ink:#1b1408',
  '--cos-radius:16px',
].join(';');

/**
 * The COS Board in this look. The board draws inside its own shadow root, so it gets the values
 * here and these rules are added after its own styles. Only how things look changes: no layout,
 * no wording, no status colour.
 */
export const COS_BOARD_THEME_CSS = `
/* ---- COS look (from the Victron Power page, 28 Nov 2026) ---- */
:host{${COS_THEME_VARS}}
.cosb{--s1:#10131a;--s2:#161b24;--s3:#1c222d;--line:var(--cos-lux-faint);--line2:rgba(216,191,138,.22);--rad:var(--cos-radius)}
.top{background:linear-gradient(180deg,#0c1119,#080b11);border-bottom:1px solid var(--cos-lux-faint)}
.eyebrow{color:var(--cos-lux);letter-spacing:.16em;text-transform:uppercase;font-size:11px}
h1{letter-spacing:-.005em}
.asof{background:#0a0e15;border-bottom:1px solid var(--cos-lux-faint)}
.refresh,.fixbtn,.trbtn.go,.tool.t-tr{background:var(--cos-gold-button);color:var(--cos-gold-button-ink);box-shadow:0 6px 18px -8px rgba(216,191,138,.55),inset 0 1px 0 rgba(255,255,255,.45)}
.fixbtn.alt,.close,.lk,.segb,.pdone{background:transparent;border:1px solid var(--cos-lux-soft);box-shadow:none;color:var(--cos-ink)}
a.lk,button.mgitem{color:var(--cos-lux-strong)}
.tab{border-color:var(--cos-lux-faint);color:var(--cos-mute)}
.tab[aria-selected="true"]{background:var(--cos-card);border-color:var(--cos-lux-soft);color:var(--cos-ink);box-shadow:var(--cos-card-edge)}
.chip{background:transparent;border-color:var(--cos-lux-faint);color:var(--cos-mute)}
.chip[aria-pressed="true"]{background:var(--cos-card);border-color:var(--cos-lux-soft);color:var(--cos-ink)}
.search{background:#0b0e14;border-color:var(--cos-lux-faint)}
.search:focus{border-color:var(--cos-lux-soft);outline:none}
/* The four counts: graphite cards, a status dot in the corner, the number light but still bold enough to read outside. */
.tile,.mini,.mgnum{background:var(--cos-card);border:1px solid var(--cos-lux-faint);box-shadow:var(--cos-card-edge)}
.tile{position:relative;border-radius:var(--cos-radius)}
.tile .num{font-weight:600;letter-spacing:-.025em}
.tile .lab{font-size:11.5px;font-weight:650;letter-spacing:.13em;text-transform:uppercase;color:var(--cos-mute)}
.tile[aria-pressed="true"]{background:var(--cos-card);border-color:var(--c);box-shadow:0 0 0 1px var(--c),var(--cos-card-edge)}
.tile[aria-pressed="true"] .lab{color:var(--cos-ink)}
.mini{border-radius:14px;color:var(--cos-mute);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.mini b{font-weight:600;color:var(--cos-ink);letter-spacing:-.02em;text-transform:none}
.mini[aria-pressed="true"]{border-color:var(--cos-lux-soft);color:var(--cos-ink)}
.count{color:var(--cos-lux);font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
/* Unit rows: the status colour keeps its edge, on a graphite card. */
.row{background:var(--cos-card);border-color:var(--cos-lux-faint);border-left-color:var(--c);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.row .name{color:var(--cos-ink)}
.row .side small{color:var(--cos-mute)}
.tag{background:transparent;border-color:var(--cos-lux-faint);color:var(--cos-mute)}
/* A unit's card. */
.panel{background:radial-gradient(900px 520px at 70% -10%,#1a1f29 0%,transparent 60%),#07090d}
.phead{background:linear-gradient(180deg,#0c1119,#080b11)}
.phead h2{color:var(--cos-ink)}
.box,.prow,.tcard,.hist li{background:var(--cos-card);border-color:var(--cos-lux-faint);border-radius:var(--cos-radius);box-shadow:var(--cos-card-edge)}
.box h3,.tsec h3,.mgedit h3,.cmp .hd{color:var(--cos-lux);letter-spacing:.16em}
.kv dt,.note{color:var(--cos-mute)}
.box.trb,.box.chkb{background:var(--cos-card)}
.empty{background:var(--cos-card);border-color:var(--cos-lux-faint)}
.mapwrap{border-color:var(--cos-lux-faint);border-radius:var(--cos-radius)}
.toast{background:#141821;border-color:var(--cos-lux-faint);border-left-color:var(--cos-lux)}
`;
