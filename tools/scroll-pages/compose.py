"""Compose Temple Explorer scroll pages on Provat's own parchment.

The blank plate was lifted from his wall-comparison scroll (a clean, ink-free
band tiled through the middle so the torn edges and side rolls survive), so
these pages sit on exactly the same sheet as the three he drew himself.
Illustrations are frames from his own walkthrough video — his renders, his
temple, no outside imagery.
"""

from PIL import Image, ImageDraw, ImageFont
import numpy as np

PLATE = 'plate.webp'
FONT_DIR = '/usr/share/fonts/truetype/google-fonts'
F_REG = f'{FONT_DIR}/Poppins-Regular.ttf'
F_MED = f'{FONT_DIR}/Poppins-Medium.ttf'
F_BOLD = f'{FONT_DIR}/Poppins-Bold.ttf'
F_ITAL = f'{FONT_DIR}/Poppins-Italic.ttf'

INK = (28, 22, 16)
SHEET_L, SHEET_R = 245, 1355      # usable interior of the sheet
TEXT_W = 1010                     # wrap width for body copy


def font(path, size):
    return ImageFont.truetype(path, size)


def tokenize(text):
    """'a **b**. c' -> [(word, is_bold, space_before), ...]

    space_before is tracked separately so punctuation that follows a bold run
    ("**237 BCE**.") does not pick up a stray space before the full stop.
    """
    tokens, bold, buf, pending_space = [], False, '', False
    for part in text.split('**'):
        for ch in part:
            if ch == ' ':
                if buf:
                    tokens.append((buf, bold, pending_space))
                    buf = ''
                pending_space = True
            else:
                buf += ch
        if buf:
            tokens.append((buf, bold, pending_space))
            buf, pending_space = '', False
        bold = not bold
    if buf:
        tokens.append((buf, bold, pending_space))
    return tokens


def wrap_runs(tokens, reg, bold, max_w, draw):
    """Word-wrap tokens into lines, keeping each token's space_before flag."""
    lines, cur, cur_w = [], [], 0.0
    for word, b, sp in tokens:
        f = bold if b else reg
        gap = draw.textlength(' ', font=reg) if (sp and cur) else 0.0
        w = draw.textlength(word, font=f)
        if cur and cur_w + gap + w > max_w:
            lines.append(cur)
            cur, cur_w = [], 0.0
            gap = 0.0
        cur.append((word, b, bool(gap)))
        cur_w += gap + w
    if cur:
        lines.append(cur)
    return lines


def line_width(draw, line, reg, bold):
    total = 0.0
    for word, b, gap in line:
        if gap:
            total += draw.textlength(' ', font=reg)
        total += draw.textlength(word, font=(bold if b else reg))
    return total


def draw_centered_runs(draw, lines, y, reg, bold, cx, leading):
    for line in lines:
        x = cx - line_width(draw, line, reg, bold) / 2
        for word, b, gap in line:
            if gap:
                x += draw.textlength(' ', font=reg)
            f = bold if b else reg
            draw.text((x, y), word, font=f, fill=INK)
            x += draw.textlength(word, font=f)
        y += leading
    return y


def framed(img_path, target_w, target_h):
    """Crop-to-fill an illustration and give it the thin dark frame his
    hieroglyphics page uses."""
    im = Image.open(img_path).convert('RGB')
    sw, sh = im.size
    scale = max(target_w / sw, target_h / sh)
    im = im.resize((int(sw * scale + 1), int(sh * scale + 1)), Image.LANCZOS)
    left = (im.width - target_w) // 2
    top = (im.height - target_h) // 2
    im = im.crop((left, top, left + target_w, top + target_h))

    framed_im = Image.new('RGB', (target_w + 6, target_h + 6), (60, 46, 32))
    framed_im.paste(im, (3, 3))
    return framed_im


