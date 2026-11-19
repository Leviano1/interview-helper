# Interview Helper: design spec

Use this spec when restyling the app (previously "Rehearse"). Keep every existing feature and behaviour; only the look and page structure change. The `pages/` folder has mockups of each screen (`.dc.html` design files). They use `{{...}}` template holes and a design-tool runtime, so treat them as **visual reference only**: copy the colours, spacing and structure, not the code.

## Look
Dark navy "wireframe" style: a navy background with a faint 32px grid, content in separate rounded cards with thin borders, white text, and one blue accent.

### Colours
| Token | Hex | Use |
|---|---|---|
| bg | `#081127` | Page background |
| grid line | `rgba(143,176,255,0.05)` | 32px background grid (two linear-gradients) |
| card | `#0E1A3A` | Card background |
| card-inset | `#0B1633` | Inner boxes, list rows, card footers |
| field | `#081127` | Inputs, textarea, quotes |
| raised | `#13214A` | Active nav item, selected option, chips |
| border | `#23345F` | Card borders |
| border-strong | `#2A3D70` | Buttons, inputs |
| border-dashed | `#34497F` | Dashed (wireframe) boxes: textarea, transcript, help cards |
| divider | `#1F2E57` | Lines, progress track |
| text | `#FFFFFF` | Main text |
| text-soft | `#E6ECFA` | Long text (answers, script) |
| text-muted | `#B8C4E3` | Labels, hints |
| accent | `#2F62EA` | Primary buttons, logo tile, progress fill (white text on it passes contrast) |
| accent-light | `#8FB0FF` | Section labels, links, selected border |
| good | `#5EE3A1` | Good / said it |
| warn | `#FFC46B` | Needs work / new |
| bad | `#FF9C9C` | Missed / fix |

Status is always shown as a **word label + colour** (GOOD / SHORT / FIX, ✓ / ✗), never colour alone.

### Type (Google Fonts)
- Headings: **Space Grotesk** 600–700 (page title 36–40px, card title 18–22px, big numbers 28–30px)
- Body: **Inter** 400–600, 15px, line-height 1.5
- Labels / tags / code: **JetBrains Mono**, 11–13px. Section labels are uppercase with 0.08em letter-spacing in accent-light, e.g. `01 · SPEAK`, `02 · SCRIPT`, `03 · FEEDBACK`

### Shapes
- Cards: `border: 1px solid #23345F; border-radius: 16px; padding: 24px`. Small metric tiles: radius 14px, padding 18px
- Gap between cards: 24px. Gap inside grids: 12px
- Buttons: height 44–56px, radius 10–12px
  - Primary: accent background, white text
  - Secondary: transparent, 1px `#2A3D70` border
  - Strong secondary: white background, navy text (e.g. "Practise my script")
- Tags/pills: mono 11px, `padding: 3px 8px; border-radius: 999px; border: 1px solid <tone>; color: <tone>`
- Progress bars: 6–8px tall, track `#1F2E57`, fill accent
- Icons: inline stroke SVGs (Lucide style), 16–18px, no emoji
- Content max-width 1240px, centred, padding 32px 24px. Layouts wrap to one column on narrow screens

## Header (same on every page)
- Left: **logo, not clickable**: a 44px blue tile (radius 12) with a white robot-head icon and a small green status dot in the corner, then "Interview Helper" (Space Grotesk 21px bold) with "PRACTISE OUT LOUD" under it (mono 11px, muted)
- Middle: nav links **Practise** and **My answers**. The active link has a `#13214A` background and white text; the others are muted
- Right: a **settings cog** button (44px, bordered) that opens the Settings page. Highlighted when you're on Settings. There is no AI label in the header

## Pages

### 1. Practise (home)
1. **Hero card** `01 · SPEAK`: "Practise interview answers out loud." with a subtitle, a big **Start practice** button, and a mic status row with a small green level bar
2. A row (wraps on narrow screens):
   - **Script card** `02 · SCRIPT`, wide: title, "Show example / Open .txt / Save .txt" buttons, a dashed mono textarea, then **Load script** (secondary) and **Practise my script** (white)
   - A right column holding two cards:
     - **Now asking**: label, "Q 2 / 3", the big question text, a hint chip, and a 3-button grid (Peek points / Repeat / Next) with icons
     - **Your own question**: an input plus an **Ask me** button
3. **Feedback** `03 · FEEDBACK`: a heading with a "Score 4 / 6" pill, then a grid of 6 metric tiles (Length, Pace, Filler words, Long pauses, "I" vs "we", Result). Each tile has a label, a status tag, a big value and a one-line note
4. Two cards side by side:
   - **What you said**: a dashed quote box with fillers highlighted
   - **Key points hit**: a big %, a progress bar, and a grid of ✓/✗ point chips
5. **Your model answer**: the text, with words you said underlined in green and words you missed struck through in light red, plus a legend. Footer buttons: Practise again (primary), Read it to me, Edit, Improve with this attempt

### 2. My answers (combines "This session" and "My answers")
- Title "My answers", with Import, Export and **+ New answer** at the top right
- A row of 4 summary tiles: saved answers, attempts this session, average delivery score, average key points hit
- **This session** card: a table (#, Question, Length, WPM, Fillers, Key points, Score pill) that scrolls sideways on mobile, plus the hint "Say 'how did I do overall?'"
- **Saved model answers**: a grid of cards. Each card has a status tag (NEW / PRACTISED), the key-point count, the question, a best-score progress bar, a meta line, and buttons Practise (white), Edit (icon) and Delete (icon)

### 3. Settings (opens from the cog)
Two columns that wrap:
- **AI settings** card (wide):
  - Two info boxes: "ALWAYS ON: Delivery feedback" and "WITH AI: Smarter coaching"
  - **AI provider** as 4 selectable radio cards: Chrome built-in AI (FREE), Google Gemini (FREE KEY), OpenAI (PAID), Off (NO AI). The selected card gets a 2px `#8FB0FF` border and a `#13214A` background
  - The API key + Model fields and help text show **only** for Gemini or OpenAI, with the lock note "Keys are stored only in this browser."
  - Picking Off shows a short note instead
  - Footer: Cancel / Save
- **Things you can say** card (dashed border): a list of rows, each with the voice command in mono and what it does on the right
