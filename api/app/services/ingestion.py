import hashlib
import re
from dataclasses import dataclass, field
from io import BytesIO

import pypdfium2 as pdfium
from docx import Document
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph as DocxParagraph
from PIL import Image, ImageOps
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.oxml.ns import qn
from pypdf import PdfReader
from pypdf.errors import PdfReadError


@dataclass
class ExtractedPage:
    page_number: int
    markdown: str
    images: list[bytes] = field(default_factory=list)
    has_native_text: bool = False


def optimize_image(body: bytes, max_edge: int = 2048) -> bytes:
    with Image.open(BytesIO(body)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=88, optimize=True)
        return output.getvalue()


def extract_pages(filename: str, body: bytes) -> list[ExtractedPage]:
    extension = filename.rsplit(".", 1)[-1].casefold()
    if extension in {"png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp", "gif"}:
        return [ExtractedPage(1, "## Imagen 1", [body])]
    if extension == "pdf":
        return _extract_pdf_pages(body)
    if extension == "docx":
        return _extract_docx_pages(body)
    if extension == "pptx":
        return _extract_pptx_pages(body)
    if extension == "txt":
        text = body.decode("utf-8-sig")
        return [ExtractedPage(1, f"## Documento\n\n{text}", has_native_text=bool(text.strip()))]
    raise ValueError("Unsupported file format")


def _extract_pdf_pages(body: bytes) -> list[ExtractedPage]:
    reader = PdfReader(BytesIO(body))
    visual_pdf = pdfium.PdfDocument(body)
    if len(reader.pages) != len(visual_pdf):
        visual_pdf.close()
        raise ValueError("PDF page count could not be read consistently")

    pages = []
    try:
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            has_text = _is_readable_text(text)
            images: list[bytes] = []
            if has_text:
                try:
                    images = _deduplicate_images(item.data for item in page.images)
                except (AttributeError, KeyError, OSError, PdfReadError, TypeError, ValueError):
                    images = []
            else:
                visual_page = visual_pdf[index]
                width, height = visual_page.get_size()
                scale = min(2048 / width, 2048 / height)
                rendered = visual_page.render(scale=scale).to_pil()
                output = BytesIO()
                rendered.save(output, format="PNG")
                images = [output.getvalue()]

            markdown = _page_markdown("Página", index + 1, text)
            pages.append(ExtractedPage(index + 1, markdown, images, has_text))
    finally:
        visual_pdf.close()
    return pages


def _extract_docx_pages(body: bytes) -> list[ExtractedPage]:
    document = Document(BytesIO(body))
    blocks = []
    for item in document.iter_inner_content():
        if isinstance(item, DocxParagraph):
            text = _docx_paragraph_markdown(item)
            if text:
                blocks.append(text)
        elif isinstance(item, DocxTable):
            text = _docx_table_markdown(item)
            if text:
                blocks.append(text)

    images = _deduplicate_images(
        relationship.target_part.blob
        for relationship in document.part.rels.values()
        if relationship.reltype.endswith("/image") and not relationship.is_external
    )
    text = "\n\n".join(blocks)
    return [ExtractedPage(1, _page_markdown("Documento", 1, text), images, bool(text.strip()))]


def _extract_pptx_pages(body: bytes) -> list[ExtractedPage]:
    presentation = Presentation(BytesIO(body))
    pages = []
    for index, slide in enumerate(presentation.slides, 1):
        blocks = []
        images = []
        title_shape = slide.shapes.title
        for shape in slide.shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                images.append(shape.image.blob)
            elif getattr(shape, "has_table", False):
                blocks.append(_pptx_table_markdown(shape.table))
            elif getattr(shape, "has_text_frame", False):
                text = _pptx_text_markdown(shape)
                if text:
                    if title_shape is not None and shape.shape_id == title_shape.shape_id:
                        blocks.append(f"### {text}")
                    else:
                        blocks.append(text)

        text = "\n\n".join(blocks)
        pages.append(ExtractedPage(
            index, _page_markdown("Diapositiva", index, text),
            _deduplicate_images(images), bool(text.strip()),
        ))
    return pages


def _page_markdown(label: str, number: int, text: str) -> str:
    content = _normalize_markdown(text)
    return f"## {label} {number}" + (f"\n\n{content}" if content else "")


def _docx_paragraph_markdown(paragraph: DocxParagraph) -> str:
    text = _normalize_inline_text(paragraph.text)
    if not text:
        return ""
    style = paragraph.style.name.casefold() if paragraph.style else ""
    heading = re.search(r"heading\s*(\d+)", style)
    if heading:
        return f"{'#' * min(int(heading.group(1)) + 2, 6)} {text}"
    if style == "title":
        return f"### {text}"
    if "bullet" in style or "viñeta" in style:
        left_indent = paragraph.paragraph_format.left_indent
        indent_level = int(left_indent.pt / 18) if left_indent else 0
        return f"{'  ' * indent_level}- {text}"
    if "number" in style or "numerada" in style:
        return f"1. {text}"
    return text