def build_page(out_path, title, lead, body, image, caption=None, more=False):
    plate = Image.open(PLATE).convert('RGB')
    draw = ImageDraw.Draw(plate)
    cx = (SHEET_L + SHEET_R) // 2

    f_title = font(F_BOLD, 44)
    f_lead = font(F_REG, 32)
    f_body = font(F_REG, 31)
    f_body_b = font(F_BOLD, 31)
    f_cap = font(F_REG, 24)
    f_more = font(F_ITAL, 30)

    y = 202
    tw = draw.textlength(title, font=f_title)
    draw.text((cx - tw / 2, y), title, font=f_title, fill=INK)
    y += 72

    if lead:
        lead_lines = wrap_runs(tokenize(lead), f_lead, font(F_BOLD, 32), TEXT_W, draw)
        y = draw_centered_runs(draw, lead_lines, y, f_lead, font(F_BOLD, 32), cx, 44)
        y += 12

    # Work out how much room the body needs, so the illustration can take
    # whatever is left rather than crowding the text off the sheet.
    body_lines = wrap_runs(tokenize(body), f_body, f_body_b, TEXT_W, draw)
    body_h = len(body_lines) * 44
    cap_h = 38 if caption else 0
    bottom_limit = 872
    img_top = y
    img_h = bottom_limit - body_h - cap_h - 30 - img_top
    img_h = max(230, min(img_h, 330))
    img_w = int(img_h * 16 / 9)

    illo = framed(image, img_w, img_h)
    plate.paste(illo, (cx - illo.width // 2, img_top))
    y = img_top + illo.height + 14

    if caption:
        cw = draw.textlength(caption, font=f_cap)
        draw.text((cx - cw / 2, y), caption, font=f_cap, fill=(78, 62, 46))
        y += cap_h

    y += 10
    y = draw_centered_runs(draw, body_lines, y, f_body, f_body_b, cx, 44)

    if more:
        mw = draw.textlength('...More Info', font=f_more)
        draw.text((SHEET_R - 40 - mw, 838), '...More Info', font=f_more, fill=INK)

    plate.save(out_path)
    print('wrote', out_path)


PAGES = [
    dict(
        out='page_pylon.png',
        title='The Pylon',
        lead='The Temple of Horus was begun in **237 BCE**.',
        image='frames/pylon.jpg',
        caption='The pylon and the enclosure wall from the north',
        body='The entrance is marked by a grand pylon **62.6 metres across** and '
             '**30.5 metres high**. Great care was given to align it with the noontime '
             'sun at the midsummer solstice, so that at that moment the pylon casts '
             '**no shadow**.',
    ),
    dict(
        out='page_courtyard.png',
        title='Central Courtyard',
        lead='The pylon leads to a court colonnaded on three sides, '
             'a very **un-Egyptian** motif.',
        image='frames/courtyard.jpg',
        caption='The colonnade, thirty-two columns on three sides',
        body='The colonnade not only frames the entrance but also forms a type of '
             'extended porch which, with the perimeter walls, creates a passageway '
             'connecting to the **ambulatory** between the temple and its enclosing wall.',
    ),
    dict(
        out='page_hypostyle.png',
        title='Hypostyle Hall',
        lead='There were **two** hypostyle halls.',
        image='frames/hypostyle.jpg',
        caption='Columns of the hypostyle hall',
        body='The second one had two rooms on the sides. The room to the west was used '
             'for the **preparation of sacred ointments**, and the one to the east as a '
             '**treasury** for cult implements and clothes.',
    ),
    dict(
        out='page_inner_court.png',
        title='Inner Court',
        lead='Past the two hypostyle halls is an inner court.',
        image='frames/inner-court.jpg',
        caption='The inner court, approaching the sanctuary',
        body='In the centre of it stands the **freestanding sanctuary of Horus** — a '
             'shrine within a room, with a corridor running around it, so the holiest '
             'part of the temple can be walked entirely around.',
    ),
    dict(
        out='page_chapels.png',
        title='Chapels',
        lead='The court also gives access to **thirteen small chapels** for the pantheon.',
        image='frames/chapels.jpg',
        caption='A chapel doorway off the surrounding corridor',
        body='All are windowless and **completely dark** except for tiny slit entries. '
             'Each was dedicated to a god or goddess associated with Horus.',
    ),
    dict(
        out='page_sanctuary.png',
        title='Sanctuary — Ark of Horus',
        lead='The freestanding sanctuary stands at the centre of the inner court.',
        image='frames/sanctuary.jpg',
        caption='The shrine of Horus in the sanctuary',
        body='Its shrine of **black granite** was made for **Nectanebo II**, nearly a '
             'century before the temple was built around it. It held the sacred barque, '
             'a gilded ceremonial boat that carried the god in procession, kept in the '
             'dark and brought out on feast days.',
    ),
]

if __name__ == '__main__':
    for page in PAGES:
        build_page(page.pop('out'), **page)