def _docx_table_markdown(table: DocxTable) -> str:
    rows = [[_table_cell_text(cell.text) for cell in row.cells] for row in table.rows]
    return _rows_to_markdown(rows)


def _pptx_text_markdown(shape) -> str:
    lines = []
    body_placeholder = shape.is_placeholder and shape.placeholder_format.type in {
        PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT,
    }
    for paragraph in shape.text_frame.paragraphs:
        text = _normalize_inline_text(paragraph.text)
        if not text:
            continue
        properties = paragraph._pPr
        is_bullet = body_placeholder or paragraph.level > 0 or bool(properties is not None and (
            properties.find(qn("a:buChar")) is not None
            or properties.find(qn("a:buAutoNum")) is not None
        ))
        if is_bullet:
            text = f"{'  ' * paragraph.level}- {text}"
        lines.append(text)
    return "\n".join(lines)


def _pptx_table_markdown(table) -> str:
    return _rows_to_markdown([
        [_table_cell_text(cell.text) for cell in row.cells]
        for row in table.rows
    ])


def _rows_to_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = "| " + " | ".join(normalized[0]) + " |"
    separator = "| " + " | ".join("---" for _ in range(width)) + " |"
    body = ["| " + " | ".join(row) + " |" for row in normalized[1:]]
    return "\n".join([header, separator, *body])


def _table_cell_text(text: str) -> str:
    return _normalize_inline_text(text).replace("|", "\\|").replace("\n", "<br>")


def _normalize_inline_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def _is_readable_text(text: str) -> bool:
    normalized = text.strip()
    if len(normalized) < 12:
        return False
    useful = sum(character.isalnum() for character in normalized)
    return useful >= 8 and useful / len(normalized) >= 0.25


def _normalize_markdown(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.replace("\r\n", "\n").split("\n")]
    normalized = []
    for line in lines:
        if line or (normalized and normalized[-1]):
            normalized.append(line)
    return "\n".join(normalized).strip()


def _deduplicate_images(images) -> list[bytes]:
    unique: dict[str, bytes] = {}
    for image in images:
        if image:
            unique.setdefault(hashlib.sha256(image).hexdigest(), image)
    return list(unique.values())


def chunk_pages(pages: list[tuple[int | None, str]], max_chars: int = 3500) -> list[tuple[int | None, str]]:
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    overlap = min(160, max_chars // 10)
    chunks = []
    for page_number, text in pages:
        clean = _normalize_markdown(text)
        if not clean:
            continue
        blocks = re.split(r"\n\s*\n", clean)
        current = ""
        for block in blocks:
            for piece in _split_long_block(block, max_chars):
                candidate = f"{current}\n\n{piece}" if current else piece
                if current and len(candidate) > max_chars:
                    chunks.append((page_number, current))
                    carry = _chunk_overlap(current, overlap)
                    current = f"{carry}\n\n{piece}" if carry and len(carry) + len(piece) + 2 <= max_chars else piece
                else:
                    current = candidate
        if current:
            chunks.append((page_number, current))
    return chunks


def _chunk_overlap(text: str, overlap: int) -> str:
    if overlap <= 0:
        return ""
    last_block = text.rsplit("\n\n", 1)[-1]
    if last_block.startswith("|"):
        return ""
    tail = text[-overlap:]
    separator = max(tail.find("\n"), tail.find(" "))
    return tail[separator + 1:].strip() if separator >= 0 else tail.strip()


def _split_long_block(block: str, max_chars: int) -> list[str]:
    if len(block) <= max_chars:
        return [block]
    lines = block.splitlines()
    if len(lines) >= 3 and all(line.startswith("|") for line in lines):
        header = lines[:2]
        rows = []
        current_rows = []
        for row in lines[2:]:
            candidate = "\n".join([*header, *current_rows, row])
            if current_rows and len(candidate) > max_chars:
                rows.append("\n".join([*header, *current_rows]))
                current_rows = [row]
            else:
                current_rows.append(row)
        if current_rows:
            rows.append("\n".join([*header, *current_rows]))
        return rows
    pieces = []
    remaining = block
    overlap = min(160, max_chars // 10)
    while len(remaining) > max_chars:
        boundary = remaining.rfind("\n", 0, max_chars + 1)
        if boundary < max_chars // 2:
            boundary = remaining.rfind(" ", 0, max_chars + 1)
        if boundary < max_chars // 2:
            boundary = max_chars
        pieces.append(remaining[:boundary].rstrip())
        start = max(0, boundary - overlap)
        if start:
            separator = remaining.find(" ", start, boundary)
            start = separator + 1 if separator >= 0 else start
        remaining = remaining[start:].lstrip()
    if remaining:
        pieces.append(remaining)
    return pieces
